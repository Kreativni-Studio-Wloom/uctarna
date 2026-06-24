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
import { endOfDay, format, isValid, parseISO, startOfDay } from 'date-fns';
import { cs } from 'date-fns/locale';
import nodemailer from 'nodemailer';
import { buildEmailReportData, generateEmailContent } from '@/lib/email';
import { saleTipInCzk } from '@/lib/saleTip';
import { adminDb } from '@/lib/firebase-admin';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT =
  'You are a helpful AI assistant for a premium POS system. You have access to sales analytics and the full POS database. Use getTopProducts to identify best-selling items when the user asks about product performance. Use getProductsCatalog for catalog, prices, and availability. Use getInvoices for recent transactions and documents. Use getClosures for financial closure reports (uzávěrky) for a given date. If the user asks for a specific invoice at a certain time/date, use the getInvoiceByDetails tool to find matching documents. When searching for invoices, if multiple documents match the time window, always list them all so the user can choose the correct one. You can send closures using the sendClosure tool. Always require an eventName and always ask for confirmation of the calculated summary before finalizing the send.';

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

type InvoiceByDetailsResult = {
  summary: string;
  count: number;
  invoices: InvoiceDetail[];
  error?: string;
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
const STORE_TIMEZONE_SUFFIX = '+02:00';
const STORE_TIMEZONE_LABEL = 'UTC+2';

const FIRESTORE_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const FIRESTORE_DISPLAY_REGEX =
  /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)\s+UTC\+2$/i;

function padTimePart(value: number): string {
  return String(value).padStart(2, '0');
}

function parseDateAndTimeUtcPlus2(date: string, time: string): Date | null {
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  const iso = `${year}-${month}-${day}T${padTimePart(Number(hour))}:${minute}:00${STORE_TIMEZONE_SUFFIX}`;
  const parsed = parseISO(iso);

  return isValid(parsed) ? parsed : null;
}

function getUtcPlus2DayRange(date: string): { start: Date; end: Date } | null {
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return null;

  const [, year, month, day] = dateMatch;
  const start = parseISO(`${year}-${month}-${day}T00:00:00${STORE_TIMEZONE_SUFFIX}`);
  const end = parseISO(`${year}-${month}-${day}T23:59:59.999${STORE_TIMEZONE_SUFFIX}`);

  if (!isValid(start) || !isValid(end)) return null;
  return { start, end };
}

function formatFirestoreUtcPlus2String(instant: Date): string {
  const shifted = new Date(instant.getTime() + 2 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = FIRESTORE_MONTH_NAMES[shifted.getUTCMonth()];
  const day = shifted.getUTCDate();
  let hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  const second = shifted.getUTCSeconds();
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;

  return `${month} ${day}, ${year} at ${hour}:${padTimePart(minute)}:${padTimePart(second)} ${ampm} ${STORE_TIMEZONE_LABEL}`;
}

function parseFirestoreUtcPlus2String(value: string): Date | null {
  const match = value.trim().match(FIRESTORE_DISPLAY_REGEX);
  if (!match) return null;

  const [, monthName, day, year, hour12, minute, second, ampm] = match;
  const monthIndex = FIRESTORE_MONTH_NAMES.findIndex(
    (name) => name.toLowerCase() === monthName.toLowerCase()
  );
  if (monthIndex < 0) return null;

  let hour = Number(hour12) % 12;
  if (ampm.toUpperCase() === 'PM') hour += 12;

  const iso = `${year}-${padTimePart(monthIndex + 1)}-${padTimePart(Number(day))}T${padTimePart(hour)}:${minute}:${second}${STORE_TIMEZONE_SUFFIX}`;
  const parsed = parseISO(iso);
  return isValid(parsed) ? parsed : null;
}

function normalizeCreatedAt(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;

  if (typeof value === 'string') {
    const firestoreDisplay = parseFirestoreUtcPlus2String(value);
    if (firestoreDisplay) return firestoreDisplay;

    const isoParsed = parseISO(value);
    if (isValid(isoParsed)) return isoParsed;

    const genericParsed = new Date(value);
    return isValid(genericParsed) ? genericParsed : null;
  }

  return null;
}

function toTimestamp(value: unknown): Date | null {
  return normalizeCreatedAt(value);
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

function mapSaleDocToInvoiceDetail(
  saleDoc: FirebaseFirestore.QueryDocumentSnapshot,
  fallbackCreatedAt?: string
): InvoiceDetail | null {
  const data = saleDoc.data();
  const createdAt = normalizeCreatedAt(data.createdAt);
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

  return {
    invoiceId: (data.documentId as string | undefined) ?? saleDoc.id,
    id: saleDoc.id,
    createdAt: createdAt ? formatFirestoreUtcPlus2String(createdAt) : (fallbackCreatedAt ?? 'Unknown time'),
    items,
    totalAmount: (data.totalAmount as number) ?? 0,
    paymentMethod: (data.paymentMethod as string) ?? 'unknown',
    currency: (data.currency as string) ?? 'CZK',
    finalAmount: (data.finalAmount as number | undefined) ?? null,
  };
}

function buildInvoiceSearchSummary(invoices: InvoiceDetail[]): string {
  if (invoices.length === 0) {
    return 'No invoices found in the requested time frame.';
  }

  const list = invoices
    .map(
      (invoice) =>
        `ID: ${invoice.invoiceId}, Time: ${invoice.createdAt}, Total: ${invoice.totalAmount} ${invoice.currency}`
    )
    .join('; ');

  const label = invoices.length === 1 ? 'invoice' : 'invoices';
  return `Here are ${invoices.length} ${label} found in the requested time frame: [${list}]`;
}

async function fetchInvoiceByDetails(
  userId: string,
  storeId: string,
  date: string,
  time: string
): Promise<InvoiceByDetailsResult> {
  const targetTime = parseDateAndTimeUtcPlus2(date, time);
  if (!targetTime) {
    return {
      summary: 'No invoices found in the requested time frame.',
      count: 0,
      invoices: [],
      error: 'Invalid date or time format. Use date YYYY-MM-DD and time HH:MM (interpreted as UTC+2).',
    };
  }

  const dayRange = getUtcPlus2DayRange(date);
  if (!dayRange) {
    return {
      summary: 'No invoices found in the requested time frame.',
      count: 0,
      invoices: [],
      error: 'Invalid date format. Use YYYY-MM-DD.',
    };
  }

  const targetDisplay = formatFirestoreUtcPlus2String(targetTime);
  const rangeStartMs = targetTime.getTime() - INVOICE_TIME_MATCH_WINDOW_MS;
  const rangeEndMs = targetTime.getTime() + INVOICE_TIME_MATCH_WINDOW_MS;

  let salesSnapshot = await storeRef(userId, storeId)
    .collection('sales')
    .where('createdAt', '>=', Timestamp.fromDate(dayRange.start))
    .where('createdAt', '<=', Timestamp.fromDate(dayRange.end))
    .get();

  if (salesSnapshot.empty) {
    salesSnapshot = await storeRef(userId, storeId).collection('sales').get();
  }

  const rankedMatches = salesSnapshot.docs
    .map((saleDoc) => {
      const rawCreatedAt = saleDoc.data().createdAt;
      const createdAt = normalizeCreatedAt(rawCreatedAt);
      if (!createdAt) return null;

      const createdAtMs = createdAt.getTime();
      const withinRange = createdAtMs >= rangeStartMs && createdAtMs <= rangeEndMs;

      const rawString = typeof rawCreatedAt === 'string' ? rawCreatedAt.trim() : null;
      const stringMatches =
        rawString !== null &&
        (rawString === targetDisplay ||
          (() => {
            const parsedString = parseFirestoreUtcPlus2String(rawString);
            if (!parsedString) return false;
            const parsedMs = parsedString.getTime();
            return parsedMs >= rangeStartMs && parsedMs <= rangeEndMs;
          })());

      if (!withinRange && !stringMatches) return null;

      return {
        saleDoc,
        diffMs: Math.abs(createdAtMs - targetTime.getTime()),
      };
    })
    .filter((match): match is NonNullable<typeof match> => match !== null)
    .sort((a, b) => a.diffMs - b.diffMs);

  const invoices = rankedMatches
    .map(({ saleDoc }) => mapSaleDocToInvoiceDetail(saleDoc, targetDisplay))
    .filter((invoice): invoice is InvoiceDetail => invoice !== null);

  return {
    summary: buildInvoiceSearchSummary(invoices),
    count: invoices.length,
    invoices,
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

type ClosureScope = 'daily' | 'period' | 'total';

type SendClosureParams = {
  type: ClosureScope;
  date?: string;
  startDate?: string;
  endDate?: string;
  eventName: string;
  confirmed?: boolean;
};

type ClosureSummaryPreview = {
  eventName: string;
  period: string;
  startDate: string;
  endDate: string;
  totalSales: number;
  customerCount: number;
  cashSales: number;
  cardSales: number;
  qrSales: number;
  totalProfit: number;
};

const EVENT_NAME_REQUIRED_MESSAGE =
  'Please provide the name of the event/location for this closure.';

function todayUtcPlus2DateString(): string {
  const shifted = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${padTimePart(shifted.getUTCMonth() + 1)}-${padTimePart(shifted.getUTCDate())}`;
}

function formatDisplayDate(date: Date): string {
  return format(date, 'd.M.yyyy', { locale: cs });
}

async function fetchUserEmail(userId: string): Promise<string | null> {
  const userDoc = await adminDb.collection('users').doc(userId).get();
  if (!userDoc.exists) return null;
  return (userDoc.data()?.email as string | undefined) ?? null;
}

async function fetchStoreName(userId: string, storeId: string): Promise<string> {
  const storeDoc = await storeRef(userId, storeId).get();
  return (storeDoc.data()?.name as string | undefined) ?? 'Neznámá prodejna';
}

async function fetchProductsForReport(userId: string, storeId: string) {
  const productsSnapshot = await storeRef(userId, storeId).collection('products').get();
  return productsSnapshot.docs.map((productDoc) => ({
    id: productDoc.id,
    cost: productDoc.data().cost as number | undefined,
  }));
}

async function fetchSalesForClosurePeriod(
  userId: string,
  storeId: string,
  type: ClosureScope,
  date?: string,
  startDate?: string,
  endDate?: string
): Promise<{
  sales: FirebaseFirestore.DocumentData[];
  period: string;
  startDate: string;
  endDate: string;
  error?: string;
}> {
  const storeDoc = await storeRef(userId, storeId).get();
  const storeCreatedAt = normalizeCreatedAt(storeDoc.data()?.createdAt) ?? new Date();

  if (type === 'daily') {
    const day = date ?? todayUtcPlus2DateString();
    const dayRange = getUtcPlus2DayRange(day);
    if (!dayRange) {
      return {
        sales: [],
        period: 'Denní',
        startDate: '',
        endDate: '',
        error: 'Invalid date format. Use YYYY-MM-DD.',
      };
    }

    const salesSnapshot = await storeRef(userId, storeId)
      .collection('sales')
      .where('createdAt', '>=', Timestamp.fromDate(dayRange.start))
      .where('createdAt', '<=', Timestamp.fromDate(dayRange.end))
      .get();

    const label = formatDisplayDate(dayRange.start);
    return {
      sales: salesSnapshot.docs.map((doc) => doc.data()),
      period: 'Denní',
      startDate: label,
      endDate: label,
    };
  }

  if (type === 'period') {
    if (!startDate || !endDate) {
      return {
        sales: [],
        period: 'Vlastní období',
        startDate: '',
        endDate: '',
        error: 'For period closures, both startDate and endDate are required (YYYY-MM-DD).',
      };
    }

    const rangeStart = getUtcPlus2DayRange(startDate)?.start;
    const rangeEnd = getUtcPlus2DayRange(endDate)?.end;
    if (!rangeStart || !rangeEnd) {
      return {
        sales: [],
        period: 'Vlastní období',
        startDate: '',
        endDate: '',
        error: 'Invalid startDate or endDate. Use YYYY-MM-DD.',
      };
    }

    if (rangeStart.getTime() > rangeEnd.getTime()) {
      return {
        sales: [],
        period: 'Vlastní období',
        startDate: '',
        endDate: '',
        error: 'startDate must be before or equal to endDate.',
      };
    }

    const salesSnapshot = await storeRef(userId, storeId)
      .collection('sales')
      .where('createdAt', '>=', Timestamp.fromDate(rangeStart))
      .where('createdAt', '<=', Timestamp.fromDate(rangeEnd))
      .get();

    return {
      sales: salesSnapshot.docs.map((doc) => doc.data()),
      period: 'Vlastní období',
      startDate: formatDisplayDate(rangeStart),
      endDate: formatDisplayDate(rangeEnd),
    };
  }

  const salesSnapshot = await storeRef(userId, storeId)
    .collection('sales')
    .orderBy('createdAt', 'desc')
    .get();

  return {
    sales: salesSnapshot.docs.map((doc) => doc.data()),
    period: 'Celková',
    startDate: formatDisplayDate(storeCreatedAt),
    endDate: formatDisplayDate(new Date()),
  };
}

function computeClosureTotals(
  sales: FirebaseFirestore.DocumentData[],
  products: Array<{ id: string; cost?: number }>
) {
  const productMap = new Map(products.map((product) => [product.id, product]));

  let totalSales = 0;
  let salesInCZK = 0;
  let salesInEUR = 0;
  let cashSales = 0;
  let cardSales = 0;
  let qrSales = 0;
  let totalCosts = 0;
  let totalDiscounts = 0;
  let totalTips = 0;

  for (const sale of sales) {
    const totalAmount = (sale.totalAmount as number) ?? 0;
    const currency = sale.currency as string | undefined;
    const eurRate = sale.eurRate as number | undefined;

    if (currency === 'EUR' && typeof eurRate === 'number') {
      totalSales += totalAmount * eurRate;
      if (sale.paidAmount && sale.paidCurrency === 'EUR') {
        const returnedEur =
          sale.changeAmountEUR && (sale.changeAmountEUR as number) > 0
            ? (sale.changeAmountEUR as number)
            : 0;
        salesInEUR += (sale.paidAmount as number) - returnedEur;
      } else {
        salesInEUR += totalAmount;
      }
    } else {
      totalSales += totalAmount;
      salesInCZK += totalAmount;
    }

    const amountInCzk =
      currency === 'EUR' && typeof eurRate === 'number' ? totalAmount * eurRate : totalAmount;

    if (sale.paymentMethod === 'cash') cashSales += amountInCzk;
    if (sale.paymentMethod === 'card') cardSales += amountInCzk;
    if (sale.paymentMethod === 'qr') qrSales += amountInCzk;

    totalDiscounts += (sale.discountAmount as number) ?? 0;
    totalTips += saleTipInCzk({
      tipAmount: sale.tipAmount as number | undefined,
      currency: (sale.currency as 'CZK' | 'EUR') ?? 'CZK',
      eurRate,
    });

    for (const item of (sale.items ?? []) as Array<{ productId?: string; quantity?: number }>) {
      const product = item.productId ? productMap.get(item.productId) : undefined;
      if (product && typeof product.cost === 'number') {
        totalCosts += product.cost * (item.quantity ?? 0);
      }
    }
  }

  const salesWithDiscount = sales.filter(
    (sale) => sale.discount && (sale.discountAmount as number) > 0
  ).length;

  return {
    totalSales,
    salesInCZK,
    salesInEUR,
    cashSales,
    cardSales,
    qrSales,
    customerCount: sales.length,
    totalCosts,
    totalProfit: totalSales - totalCosts,
    totalDiscounts,
    salesWithDiscount,
    totalTips,
  };
}

async function sendClosureReportEmail(
  to: string,
  reportData: ReturnType<typeof buildEmailReportData>,
  eventName: string
) {
  const emailContent = generateEmailContent(reportData, eventName);
  const emailSubject = `${reportData.period} uzávěrka - ${eventName} - ${reportData.storeName}`;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.seznam.cz',
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    pool: true,
    maxConnections: 1,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    auth: {
      user: process.env.SMTP_USER || 'info@uctarna.fun',
      pass: process.env.SMTP_PASS || 'xeQvep-coccec-watza7',
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'info@uctarna.fun',
    to,
    subject: emailSubject,
    html: emailContent.html,
    text: emailContent.text,
  });
}

async function executeSendClosure(
  userId: string,
  storeId: string,
  params: SendClosureParams
) {
  const eventName = params.eventName?.trim();
  if (!eventName) {
    return {
      sent: false,
      requiresConfirmation: false,
      requiresEventName: true,
      message: EVENT_NAME_REQUIRED_MESSAGE,
    };
  }

  const periodData = await fetchSalesForClosurePeriod(
    userId,
    storeId,
    params.type,
    params.date,
    params.startDate,
    params.endDate
  );

  if (periodData.error) {
    return {
      sent: false,
      requiresConfirmation: false,
      error: periodData.error,
      message: periodData.error,
    };
  }

  if (periodData.sales.length === 0) {
    return {
      sent: false,
      requiresConfirmation: false,
      message: 'No sales found for the selected closure period.',
      summary: {
        eventName,
        period: periodData.period,
        startDate: periodData.startDate,
        endDate: periodData.endDate,
        totalSales: 0,
        customerCount: 0,
        cashSales: 0,
        cardSales: 0,
        qrSales: 0,
        totalProfit: 0,
      } satisfies ClosureSummaryPreview,
    };
  }

  const [storeName, products, userEmail] = await Promise.all([
    fetchStoreName(userId, storeId),
    fetchProductsForReport(userId, storeId),
    fetchUserEmail(userId),
  ]);

  const totals = computeClosureTotals(periodData.sales, products);
  const summary: ClosureSummaryPreview = {
    eventName,
    period: periodData.period,
    startDate: periodData.startDate,
    endDate: periodData.endDate,
    totalSales: totals.totalSales,
    customerCount: totals.customerCount,
    cashSales: totals.cashSales,
    cardSales: totals.cardSales,
    qrSales: totals.qrSales,
    totalProfit: totals.totalProfit,
  };

  const previewMessage = `Closure preview for "${eventName}" (${summary.period}, ${summary.startDate}${summary.startDate !== summary.endDate ? ` - ${summary.endDate}` : ''}): total ${summary.totalSales.toLocaleString('cs-CZ')} CZK across ${summary.customerCount} transactions. Ask the user to confirm before sending.`;

  if (!params.confirmed) {
    return {
      sent: false,
      requiresConfirmation: true,
      summary,
      message: previewMessage,
    };
  }

  if (!userEmail) {
    return {
      sent: false,
      requiresConfirmation: false,
      summary,
      error: 'User email not found. Cannot send closure report.',
      message: 'User email not found. Cannot send closure report.',
    };
  }

  const emailPayload = buildEmailReportData(
    {
      storeName,
      period: periodData.period,
      startDate: periodData.startDate,
      endDate: periodData.endDate,
    },
    totals,
    periodData.sales as Array<{
      items?: Array<{
        productId: string;
        productName: string;
        quantity: number;
        price: number;
      }>;
      paymentMethod: string;
    }>,
    products
  );

  await sendClosureReportEmail(userEmail, emailPayload, eventName);

  return {
    sent: true,
    requiresConfirmation: false,
    summary,
    recipient: userEmail,
    message: `Closure report sent to ${userEmail} for "${eventName}". Total ${summary.totalSales.toLocaleString('cs-CZ')} CZK, ${summary.customerCount} transactions.`,
  };
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
            'Finds all invoices (sales documents) matching the requested date and time within a 2-minute window. Date/time are always interpreted as UTC+2. Returns every match so the user can choose the correct document.',
          inputSchema: z.object({
            date: z.string().describe('Invoice date in YYYY-MM-DD format (UTC+2)'),
            time: z.string().describe('Invoice time in HH:MM format, 24-hour clock, always UTC+2'),
          }),
          execute: async ({ date, time }) => {
            if (!context.storeId || !context.userId) {
              return {
                error: missingContextError(),
                summary: 'No invoices found in the requested time frame.',
                count: 0,
                invoices: [] as InvoiceDetail[],
              };
            }

            try {
              return await fetchInvoiceByDetails(context.userId, context.storeId, date, time);
            } catch (error) {
              console.error('❌ getInvoiceByDetails tool error:', error);
              return {
                error: 'Failed to load invoice details from Firebase.',
                summary: 'No invoices found in the requested time frame.',
                count: 0,
                invoices: [] as InvoiceDetail[],
              };
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
        sendClosure: tool({
          description:
            'Prepare or send a closure report (uzávěrka) by email. Always call first with confirmed=false to show a preview, then call again with confirmed=true only after explicit user approval.',
          inputSchema: z.object({
            type: z.enum(['daily', 'period', 'total']).describe('Scope of the closure report'),
            date: z
              .string()
              .optional()
              .describe("Required for type 'daily' in YYYY-MM-DD format (UTC+2). Defaults to today."),
            startDate: z
              .string()
              .optional()
              .describe("Required for type 'period' in YYYY-MM-DD format (UTC+2)."),
            endDate: z
              .string()
              .optional()
              .describe("Required for type 'period' in YYYY-MM-DD format (UTC+2)."),
            eventName: z
              .string()
              .describe('Name of the event/location to associate the closure with'),
            confirmed: z
              .boolean()
              .default(false)
              .describe('Must be false for preview. Set true only after the user explicitly confirms sending.'),
          }),
          execute: async ({ type, date, startDate, endDate, eventName, confirmed }) => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), sent: false };
            }

            try {
              return await executeSendClosure(context.userId, context.storeId, {
                type,
                date,
                startDate,
                endDate,
                eventName,
                confirmed,
              });
            } catch (error) {
              console.error('❌ sendClosure tool error:', error);
              return {
                sent: false,
                error: 'Failed to send closure report.',
                message: 'Failed to send closure report.',
              };
            }
          },
        }),
      },
      stopWhen: stepCountIs(10),
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
