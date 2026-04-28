import { Sale } from '@/types';

type ReceiptStoreData = {
  companyName?: string;
  ico?: string;
  companyAddress?: string;
};

const RECEIPT_WIDTH_MM = 80;
const RECEIPT_HEIGHT_MM = 220;
const MARGIN_MM = 6;
const LINE_HEIGHT = 4.5;

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

export const generateReceiptPdfBlob = async (
  sale: Sale,
  store: ReceiptStoreData
): Promise<Blob> => {
  const { default: jsPDF } = await import('jspdf');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [RECEIPT_WIDTH_MM, RECEIPT_HEIGHT_MM],
    compress: true,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN_MM * 2;

  let y = 9;
  const drawCentered = (text: string, size = 9, bold = false) => {
    if (!text) return;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.text(text, pageWidth / 2, y, { align: 'center' });
    y += LINE_HEIGHT;
  };

  const drawLabelValue = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(label, MARGIN_MM, y);
    doc.setFont('helvetica', 'bold');
    doc.text(value, pageWidth - MARGIN_MM, y, { align: 'right' });
    y += LINE_HEIGHT;
  };

  const drawDivider = () => {
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_MM, y, pageWidth - MARGIN_MM, y);
    y += 2.5;
  };

  const companyName = trimOrEmpty(store.companyName);
  const companyAddress = trimOrEmpty(store.companyAddress);
  const ico = trimOrEmpty(store.ico);

  if (companyName) drawCentered(companyName, 10, true);
  if (companyAddress) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(companyAddress, contentWidth);
    lines.forEach((line: string) => {
      doc.text(line, pageWidth / 2, y, { align: 'center' });
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

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Položka', MARGIN_MM, y);
  doc.text('Ks', pageWidth - MARGIN_MM - 20, y, { align: 'right' });
  doc.text('Cena', pageWidth - MARGIN_MM, y, { align: 'right' });
  y += LINE_HEIGHT;
  drawDivider();

  sale.items.forEach((item) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    const rowPrice = item.price * item.quantity;
    const wrappedName = doc.splitTextToSize(item.productName || 'Položka', contentWidth - 24);
    wrappedName.forEach((line: string, index: number) => {
      if (y >= pageHeight - 24) return;
      doc.text(line, MARGIN_MM, y);
      if (index === 0) {
        doc.text(String(item.quantity), pageWidth - MARGIN_MM - 20, y, { align: 'right' });
        doc.text(formatAmount(rowPrice, sale.currency), pageWidth - MARGIN_MM, y, { align: 'right' });
      }
      y += LINE_HEIGHT;
    });
  });

  drawDivider();
  y += 1;

  drawLabelValue('Způsob úhrady', normalizePaymentMethod(sale.paymentMethod));

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('CELKEM', MARGIN_MM, y + 1);
  doc.text(formatAmount(sale.totalAmount, sale.currency), pageWidth - MARGIN_MM, y + 1, { align: 'right' });
  y += LINE_HEIGHT + 1;

  y += 2;
  drawCentered('Děkujeme za váš nákup', 9, true);

  return doc.output('blob');
};
