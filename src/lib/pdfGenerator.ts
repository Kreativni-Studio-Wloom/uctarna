import { Sale } from '@/types';

type ReceiptStoreData = {
  companyName?: string;
  ico?: string;
  companyAddress?: string;
};

const RECEIPT_WIDTH_MM = 80;
const CENTER_X = 40;
const PADDING_MM = 5;
const LINE_HEIGHT = 4.2;
const SECTION_SPACING = 2;
const DIVIDER_PADDING = 3;
const MIN_RECEIPT_HEIGHT_MM = 70;
const FONT_REGULAR_FILE = 'Roboto-Regular.ttf';
const FONT_BOLD_FILE = 'Roboto-Bold.ttf';
const FONT_FAMILY = 'Roboto';
const NAME_COL_GAP = 2;
const QTY_COL_WIDTH = 10;
const PRICE_COL_WIDTH = 22;
const FONT_CDN_URLS = {
  regular: [
    'https://cdn.jsdelivr.net/npm/@fontsource/roboto/files/roboto-latin-ext-400-normal.ttf',
    'https://raw.githubusercontent.com/google/fonts/main/apache/roboto/Roboto-Regular.ttf',
  ],
  bold: [
    'https://cdn.jsdelivr.net/npm/@fontsource/roboto/files/roboto-latin-ext-700-normal.ttf',
    'https://raw.githubusercontent.com/google/fonts/main/apache/roboto/Roboto-Bold.ttf',
  ],
};

type FirestoreLikeTimestamp = {
  toDate: () => Date;
};

const isFirestoreLikeTimestamp = (value: unknown): value is FirestoreLikeTimestamp => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as FirestoreLikeTimestamp).toDate === 'function'
  );
};

const toDate = (value: unknown): Date => {
  if (value instanceof Date) return value;
  if (isFirestoreLikeTimestamp(value)) {
    return value.toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date();
};

const formatAmount = (amount: number, currency: Sale['currency']) => {
  if (currency === 'EUR') {
    return `${amount.toFixed(2)} EUR`;
  }
  return `${amount.toLocaleString('cs-CZ')} Kč`;
};

const normalizePaymentMethod = (method: Sale['paymentMethod']) => {
  if (method === 'cash') return 'Hotovost';
  if (method === 'card') return 'Karta';
  if (method === 'qr') return 'QR platba';
  return 'Neznámé';
};

const trimOrEmpty = (value?: string) => value?.trim() || '';

type FontPayload = {
  regularBase64: string;
  boldBase64: string;
};

let fontPayloadPromise: Promise<FontPayload | null> | null = null;

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const fetchFontAsBase64 = async (url: string): Promise<string> => {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Font fetch failed: ${response.status}`);
  return arrayBufferToBase64(await response.arrayBuffer());
};

const fetchFirstAvailableFontAsBase64 = async (urls: string[]): Promise<string> => {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      return await fetchFontAsBase64(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All font sources failed');
};

const loadRobotoFontPayload = async (): Promise<FontPayload | null> => {
  if (!fontPayloadPromise) {
    fontPayloadPromise = (async () => {
      try {
        const [regularBase64, boldBase64] = await Promise.all([
          fetchFirstAvailableFontAsBase64(FONT_CDN_URLS.regular),
          fetchFirstAvailableFontAsBase64(FONT_CDN_URLS.bold),
        ]);
        return { regularBase64, boldBase64 };
      } catch (error) {
        console.warn('Roboto font load failed, using fallback font.', error);
        return null;
      }
    })();
  }
  return fontPayloadPromise;
};

const registerRobotoFont = (doc: any, payload: FontPayload | null) => {
  if (!payload) {
    doc.setFont('helvetica', 'normal');
    return false;
  }

  try {
    doc.addFileToVFS(FONT_REGULAR_FILE, payload.regularBase64);
    doc.addFont(FONT_REGULAR_FILE, FONT_FAMILY, 'normal');
    doc.addFileToVFS(FONT_BOLD_FILE, payload.boldBase64);
    doc.addFont(FONT_BOLD_FILE, FONT_FAMILY, 'bold');
    doc.setFont(FONT_FAMILY, 'normal');
    return true;
  } catch (error) {
    console.warn('Roboto font registration failed, using fallback font.', error);
    doc.setFont('helvetica', 'normal');
    return false;
  }
};

const withFont = (doc: any, useRoboto: boolean, weight: 'normal' | 'bold') => {
  if (useRoboto) {
    doc.setFont(FONT_FAMILY, weight);
  } else {
    doc.setFont('helvetica', weight);
  }
};

const drawDividerLine = (doc: any, y: number) => {
  doc.setDrawColor(160);
  doc.setLineWidth(0.2);
  doc.line(PADDING_MM, y, RECEIPT_WIDTH_MM - PADDING_MM, y);
};

const getLayout = () => {
  const contentWidth = RECEIPT_WIDTH_MM - PADDING_MM * 2;
  const nameWidth = contentWidth - QTY_COL_WIDTH - PRICE_COL_WIDTH - NAME_COL_GAP * 2;
  const qtyCenterX = PADDING_MM + nameWidth + NAME_COL_GAP + QTY_COL_WIDTH / 2;
  const priceRightX = RECEIPT_WIDTH_MM - PADDING_MM;
  return { contentWidth, nameWidth, qtyCenterX, priceRightX };
};

export const generateReceiptPdfBlob = async (
  sale: Sale,
  store: ReceiptStoreData
): Promise<Blob> => {
  const { default: jsPDF } = await import('jspdf');
  const fontPayload = await loadRobotoFontPayload();
  const layout = getLayout();

  const measurementDoc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [RECEIPT_WIDTH_MM, 200],
    compress: true,
  });
  const hasCustomFont = registerRobotoFont(measurementDoc, fontPayload);

  let estimatedHeight = PADDING_MM;
  const addTextBlockHeight = (text: string, fontSize = 9, maxWidth = layout.contentWidth) => {
    if (!text) return;
    measurementDoc.setFontSize(fontSize);
    const lines = measurementDoc.splitTextToSize(text, maxWidth);
    estimatedHeight += lines.length * LINE_HEIGHT;
  };

  const companyName = trimOrEmpty(store.companyName);
  const companyAddress = trimOrEmpty(store.companyAddress);
  const ico = trimOrEmpty(store.ico);

  addTextBlockHeight(companyName, 10);
  addTextBlockHeight(companyAddress, 8.4);
  addTextBlockHeight(ico ? `IČ: ${ico}` : '', 8.4);
  addTextBlockHeight('Neplátce DPH', 8.4);
  estimatedHeight += SECTION_SPACING + DIVIDER_PADDING * 2;
  estimatedHeight += LINE_HEIGHT * 2 + SECTION_SPACING + DIVIDER_PADDING * 2;
  estimatedHeight += LINE_HEIGHT + DIVIDER_PADDING * 2;

  sale.items.forEach((item) => {
    measurementDoc.setFontSize(8.2);
    const nameLines = measurementDoc.splitTextToSize(item.productName || 'Položka', layout.nameWidth);
    estimatedHeight += Math.max(1, nameLines.length) * LINE_HEIGHT;
  });

  estimatedHeight += DIVIDER_PADDING * 2;
  estimatedHeight += LINE_HEIGHT + SECTION_SPACING;
  estimatedHeight += LINE_HEIGHT + 1;
  estimatedHeight += LINE_HEIGHT + PADDING_MM;

  const calculatedHeight = Math.max(MIN_RECEIPT_HEIGHT_MM, Math.ceil(estimatedHeight));

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [RECEIPT_WIDTH_MM, calculatedHeight],
    compress: true,
  });
  registerRobotoFont(doc, hasCustomFont ? fontPayload : null);

  const pageWidth = doc.internal.pageSize.getWidth();

  let y = PADDING_MM + 2;
  const drawCentered = (text: string, size = 9, bold = false) => {
    if (!text) return;
    withFont(doc, hasCustomFont, bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.text(text, CENTER_X, y, { align: 'center' });
    y += LINE_HEIGHT;
  };

  const drawLabelValue = (label: string, value: string) => {
    withFont(doc, hasCustomFont, 'normal');
    doc.setFontSize(8.4);
    doc.text(label, PADDING_MM, y);
    withFont(doc, hasCustomFont, 'bold');
    doc.text(value, pageWidth - PADDING_MM, y, { align: 'right' });
    y += LINE_HEIGHT;
  };

  const drawDivider = () => {
    y += DIVIDER_PADDING;
    drawDividerLine(doc, y);
    y += DIVIDER_PADDING;
  };

  if (companyName) drawCentered(companyName, 10, true);
  if (companyAddress) {
    withFont(doc, hasCustomFont, 'normal');
    doc.setFontSize(8.4);
    const lines = doc.splitTextToSize(companyAddress, layout.contentWidth);
    lines.forEach((line: string) => {
      doc.text(line, CENTER_X, y, { align: 'center' });
      y += LINE_HEIGHT;
    });
  }
  if (ico) drawCentered(`IČ: ${ico}`, 8.5);
  drawCentered('Neplátce DPH', 8.5, true);

  y += 1.5;
  drawDivider();

  const createdAt = toDate(sale.createdAt);
  drawLabelValue('Číslo dokladu', sale.documentId || sale.id);
  drawLabelValue(
    'Datum',
    new Intl.DateTimeFormat('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(createdAt)
  );

  y += 1;
  drawDivider();

  withFont(doc, hasCustomFont, 'bold');
  doc.setFontSize(8.4);
  doc.text('Položka', PADDING_MM, y);
  doc.text('Ks', layout.qtyCenterX, y, { align: 'center' });
  doc.text('Cena', layout.priceRightX, y, { align: 'right' });
  y += LINE_HEIGHT;
  drawDivider();

  sale.items.forEach((item) => {
    withFont(doc, hasCustomFont, 'normal');
    doc.setFontSize(8.2);
    const rowPrice = item.price * item.quantity;
    const wrappedName = doc.splitTextToSize(item.productName || 'Položka', layout.nameWidth);
    wrappedName.forEach((line: string, index: number) => {
      doc.text(line, PADDING_MM, y);
      if (index === 0) {
        doc.text(String(item.quantity), layout.qtyCenterX, y, { align: 'center' });
        doc.text(formatAmount(rowPrice, sale.currency), layout.priceRightX, y, { align: 'right' });
      }
      y += LINE_HEIGHT;
    });
  });

  drawDivider();
  y += 1;

  drawLabelValue('Způsob úhrady', normalizePaymentMethod(sale.paymentMethod));

  withFont(doc, hasCustomFont, 'bold');
  doc.setFontSize(12.5);
  doc.text('CELKEM', PADDING_MM, y + 1);
  doc.text(formatAmount(sale.totalAmount, sale.currency), pageWidth - PADDING_MM, y + 1, { align: 'right' });
  y += LINE_HEIGHT + 1;

  y += 2;
  withFont(doc, hasCustomFont, 'bold');
  doc.setFontSize(9);
  doc.text('Děkujeme za váš nákup', CENTER_X, y, { align: 'center' });

  return doc.output('blob');
};
