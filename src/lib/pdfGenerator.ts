import { Sale } from '@/types';

type ReceiptStoreData = {
  companyName?: string;
  ico?: string;
  companyAddress?: string;
};

const RECEIPT_WIDTH_MM = 58;
const CENTER_X = 29;
const PADDING_MM = 4;
const LINE_HEIGHT = 4.2;
const SECTION_SPACING = 2;
const DIVIDER_PADDING = 3;
const MIN_RECEIPT_HEIGHT_MM = 70;
const NAME_COL_GAP = 2;
const QTY_COL_WIDTH = 10;
const PRICE_COL_WIDTH = 22;

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
  return `${amount.toLocaleString('cs-CZ')} Kc`;
};

const formatCZKAmount = (amount: number) => `${amount.toLocaleString('cs-CZ')} Kc`;

const normalizePaymentMethod = (method: Sale['paymentMethod']) => {
  if (method === 'cash') return 'Hotovost';
  if (method === 'card') return 'Karta';
  if (method === 'qr') return 'QR platba';
  return 'Nezname';
};

const trimOrEmpty = (value?: string) => value?.trim() || '';

const removeDiacritics = (text?: string | null): string => {
  if (text === undefined || text === null) return '';
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
  const layout = getLayout();

  const measurementDoc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [RECEIPT_WIDTH_MM, 200],
    compress: true,
  });
  measurementDoc.setFont('helvetica', 'normal');

  let estimatedHeight = PADDING_MM;
  const addTextBlockHeight = (text: string, fontSize = 9, maxWidth = layout.contentWidth) => {
    const safeText = removeDiacritics(text);
    if (!safeText) return;
    measurementDoc.setFontSize(fontSize);
    const lines = measurementDoc.splitTextToSize(safeText, maxWidth);
    estimatedHeight += lines.length * LINE_HEIGHT;
  };

  const companyName = removeDiacritics(trimOrEmpty(store.companyName));
  const companyAddress = removeDiacritics(trimOrEmpty(store.companyAddress));
  const ico = removeDiacritics(trimOrEmpty(store.ico));

  addTextBlockHeight(companyName, 10);
  addTextBlockHeight(companyAddress, 8.4);
  addTextBlockHeight(ico ? `IC: ${ico}` : '', 8.4);
  addTextBlockHeight('Neplatce DPH', 8.4);
  estimatedHeight += SECTION_SPACING + DIVIDER_PADDING * 2;
  estimatedHeight += LINE_HEIGHT * 2 + SECTION_SPACING + DIVIDER_PADDING * 2;
  estimatedHeight += LINE_HEIGHT + DIVIDER_PADDING * 2;

  sale.items.forEach((item) => {
    measurementDoc.setFontSize(8.2);
    const nameLines = measurementDoc.splitTextToSize(
      removeDiacritics(item.productName || 'Polozka'),
      layout.nameWidth
    );
    estimatedHeight += Math.max(1, nameLines.length) * LINE_HEIGHT;
  });

  estimatedHeight += DIVIDER_PADDING * 2;
  estimatedHeight += LINE_HEIGHT + SECTION_SPACING;
  const discountAmount = sale.discountAmount ?? 0;
  if (discountAmount > 0) {
    estimatedHeight += LINE_HEIGHT * 2;
  }
  if (sale.currency === 'EUR' && sale.eurRate) {
    estimatedHeight += LINE_HEIGHT * 3;
  }
  estimatedHeight += LINE_HEIGHT + 1;
  estimatedHeight += LINE_HEIGHT + PADDING_MM;

  const calculatedHeight = Math.max(MIN_RECEIPT_HEIGHT_MM, Math.ceil(estimatedHeight));

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [RECEIPT_WIDTH_MM, calculatedHeight],
    compress: true,
  });
  doc.setFont('helvetica', 'normal');

  const pageWidth = doc.internal.pageSize.getWidth();

  let y = PADDING_MM + 2;
  const drawCentered = (text: string, size = 9, bold = false) => {
    const safeText = removeDiacritics(text);
    if (!safeText) return;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.text(safeText, CENTER_X, y, { align: 'center' });
    y += LINE_HEIGHT;
  };

  const drawLabelValue = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.4);
    doc.text(removeDiacritics(label), PADDING_MM, y);
    doc.setFont('helvetica', 'bold');
    doc.text(removeDiacritics(value), pageWidth - PADDING_MM, y, { align: 'right' });
    y += LINE_HEIGHT;
  };

  const drawDivider = () => {
    y += DIVIDER_PADDING;
    drawDividerLine(doc, y);
    y += DIVIDER_PADDING;
  };

  if (companyName) drawCentered(companyName, 10, true);
  if (companyAddress) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.4);
    const lines = doc.splitTextToSize(companyAddress, layout.contentWidth);
    lines.forEach((line: string) => {
      doc.text(line, CENTER_X, y, { align: 'center' });
      y += LINE_HEIGHT;
    });
  }
  if (ico) drawCentered(`IC: ${ico}`, 8.5);
  drawCentered('Neplatce DPH', 8.5, true);

  y += 1.5;
  drawDivider();

  const createdAt = toDate(sale.createdAt);
  drawLabelValue('Cislo dokladu', sale.documentId || sale.id);
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

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  doc.text('Polozka', PADDING_MM, y);
  doc.text('Ks', layout.qtyCenterX, y, { align: 'center' });
  doc.text('Cena', layout.priceRightX, y, { align: 'right' });
  y += LINE_HEIGHT;
  drawDivider();

  sale.items.forEach((item) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    const rowPrice = item.price * item.quantity;
    const wrappedName = doc.splitTextToSize(
      removeDiacritics(item.productName || 'Polozka'),
      layout.nameWidth
    );
    wrappedName.forEach((line: string, index: number) => {
      doc.text(removeDiacritics(line), PADDING_MM, y);
      if (index === 0) {
        doc.text(String(item.quantity), layout.qtyCenterX, y, { align: 'center' });
        doc.text(removeDiacritics(formatCZKAmount(rowPrice)), layout.priceRightX, y, { align: 'right' });
      }
      y += LINE_HEIGHT;
    });
  });

  drawDivider();
  y += 1;

  if (discountAmount > 0) {
    const subtotal = sale.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discountLabel =
      sale.discount?.type === 'percentage' ? `Sleva ${sale.discount.value}%` : 'Sleva';
    drawLabelValue('Mezisoucet', formatCZKAmount(subtotal));
    drawLabelValue(discountLabel, `-${formatCZKAmount(discountAmount)}`);
  }

  drawLabelValue('Zpusob uhrady', normalizePaymentMethod(sale.paymentMethod));
  if (sale.currency === 'EUR' && sale.eurRate) {
    const amountInCZK = sale.originalAmountCZK ?? sale.totalAmount * sale.eurRate;
    drawLabelValue('Kurz', `${sale.eurRate.toFixed(2)} Kc/EUR`);
    drawLabelValue('Castka v Kc', formatCZKAmount(amountInCZK));
    drawLabelValue('Castka v EUR', `${sale.totalAmount.toFixed(2)} EUR`);
  }

  const tip = sale.tipAmount ?? 0;
  const totalWithoutTip = Math.max(0, sale.totalAmount - tip);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text('CELKEM', PADDING_MM, y + 1);
  doc.text(removeDiacritics(formatAmount(totalWithoutTip, sale.currency)), pageWidth - PADDING_MM, y + 1, { align: 'right' });
  y += LINE_HEIGHT + 1;

  y += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Dekujeme za vas nakup', CENTER_X, y, { align: 'center' });

  return doc.output('blob');
};
