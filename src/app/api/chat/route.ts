import { createAnthropic } from '@ai-sdk/anthropic';
import {
  streamText,
  convertToModelMessages,
  tool,
  stepCountIs,
  type UIMessage,
} from 'ai';
import { z } from 'zod';
import { Timestamp } from 'firebase-admin/firestore';
import { endOfDay, isValid, parseISO, startOfDay } from 'date-fns';
import { adminDb } from '@/lib/firebase-admin';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT =
  'You are a helpful AI assistant for a premium POS system. You have access to sales analytics and the full POS database. Use getTopProducts to identify best-selling items when the user asks about product performance. Use getProductsCatalog for catalog, prices, and availability. Use getInvoices for recent transactions and documents. Use getClosures for financial closure reports (uzávěrky) for a given date. If the user asks for a specific invoice at a certain time/date, use the getInvoiceByDetails tool to find the exact document.';

export const maxDuration = 30;

type StoreContext = {
  storeId?: string;
  userId?: string;
};

type TopProduct = {
  productId: string;
  productName: string;
  quantitySold: number;
};

type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  category: string | null;
  stock: number | null;
  soldCount: number;
  isExtra: boolean;
};

type InvoiceSummary = {
  id: string;
  documentId: string | null;
  createdAt: string;
  totalAmount: number;
  finalAmount: number | null;
  paymentMethod: string;
  currency: string;
  itemCount: number;
  isRefund: boolean;
};

type InvoiceDetail = {
  invoiceId: string;
  id: string;
  createdAt: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price: number;
  }>;
  totalAmount: number;
  paymentMethod: string;
  currency: string;
  finalAmount: number | null;
};

type ClosureReport = {
  date: string;
  source: 'reports' | 'computed';
  totalSales: number;
  cashSales: number;
  cardSales: number;
  qrSales: number;
  customerCount: number;
  totalCosts: number | null;
  totalProfit: number | null;
  totalDiscounts: number;
  totalTips: number;
};

function storeRef(userId: string, storeId: string) {
  return adminDb.collection('users').doc(userId).collection('stores').doc(storeId);
}

function missingContextError() {
  return 'Missing store context. storeId and userId are required.';
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function parseRequestedDate(date?: string): Date | null {
  if (!date) return new Date();

  const parsed = parseISO(date);
  if (isValid(parsed)) return parsed;

  const dotted = date.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotted) {
    const [, day, month, year] = dotted;
    const fallback = new Date(Number(year), Number(month) - 1, Number(day));
    return isValid(fallback) ? fallback : null;
  }

  return null;
}

const INVOICE_TIME_MATCH_WINDOW_MS = 2 * 60 * 1000;

function parseDateAndTime(date: string, time: string): Date | null {
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0
  );

  return isValid(parsed) ? parsed : null;
}

function toTimestamp(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return isValid(parsed) ? parsed : null;
  }
  return null;
}

function saleAmountInCzk(sale: FirebaseFirestore.DocumentData): number {
  if (sale.currency === 'EUR' && typeof sale.eurRate === 'number') {
    return (sale.totalAmount ?? 0) * sale.eurRate;
  }
  return sale.totalAmount ?? 0;
}

async function fetchTopProductsFromSales(
  userId: string,
  storeId: string,
  limit: number
): Promise<TopProduct[]> {
  const salesSnapshot = await storeRef(userId, storeId).collection('sales').get();

  const quantityByProduct = new Map<string, TopProduct>();

  for (const saleDoc of salesSnapshot.docs) {
    const items = (saleDoc.data().items ?? []) as Array<{
      productId?: string;
      productName?: string;
      quantity?: number;
    }>;

    for (const item of items) {
      if (!item.productId) continue;

      const existing = quantityByProduct.get(item.productId);
      const quantity = item.quantity ?? 0;

      if (existing) {
        existing.quantitySold += quantity;
        continue;
      }

      quantityByProduct.set(item.productId, {
        productId: item.productId,
        productName: item.productName ?? 'Unknown product',
        quantitySold: quantity,
      });
    }
  }

  return Array.from(quantityByProduct.values())
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, limit);
}

async function fetchTopProductsFromCatalog(
  userId: string,
  storeId: string,
  limit: number
): Promise<TopProduct[]> {
  const productsSnapshot = await storeRef(userId, storeId).collection('products').get();

  return productsSnapshot.docs
    .map((productDoc) => {
      const data = productDoc.data();
      return {
        productId: productDoc.id,
        productName: (data.name as string) ?? 'Unknown product',
        quantitySold: (data.soldCount as number) ?? 0,
      };
    })
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, limit);
}

async function fetchProductsCatalog(userId: string, storeId: string): Promise<CatalogProduct[]> {
  const productsSnapshot = await storeRef(userId, storeId).collection('products').get();

  return productsSnapshot.docs
    .map((productDoc) => {
      const data = productDoc.data();
      const stock =
        typeof data.stock === 'number'
          ? data.stock
          : typeof data.stockLevel === 'number'
            ? data.stockLevel
            : null;

      return {
        id: productDoc.id,
        name: (data.name as string) ?? 'Unknown product',
        price: (data.price as number) ?? 0,
        category: (data.category as string | undefined) ?? null,
        stock,
        soldCount: (data.soldCount as number) ?? 0,
        isExtra: Boolean(data.isExtra),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}

async function fetchInvoices(
  userId: string,
  storeId: string,
  limit: number
): Promise<InvoiceSummary[]> {
  const salesSnapshot = await storeRef(userId, storeId)
    .collection('sales')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return salesSnapshot.docs.map((saleDoc) => {
    const data = saleDoc.data();
    const items = (data.items ?? []) as unknown[];

    return {
      id: saleDoc.id,
      documentId: (data.documentId as string | undefined) ?? null,
      createdAt: toIsoDate(data.createdAt) ?? new Date().toISOString(),
      totalAmount: (data.totalAmount as number) ?? 0,
      finalAmount: (data.finalAmount as number | undefined) ?? null,
      paymentMethod: (data.paymentMethod as string) ?? 'unknown',
      currency: (data.currency as string) ?? 'CZK',
      itemCount: items.length,
      isRefund: Boolean(data.isRefund),
    };
  });
}

async function fetchInvoiceByDetails(
  userId: string,
  storeId: string,
  date: string,
  time: string
): Promise<{ invoice: InvoiceDetail | null; error?: string; candidates?: number }> {
  const targetTime = parseDateAndTime(date, time);
  if (!targetTime) {
    return {
      invoice: null,
      error: 'Invalid date or time format. Use date YYYY-MM-DD and time HH:MM.',
    };
  }

  const rangeStart = new Date(targetTime.getTime() - INVOICE_TIME_MATCH_WINDOW_MS);
  const rangeEnd = new Date(targetTime.getTime() + INVOICE_TIME_MATCH_WINDOW_MS);

  const salesSnapshot = await storeRef(userId, storeId)
    .collection('sales')
    .where('createdAt', '>=', Timestamp.fromDate(rangeStart))
    .where('createdAt', '<=', Timestamp.fromDate(rangeEnd))
    .get();

  if (salesSnapshot.empty) {
    return { invoice: null, candidates: 0 };
  }

  const rankedMatches = salesSnapshot.docs
    .map((saleDoc) => {
      const createdAt = toTimestamp(saleDoc.data().createdAt);
      if (!createdAt) return null;

      return {
        saleDoc,
        diffMs: Math.abs(createdAt.getTime() - targetTime.getTime()),
      };
    })
    .filter((match): match is NonNullable<typeof match> => match !== null)
    .sort((a, b) => a.diffMs - b.diffMs);

  const bestMatch = rankedMatches[0];
  if (!bestMatch) {
    return { invoice: null, candidates: 0 };
  }

  const data = bestMatch.saleDoc.data();
  const items = ((data.items ?? []) as Array<{
    productId?: string;
    productName?: string;
    quantity?: number;
    price?: number;
  }>).map((item) => ({
    productId: item.productId ?? '',
    productName: item.productName ?? 'Unknown product',
    quantity: item.quantity ?? 0,
    price: item.price ?? 0,
  }));

  const createdAt = toTimestamp(data.createdAt);

  return {
    invoice: {
      invoiceId: (data.documentId as string | undefined) ?? bestMatch.saleDoc.id,
      id: bestMatch.saleDoc.id,
      createdAt: createdAt?.toISOString() ?? targetTime.toISOString(),
      items,
      totalAmount: (data.totalAmount as number) ?? 0,
      paymentMethod: (data.paymentMethod as string) ?? 'unknown',
      currency: (data.currency as string) ?? 'CZK',
      finalAmount: (data.finalAmount as number | undefined) ?? null,
    },
    candidates: rankedMatches.length,
  };
}

async function fetchSavedClosure(
  userId: string,
  storeId: string,
  date: Date
): Promise<ClosureReport | null> {
  const dateKey = date.toISOString().slice(0, 10);
  const reportsSnapshot = await storeRef(userId, storeId).collection('reports').get();

  const matched = reportsSnapshot.docs.find((reportDoc) => {
    const data = reportDoc.data();
    const reportDate =
      (data.date as string | undefined) ??
      (data.periodDate as string | undefined) ??
      toIsoDate(data.createdAt)?.slice(0, 10);

    return reportDate === dateKey;
  });

  if (!matched) return null;

  const data = matched.data();
  return {
    date: dateKey,
    source: 'reports',
    totalSales: (data.totalSales as number) ?? 0,
    cashSales: (data.cashSales as number) ?? 0,
    cardSales: (data.cardSales as number) ?? 0,
    qrSales: (data.qrSales as number) ?? 0,
    customerCount: (data.customerCount as number) ?? 0,
    totalCosts: (data.totalCosts as number | undefined) ?? null,
    totalProfit: (data.totalProfit as number | undefined) ?? null,
    totalDiscounts: (data.totalDiscounts as number) ?? 0,
    totalTips: (data.totalTips as number) ?? 0,
  };
}

async function computeClosureFromSales(
  userId: string,
  storeId: string,
  date: Date
): Promise<ClosureReport> {
  const rangeStart = startOfDay(date);
  const rangeEnd = endOfDay(date);

  const [salesSnapshot, productsSnapshot] = await Promise.all([
    storeRef(userId, storeId)
      .collection('sales')
      .where('createdAt', '>=', Timestamp.fromDate(rangeStart))
      .where('createdAt', '<=', Timestamp.fromDate(rangeEnd))
      .get(),
    storeRef(userId, storeId).collection('products').get(),
  ]);

  const productMap = new Map(
    productsSnapshot.docs.map((productDoc) => [productDoc.id, productDoc.data()])
  );

  let totalSales = 0;
  let cashSales = 0;
  let cardSales = 0;
  let qrSales = 0;
  let totalCosts = 0;
  let totalDiscounts = 0;
  let totalTips = 0;

  for (const saleDoc of salesSnapshot.docs) {
    const sale = saleDoc.data();
    const amount = saleAmountInCzk(sale);
    totalSales += amount;
    totalDiscounts += (sale.discountAmount as number) ?? 0;
    totalTips += (sale.tipAmount as number) ?? 0;

    if (sale.paymentMethod === 'cash') cashSales += amount;
    if (sale.paymentMethod === 'card') cardSales += amount;
    if (sale.paymentMethod === 'qr') qrSales += amount;

    for (const item of (sale.items ?? []) as Array<{ productId?: string; quantity?: number }>) {
      const product = item.productId ? productMap.get(item.productId) : undefined;
      const cost = product?.cost;
      if (typeof cost === 'number') {
        totalCosts += cost * (item.quantity ?? 0);
      }
    }
  }

  return {
    date: rangeStart.toISOString().slice(0, 10),
    source: 'computed',
    totalSales,
    cashSales,
    cardSales,
    qrSales,
    customerCount: salesSnapshot.size,
    totalCosts,
    totalProfit: totalSales - totalCosts,
    totalDiscounts,
    totalTips,
  };
}

async function fetchClosure(
  userId: string,
  storeId: string,
  date?: string
): Promise<{ closure: ClosureReport | null; error?: string }> {
  const parsedDate = parseRequestedDate(date);
  if (!parsedDate) {
    return { closure: null, error: 'Invalid date format. Use YYYY-MM-DD or D.M.YYYY.' };
  }

  const saved = await fetchSavedClosure(userId, storeId, parsedDate);
  if (saved) {
    return { closure: saved };
  }

  const computed = await computeClosureFromSales(userId, storeId, parsedDate);
  return { closure: computed };
}

export async function POST(req: Request) {
  try {
    const {
      messages,
      storeId,
      userId,
    }: { messages: UIMessage[]; storeId?: string; userId?: string } = await req.json();

    const context: StoreContext = { storeId, userId };

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: {
        getTopProducts: tool({
          description: 'Returns the top-selling products for the current store by quantity sold.',
          inputSchema: z.object({
            limit: z
              .number()
              .int()
              .min(1)
              .max(50)
              .default(5)
              .describe('Number of top products to return'),
          }),
          execute: async ({ limit }) => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), products: [] as TopProduct[] };
            }

            try {
              const fromSales = await fetchTopProductsFromSales(context.userId, context.storeId, limit);
              if (fromSales.length > 0) {
                return { products: fromSales, source: 'sales' as const };
              }

              const fromProducts = await fetchTopProductsFromCatalog(context.userId, context.storeId, limit);
              return { products: fromProducts, source: 'products' as const };
            } catch (error) {
              console.error('❌ getTopProducts tool error:', error);
              return { error: 'Failed to load top products from Firebase.', products: [] as TopProduct[] };
            }
          },
        }),
        getProductsCatalog: tool({
          description:
            'Returns the full product catalog for the current store, including prices and stock levels when available.',
          inputSchema: z.object({}),
          execute: async () => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), products: [] as CatalogProduct[] };
            }

            try {
              const products = await fetchProductsCatalog(context.userId, context.storeId);
              return { products, count: products.length };
            } catch (error) {
              console.error('❌ getProductsCatalog tool error:', error);
              return { error: 'Failed to load product catalog from Firebase.', products: [] as CatalogProduct[] };
            }
          },
        }),
        getInvoices: tool({
          description:
            'Returns recent invoices (sales documents) for the current store, ordered from newest to oldest.',
          inputSchema: z.object({
            limit: z
              .number()
              .int()
              .min(1)
              .max(100)
              .default(10)
              .describe('Number of recent invoices to return'),
          }),
          execute: async ({ limit }) => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), invoices: [] as InvoiceSummary[] };
            }

            try {
              const invoices = await fetchInvoices(context.userId, context.storeId, limit);
              return { invoices, count: invoices.length };
            } catch (error) {
              console.error('❌ getInvoices tool error:', error);
              return { error: 'Failed to load invoices from Firebase.', invoices: [] as InvoiceSummary[] };
            }
          },
        }),
        getInvoiceByDetails: tool({
          description:
            'Finds a specific invoice (sales document) by exact date and time within a 2-minute window.',
          inputSchema: z.object({
            date: z.string().describe('Invoice date in YYYY-MM-DD format'),
            time: z.string().describe('Invoice time in HH:MM format (24-hour clock)'),
          }),
          execute: async ({ date, time }) => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), invoice: null };
            }

            try {
              return await fetchInvoiceByDetails(context.userId, context.storeId, date, time);
            } catch (error) {
              console.error('❌ getInvoiceByDetails tool error:', error);
              return { error: 'Failed to load invoice details from Firebase.', invoice: null };
            }
          },
        }),
        getClosures: tool({
          description:
            'Returns a financial closure report (uzávěrka) for the current store. Computes from sales when no saved report exists.',
          inputSchema: z.object({
            date: z
              .string()
              .optional()
              .describe('Optional date for the closure report in YYYY-MM-DD or D.M.YYYY format. Defaults to today.'),
          }),
          execute: async ({ date }) => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), closure: null };
            }

            try {
              return await fetchClosure(context.userId, context.storeId, date);
            } catch (error) {
              console.error('❌ getClosures tool error:', error);
              return { error: 'Failed to load closure report from Firebase.', closure: null };
            }
          },
        }),
      },
      stopWhen: stepCountIs(8),
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('❌ Error in chat API:', error);
    return new Response(JSON.stringify({ error: 'Chat API error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
