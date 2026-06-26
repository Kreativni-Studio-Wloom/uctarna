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
import { adminDb, saveChat } from '@/lib/firebase-admin';

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT =
  'You are a helpful AI assistant for a premium POS system. You have access to sales analytics and the full POS database. Use getTopProducts to identify best-selling items when the user asks about product performance. Use getProductsCatalog for catalog, prices, and availability. Use getInvoices for recent transactions and documents. Use getClosures for financial closure reports (uzávěrky) for a given date. If the user asks for a specific invoice at a certain time/date, use the getInvoiceByDetails tool to find matching documents. When searching for invoices, if multiple documents match the time window, always list them all so the user can choose the correct one. You can send closures using the sendClosure tool. Always require an eventName and always ask for confirmation of the calculated summary before finalizing the send. If the user asks about the cost price or margin of a drink, use the getProductCost tool. If the user asks for profitability, use both getProductCost and the sales data to calculate the margin. You can update product name, price, or cost using updateProduct. Always call updateProduct first with confirmed=false to preview planned changes and ask the user to confirm. Only call updateProduct with confirmed=true after the user explicitly approves (for example "Yes" or "Proceed"). Never apply product updates without explicit user confirmation. You can create new products using the createProduct tool. Always verify the details with the user before committing to the database. Always call createProduct first with confirmed=false to show a summary and ask for confirmation. Only call createProduct with confirmed=true after the user explicitly approves. You can manage pinned items in the POS menu using the togglePinnedItem tool. Always confirm the action with the user. Always call togglePinnedItem first with confirmed=false, then call again with confirmed=true only after explicit user approval. You can manage extras using the addExtra tool. Always confirm details before saving. Always call addExtra first with confirmed=false to show a summary and ask for confirmation. Only call addExtra with confirmed=true after the user explicitly approves. You are now an administrator of the system. You can update configuration parameters like exchange rates, billing details, and payment settings via the updateSettings tool. ALWAYS confirm significant changes like IBAN or company details with the user. Always call updateSettings first with confirmed=false, then call again with confirmed=true only after explicit user approval.';

const STORE_TIMEZONE = 'Europe/Prague';

function buildSystemPrompt(now = new Date()): string {
  const currentDateTime = new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: STORE_TIMEZONE,
    hour12: false,
  }).format(now);

  const calendarDate = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: STORE_TIMEZONE,
  }).format(now);

  return `${SYSTEM_PROMPT}\n\nCurrent date and time in store timezone (${STORE_TIMEZONE}): ${currentDateTime} (calendar date ${calendarDate}). Treat this as authoritative "now" when the user asks about today, yesterday, this week, or the current time.`;
}

export const maxDuration = 300;

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

type ProductCostMatch = {
  id: string;
  name: string;
  price: number;
  cost: number | null;
  purchasePrice: number | null;
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

function resolveProductCost(data: FirebaseFirestore.DocumentData): {
  cost: number | null;
  purchasePrice: number | null;
} {
  const cost = typeof data.cost === 'number' ? data.cost : null;
  const purchasePrice = typeof data.purchasePrice === 'number' ? data.purchasePrice : null;

  return { cost, purchasePrice };
}

function rankProductNameMatches(query: string, name: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedName = name.trim().toLowerCase();

  if (!normalizedQuery || !normalizedName.includes(normalizedQuery)) {
    return Number.POSITIVE_INFINITY;
  }

  if (normalizedName === normalizedQuery) return 0;
  if (normalizedName.startsWith(normalizedQuery)) return 1;
  return 2;
}

async function fetchProductCost(
  userId: string,
  storeId: string,
  productName: string
): Promise<{ products: ProductCostMatch[]; query: string }> {
  const query = productName.trim();
  if (!query) {
    return { products: [], query: productName };
  }

  const productsSnapshot = await storeRef(userId, storeId).collection('products').get();

  const products = productsSnapshot.docs
    .map((productDoc) => {
      const data = productDoc.data();
      const name = (data.name as string) ?? 'Unknown product';
      const { cost, purchasePrice } = resolveProductCost(data);

      return {
        id: productDoc.id,
        name,
        price: (data.price as number) ?? 0,
        cost,
        purchasePrice,
        matchRank: rankProductNameMatches(query, name),
      };
    })
    .filter((product) => product.matchRank !== Number.POSITIVE_INFINITY)
    .sort((a, b) => {
      if (a.matchRank !== b.matchRank) return a.matchRank - b.matchRank;
      return a.name.localeCompare(b.name, 'cs');
    })
    .map(({ matchRank: _matchRank, ...product }) => product);

  return { products, query };
}

type ProductUpdates = {
  name?: string;
  price?: number;
  cost?: number;
};

type UpdateProductParams = {
  productId: string;
  updates: ProductUpdates;
  confirmed?: boolean;
};

function formatProductMoney(value: number | null): string {
  if (value === null) return 'not set';
  return `${value.toLocaleString('cs-CZ')} CZK`;
}

function buildProductUpdatePayload(
  current: { name: string; price: number; cost: number | null },
  updates: ProductUpdates
): { payload: Record<string, unknown>; changes: string[]; error?: string } {
  const payload: Record<string, unknown> = {};
  const changes: string[] = [];

  if (updates.name !== undefined) {
    const nextName = updates.name.trim();
    if (!nextName) {
      return { payload, changes, error: 'Product name cannot be empty.' };
    }
    if (nextName !== current.name) {
      payload.name = nextName;
      changes.push(`name: "${current.name}" -> "${nextName}"`);
    }
  }

  if (updates.price !== undefined) {
    if (!Number.isFinite(updates.price) || updates.price < 0) {
      return { payload, changes, error: 'Price must be a non-negative number.' };
    }
    if (updates.price !== current.price) {
      payload.price = updates.price;
      changes.push(
        `price: ${formatProductMoney(current.price)} -> ${formatProductMoney(updates.price)}`
      );
    }
  }

  if (updates.cost !== undefined) {
    if (!Number.isFinite(updates.cost) || updates.cost < 0) {
      return { payload, changes, error: 'Cost must be a non-negative number.' };
    }
    const currentCost = current.cost;
    if (updates.cost !== currentCost) {
      payload.cost = updates.cost;
      changes.push(
        `cost: ${formatProductMoney(currentCost)} -> ${formatProductMoney(updates.cost)}`
      );
    }
  }

  return { payload, changes };
}

async function executeUpdateProduct(userId: string, storeId: string, params: UpdateProductParams) {
  const productId = params.productId?.trim();
  if (!productId) {
    return {
      updated: false,
      requiresConfirmation: false,
      error: 'productId is required.',
      message: 'productId is required.',
    };
  }

  const updates = params.updates ?? {};
  const hasUpdates =
    updates.name !== undefined || updates.price !== undefined || updates.cost !== undefined;

  if (!hasUpdates) {
    return {
      updated: false,
      requiresConfirmation: false,
      error: 'At least one field in updates (name, price, cost) is required.',
      message: 'At least one field in updates (name, price, cost) is required.',
    };
  }

  const productRef = storeRef(userId, storeId).collection('products').doc(productId);
  const productDoc = await productRef.get();

  if (!productDoc.exists) {
    return {
      updated: false,
      requiresConfirmation: false,
      error: `Product with id "${productId}" was not found.`,
      message: `Product with id "${productId}" was not found.`,
    };
  }

  const data = productDoc.data()!;
  const current = {
    name: (data.name as string) ?? 'Unknown product',
    price: (data.price as number) ?? 0,
    cost: typeof data.cost === 'number' ? data.cost : null,
  };

  const { payload, changes, error } = buildProductUpdatePayload(current, updates);
  if (error) {
    return {
      updated: false,
      requiresConfirmation: false,
      error,
      message: error,
    };
  }

  if (changes.length === 0) {
    return {
      updated: false,
      requiresConfirmation: false,
      productId,
      productName: current.name,
      message: 'No changes detected. The requested values already match the current product data.',
    };
  }

  const previewMessage = `I plan to make the following changes to ${current.name}: ${changes.join('; ')}. Do you confirm I should proceed?`;

  if (!params.confirmed) {
    return {
      updated: false,
      requiresConfirmation: true,
      productId,
      productName: current.name,
      current,
      plannedChanges: changes,
      message: previewMessage,
    };
  }

  await productRef.update({
    ...payload,
    updatedAt: Timestamp.now(),
  });

  const updatedName = (payload.name as string | undefined) ?? current.name;

  return {
    updated: true,
    requiresConfirmation: false,
    productId,
    productName: updatedName,
    appliedChanges: changes,
    message: `Product "${updatedName}" was updated successfully.`,
  };
}

type CreateProductParams = {
  name: string;
  price: number;
  cost: number;
  category?: string;
  confirmed?: boolean;
};

function buildCreateProductPreviewMessage(params: {
  name: string;
  price: number;
  cost: number;
  category?: string;
}): string {
  const categorySuffix = params.category ? `, Category: ${params.category}` : '';
  return `I am ready to add a new product: ${params.name}, Price: ${params.price}, Cost: ${params.cost}${categorySuffix}. Do you confirm?`;
}

async function executeCreateProduct(userId: string, storeId: string, params: CreateProductParams) {
  const name = params.name?.trim();
  if (!name) {
    return {
      created: false,
      requiresConfirmation: false,
      error: 'Product name is required.',
      message: 'Product name is required.',
    };
  }

  if (!Number.isFinite(params.price) || params.price < 0) {
    return {
      created: false,
      requiresConfirmation: false,
      error: 'Price must be a non-negative number.',
      message: 'Price must be a non-negative number.',
    };
  }

  if (!Number.isFinite(params.cost) || params.cost < 0) {
    return {
      created: false,
      requiresConfirmation: false,
      error: 'Cost must be a non-negative number.',
      message: 'Cost must be a non-negative number.',
    };
  }

  const category = params.category?.trim() || undefined;
  const preview = {
    name,
    price: params.price,
    cost: params.cost,
    category,
  };

  const previewMessage = buildCreateProductPreviewMessage(preview);

  if (!params.confirmed) {
    return {
      created: false,
      requiresConfirmation: true,
      product: preview,
      message: previewMessage,
    };
  }

  const now = Timestamp.now();
  const productData: Record<string, unknown> = {
    name,
    price: params.price,
    cost: params.cost,
    isPopular: false,
    soldCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  if (category) {
    productData.category = category;
  }

  const docRef = await storeRef(userId, storeId).collection('products').add(productData);

  return {
    created: true,
    requiresConfirmation: false,
    productId: docRef.id,
    product: preview,
    message: `Product "${name}" was created successfully with ID ${docRef.id}.`,
  };
}

type TogglePinnedItemParams = {
  productId: string;
  confirmed?: boolean;
};

async function executeTogglePinnedItem(
  userId: string,
  storeId: string,
  params: TogglePinnedItemParams
) {
  const productId = params.productId?.trim();
  if (!productId) {
    return {
      toggled: false,
      requiresConfirmation: false,
      error: 'productId is required.',
      message: 'productId is required.',
    };
  }

  const productDoc = await storeRef(userId, storeId).collection('products').doc(productId).get();
  if (!productDoc.exists) {
    return {
      toggled: false,
      requiresConfirmation: false,
      error: `Product with id "${productId}" was not found.`,
      message: `Product with id "${productId}" was not found.`,
    };
  }

  const productName = (productDoc.data()?.name as string) ?? 'Unknown product';
  const storeDoc = await storeRef(userId, storeId).get();
  const pinnedProductIds = (storeDoc.data()?.pinnedProductIds as string[] | undefined) ?? [];
  const isPinned = pinnedProductIds.includes(productId);
  const action = isPinned ? 'unpin' : 'pin';
  const previewMessage = `I am about to ${action} the product '${productName}'. Do you confirm?`;

  if (!params.confirmed) {
    return {
      toggled: false,
      requiresConfirmation: true,
      productId,
      productName,
      currentlyPinned: isPinned,
      nextPinned: !isPinned,
      message: previewMessage,
    };
  }

  const nextPinnedProductIds = isPinned
    ? pinnedProductIds.filter((id) => id !== productId)
    : [...pinnedProductIds, productId];

  await storeRef(userId, storeId).update({
    pinnedProductIds: nextPinnedProductIds,
    updatedAt: Timestamp.now(),
  });

  return {
    toggled: true,
    requiresConfirmation: false,
    productId,
    productName,
    pinned: !isPinned,
    message: `Product "${productName}" was ${isPinned ? 'unpinned' : 'pinned'} successfully.`,
  };
}

type AddExtraParams = {
  name: string;
  price: number;
  category: string;
  confirmed?: boolean;
};

function buildAddExtraPreviewMessage(params: { name: string; price: number; category: string }): string {
  return `I am ready to add a new extra: ${params.name}, Price: ${params.price}, Category: ${params.category}. Do you confirm?`;
}

async function executeAddExtra(userId: string, storeId: string, params: AddExtraParams) {
  const name = params.name?.trim();
  if (!name) {
    return {
      created: false,
      requiresConfirmation: false,
      error: 'Extra name is required.',
      message: 'Extra name is required.',
    };
  }

  if (!Number.isFinite(params.price) || params.price < 0) {
    return {
      created: false,
      requiresConfirmation: false,
      error: 'Price must be a non-negative number.',
      message: 'Price must be a non-negative number.',
    };
  }

  const category = params.category?.trim();
  if (!category) {
    return {
      created: false,
      requiresConfirmation: false,
      error: 'Category is required.',
      message: 'Category is required.',
    };
  }

  const preview = {
    name,
    price: params.price,
    category,
  };

  const previewMessage = buildAddExtraPreviewMessage(preview);

  if (!params.confirmed) {
    return {
      created: false,
      requiresConfirmation: true,
      extra: preview,
      message: previewMessage,
    };
  }

  const now = Timestamp.now();
  const docRef = await storeRef(userId, storeId).collection('products').add({
    name,
    price: params.price,
    category,
    cost: null,
    isExtra: true,
    isPopular: false,
    soldCount: 0,
    createdAt: now,
    updatedAt: now,
  });

  return {
    created: true,
    requiresConfirmation: false,
    extraId: docRef.id,
    extra: preview,
    message: `Extra "${name}" was created successfully with ID ${docRef.id}.`,
  };
}

type SettingTarget = 'store' | 'user';

type SettingDefinition = {
  field: string;
  target: SettingTarget;
  type: 'number' | 'boolean' | 'string' | 'theme';
  label: string;
  aliases: string[];
};

const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    field: 'eurRate',
    target: 'store',
    type: 'number',
    label: 'EUR exchange rate',
    aliases: ['exchangeRate', 'eurRate', 'exchange_rate'],
  },
  {
    field: 'redirectToSumUp',
    target: 'store',
    type: 'boolean',
    label: 'SumUp redirect',
    aliases: ['sumUpRedirect', 'redirectToSumUp', 'sumup_redirect'],
  },
  {
    field: 'tipsEnabled',
    target: 'store',
    type: 'boolean',
    label: 'Tips enabled',
    aliases: ['tipsEnabled', 'tips'],
  },
  {
    field: 'iban',
    target: 'store',
    type: 'string',
    label: 'IBAN',
    aliases: ['iban'],
  },
  {
    field: 'companyName',
    target: 'store',
    type: 'string',
    label: 'Company name',
    aliases: ['companyName', 'company_name'],
  },
  {
    field: 'ico',
    target: 'store',
    type: 'string',
    label: 'Company ID (IČO)',
    aliases: ['ico'],
  },
  {
    field: 'companyAddress',
    target: 'store',
    type: 'string',
    label: 'Company address',
    aliases: ['companyAddress', 'company_address', 'address'],
  },
  {
    field: 'theme',
    target: 'user',
    type: 'theme',
    label: 'Theme',
    aliases: ['theme'],
  },
];

const SUPPORTED_SETTING_KEYS = SETTING_DEFINITIONS.flatMap((definition) => [
  definition.field,
  ...definition.aliases,
]);

function resolveSettingDefinition(settingKey: string): SettingDefinition | null {
  const normalized = settingKey.trim().toLowerCase();
  return (
    SETTING_DEFINITIONS.find(
      (definition) =>
        definition.field.toLowerCase() === normalized ||
        definition.aliases.some((alias) => alias.toLowerCase() === normalized)
    ) ?? null
  );
}

function formatSettingValue(value: unknown, definition: SettingDefinition): string {
  if (value === null || value === undefined || value === '') {
    return '(not set)';
  }

  if (definition.type === 'boolean') {
    return value ? 'enabled' : 'disabled';
  }

  if (definition.type === 'number' && typeof value === 'number') {
    if (definition.field === 'eurRate') {
      return `${value.toFixed(2)} CZK/EUR`;
    }
    return String(value);
  }

  return String(value);
}

function normalizeSettingValue(
  definition: SettingDefinition,
  rawValue: unknown
): { value?: string | number | boolean; error?: string } {
  if (rawValue === null || rawValue === undefined) {
    return { error: 'newValue is required.' };
  }

  switch (definition.type) {
    case 'number': {
      const parsed =
        typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim().replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { error: `${definition.label} must be a positive number.` };
      }
      return { value: parsed };
    }
    case 'boolean': {
      if (typeof rawValue === 'boolean') {
        return { value: rawValue };
      }
      const normalized = String(rawValue).trim().toLowerCase();
      if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) {
        return { value: true };
      }
      if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) {
        return { value: false };
      }
      return { error: `${definition.label} must be true or false.` };
    }
    case 'theme': {
      const normalized = String(rawValue).trim().toLowerCase();
      if (normalized === 'light' || normalized === 'dark' || normalized === 'auto') {
        return { value: normalized };
      }
      return { error: 'Theme must be light, dark, or auto.' };
    }
    case 'string':
    default:
      return { value: String(rawValue).trim() };
  }
}

function settingsValuesEqual(
  currentValue: unknown,
  nextValue: string | number | boolean,
  definition: SettingDefinition
): boolean {
  if (definition.type === 'number') {
    const currentNumber = typeof currentValue === 'number' ? currentValue : Number(currentValue);
    return Number.isFinite(currentNumber) && currentNumber === nextValue;
  }

  if (definition.type === 'boolean') {
    return Boolean(currentValue) === nextValue;
  }

  const currentString =
    currentValue === null || currentValue === undefined ? '' : String(currentValue).trim();
  return currentString === String(nextValue).trim();
}

async function getSettingCurrentValue(
  userId: string,
  storeId: string,
  definition: SettingDefinition
): Promise<unknown> {
  if (definition.target === 'store') {
    const storeDoc = await storeRef(userId, storeId).get();
    return storeDoc.data()?.[definition.field] ?? null;
  }

  const userDoc = await adminDb.collection('users').doc(userId).get();
  const settings = userDoc.data()?.settings as Record<string, unknown> | undefined;
  return settings?.[definition.field] ?? null;
}

type UpdateSettingsParams = {
  settingKey: string;
  newValue: unknown;
  confirmed?: boolean;
};

function buildUpdateSettingsPreviewMessage(
  definition: SettingDefinition,
  currentValue: unknown,
  nextValue: string | number | boolean
): string {
  return `You are about to change the ${definition.label} from ${formatSettingValue(currentValue, definition)} to ${formatSettingValue(nextValue, definition)}. Do you confirm?`;
}

async function executeUpdateSettings(userId: string, storeId: string, params: UpdateSettingsParams) {
  const definition = resolveSettingDefinition(params.settingKey);
  if (!definition) {
    return {
      updated: false,
      requiresConfirmation: false,
      error: `Unsupported settingKey "${params.settingKey}".`,
      message: `Unsupported settingKey "${params.settingKey}". Supported keys: ${SUPPORTED_SETTING_KEYS.join(', ')}.`,
      supportedKeys: SUPPORTED_SETTING_KEYS,
    };
  }

  const { value: nextValue, error: normalizationError } = normalizeSettingValue(
    definition,
    params.newValue
  );
  if (normalizationError || nextValue === undefined) {
    return {
      updated: false,
      requiresConfirmation: false,
      error: normalizationError ?? 'Invalid newValue.',
      message: normalizationError ?? 'Invalid newValue.',
    };
  }

  const currentValue = await getSettingCurrentValue(userId, storeId, definition);

  if (settingsValuesEqual(currentValue, nextValue, definition)) {
    return {
      updated: false,
      requiresConfirmation: false,
      settingKey: definition.field,
      currentValue,
      message: `No changes detected. ${definition.label} already matches the requested value.`,
    };
  }

  const previewMessage = buildUpdateSettingsPreviewMessage(definition, currentValue, nextValue);

  if (!params.confirmed) {
    return {
      updated: false,
      requiresConfirmation: true,
      settingKey: definition.field,
      label: definition.label,
      currentValue,
      newValue: nextValue,
      target: definition.target,
      message: previewMessage,
    };
  }

  if (definition.target === 'store') {
    await storeRef(userId, storeId).update({
      [definition.field]: nextValue,
      updatedAt: Timestamp.now(),
    });
  } else {
    await adminDb.collection('users').doc(userId).update({
      [`settings.${definition.field}`]: nextValue,
    });
  }

  return {
    updated: true,
    requiresConfirmation: false,
    settingKey: definition.field,
    label: definition.label,
    previousValue: currentValue,
    newValue: nextValue,
    target: definition.target,
    message: `${definition.label} was updated successfully.`,
  };
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
      id: chatId,
    }: { messages: UIMessage[]; storeId?: string; userId?: string; id?: string } =
      await req.json();

    const context: StoreContext = { storeId, userId };

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: buildSystemPrompt(),
      messages: await convertToModelMessages(messages),
      maxOutputTokens: 64000,
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
        getProductCost: tool({
          description:
            'Returns the purchase cost (nákupka) for products matching the given name. Supports exact and partial name matches.',
          inputSchema: z.object({
            productName: z.string().describe('Product name to search for (exact or partial match)'),
          }),
          execute: async ({ productName }) => {
            if (!context.storeId || !context.userId) {
              return {
                error: missingContextError(),
                query: productName,
                products: [] as ProductCostMatch[],
              };
            }

            try {
              const result = await fetchProductCost(context.userId, context.storeId, productName);

              if (result.products.length === 0) {
                return {
                  query: result.query,
                  products: [] as ProductCostMatch[],
                  message: `No products found matching "${result.query}".`,
                };
              }

              return {
                query: result.query,
                products: result.products,
                count: result.products.length,
              };
            } catch (error) {
              console.error('❌ getProductCost tool error:', error);
              return {
                error: 'Failed to load product cost from Firebase.',
                query: productName,
                products: [] as ProductCostMatch[],
              };
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
        updateProduct: tool({
          description:
            'Preview or apply updates to a product (name, price, cost). Always call first with confirmed=false to show planned changes and ask for user confirmation. Call again with confirmed=true only after the user explicitly approves.',
          inputSchema: z.object({
            productId: z.string().describe('Firestore document ID of the product to update'),
            updates: z
              .object({
                name: z.string().optional().describe('New product name'),
                price: z.number().nonnegative().optional().describe('New selling price in CZK'),
                cost: z.number().nonnegative().optional().describe('New purchase cost (nákupka) in CZK'),
              })
              .describe('Fields to change on the product'),
            confirmed: z
              .boolean()
              .default(false)
              .describe('Must be false for preview. Set true only after the user explicitly confirms the update.'),
          }),
          execute: async ({ productId, updates, confirmed }) => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), updated: false };
            }

            try {
              return await executeUpdateProduct(context.userId, context.storeId, {
                productId,
                updates,
                confirmed,
              });
            } catch (error) {
              console.error('❌ updateProduct tool error:', error);
              return {
                updated: false,
                error: 'Failed to update product.',
                message: 'Failed to update product.',
              };
            }
          },
        }),
        createProduct: tool({
          description:
            'Preview or create a new product in the catalog. Always call first with confirmed=false to show a summary and ask for user confirmation. Call again with confirmed=true only after the user explicitly approves.',
          inputSchema: z.object({
            name: z.string().describe('Product name'),
            price: z.number().nonnegative().describe('Selling price in CZK'),
            cost: z.number().nonnegative().describe('Purchase cost (nákupka) in CZK'),
            category: z.string().optional().describe('Optional product category'),
            confirmed: z
              .boolean()
              .default(false)
              .describe('Must be false for preview. Set true only after the user explicitly confirms creation.'),
          }),
          execute: async ({ name, price, cost, category, confirmed }) => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), created: false };
            }

            try {
              return await executeCreateProduct(context.userId, context.storeId, {
                name,
                price,
                cost,
                category,
                confirmed,
              });
            } catch (error) {
              console.error('❌ createProduct tool error:', error);
              return {
                created: false,
                error: 'Failed to create product.',
                message: 'Failed to create product.',
              };
            }
          },
        }),
        togglePinnedItem: tool({
          description:
            'Pin or unpin a product in the POS quick-access menu. Always call first with confirmed=false to preview the action and ask for user confirmation. Call again with confirmed=true only after the user explicitly approves.',
          inputSchema: z.object({
            productId: z.string().describe('Firestore document ID of the product to pin or unpin'),
            confirmed: z
              .boolean()
              .default(false)
              .describe('Must be false for preview. Set true only after the user explicitly confirms the pin/unpin action.'),
          }),
          execute: async ({ productId, confirmed }) => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), toggled: false };
            }

            try {
              return await executeTogglePinnedItem(context.userId, context.storeId, {
                productId,
                confirmed,
              });
            } catch (error) {
              console.error('❌ togglePinnedItem tool error:', error);
              return {
                toggled: false,
                error: 'Failed to toggle pinned item.',
                message: 'Failed to toggle pinned item.',
              };
            }
          },
        }),
        addExtra: tool({
          description:
            'Preview or create a new extra/modifier option for POS products. Extras are stored in the products collection with isExtra=true. Always call first with confirmed=false to show a summary and ask for user confirmation. Call again with confirmed=true only after the user explicitly approves.',
          inputSchema: z.object({
            name: z.string().describe('Extra name, for example "Oat milk"'),
            price: z.number().nonnegative().describe('Extra price in CZK'),
            category: z.string().describe('Extra category, for example "milk" or "syrup"'),
            confirmed: z
              .boolean()
              .default(false)
              .describe('Must be false for preview. Set true only after the user explicitly confirms creation.'),
          }),
          execute: async ({ name, price, category, confirmed }) => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), created: false };
            }

            try {
              return await executeAddExtra(context.userId, context.storeId, {
                name,
                price,
                category,
                confirmed,
              });
            } catch (error) {
              console.error('❌ addExtra tool error:', error);
              return {
                created: false,
                error: 'Failed to create extra.',
                message: 'Failed to create extra.',
              };
            }
          },
        }),
        updateSettings: tool({
          description:
            'Preview or update POS/store configuration such as exchange rate, SumUp redirect, tips, IBAN, and billing details. Store settings are saved on the store document; theme is saved on the user document. Always call first with confirmed=false, then call again with confirmed=true only after explicit user approval.',
          inputSchema: z.object({
            settingKey: z
              .string()
              .describe(
                'Setting to change. Supported keys include exchangeRate, sumUpRedirect, tipsEnabled, iban, companyName, ico, companyAddress, theme.'
              ),
            newValue: z
              .union([z.string(), z.number(), z.boolean()])
              .describe('New value for the selected setting'),
            confirmed: z
              .boolean()
              .default(false)
              .describe('Must be false for preview. Set true only after the user explicitly confirms the change.'),
          }),
          execute: async ({ settingKey, newValue, confirmed }) => {
            if (!context.storeId || !context.userId) {
              return { error: missingContextError(), updated: false };
            }

            try {
              return await executeUpdateSettings(context.userId, context.storeId, {
                settingKey,
                newValue,
                confirmed,
              });
            } catch (error) {
              console.error('❌ updateSettings tool error:', error);
              return {
                updated: false,
                error: 'Failed to update settings.',
                message: 'Failed to update settings.',
              };
            }
          },
        }),
      },
      stopWhen: stepCountIs(20),
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      onFinish: async ({ messages: updatedMessages, isAborted }) => {
        if (isAborted || !chatId || !userId || !storeId) return;

        try {
          await saveChat({
            chatId,
            userId,
            storeId,
            messages: updatedMessages,
          });
        } catch (error) {
          console.error('❌ Failed to persist chat history:', error);
        }
      },
    });
  } catch (error) {
    console.error('❌ Error in chat API:', error);
    return new Response(JSON.stringify({ error: 'Chat API error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
