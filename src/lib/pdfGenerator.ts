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

// ----------------------------------------------------------------------------
// Souhrnný PDF report: seznam všech dokladů za vybraný den (formát A4)
// ----------------------------------------------------------------------------

const A4_MARGIN = 15;

const formatReportDate = (date: Date) =>
  new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);

const formatReportTime = (date: Date) =>
  new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

const czkEquivalent = (sale: Sale): number => {
  if (sale.currency === 'EUR') {
    return sale.originalAmountCZK ?? sale.totalAmount * (sale.eurRate ?? 0);
  }
  return sale.totalAmount;
};

export const generateDailySalesReportPdfBlob = async (
  sales: Sale[],
  store: ReceiptStoreData,
  reportDate: Date
): Promise<Blob> => {
  const { default: jsPDF } = await import('jspdf');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  doc.setFont('helvetica', 'normal');

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - A4_MARGIN * 2;
  const leftX = A4_MARGIN;
  const rightX = pageWidth - A4_MARGIN;

  // Rozložení sloupců pro položky dokladu
  const PRICE_COL = 32;
  const QTY_COL = 16;
  const COL_GAP = 3;
  const nameColWidth = contentWidth - PRICE_COL - QTY_COL - COL_GAP * 2;
  const qtyRightX = leftX + nameColWidth + COL_GAP + QTY_COL;

  let y = A4_MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - A4_MARGIN) {
      doc.addPage();
      y = A4_MARGIN;
    }
  };

  const divider = (padding = 2) => {
    y += padding;
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.line(leftX, y, rightX, y);
    y += padding;
  };

  // ---- Hlavička s údaji o firmě ----
  const companyName = removeDiacritics(trimOrEmpty(store.companyName)) || 'Prodejna';
  const companyAddress = removeDiacritics(trimOrEmpty(store.companyAddress));
  const ico = removeDiacritics(trimOrEmpty(store.ico));

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(companyName, leftX, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  if (companyAddress) {
    doc.text(companyAddress, leftX, y);
    y += 4.5;
  }
  const identLine = [ico ? `IC: ${ico}` : '', 'Neplatce DPH'].filter(Boolean).join('   |   ');
  if (identLine) {
    doc.text(identLine, leftX, y);
    y += 4.5;
  }

  // ---- Titulek reportu ----
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Seznam dokladu za den', leftX, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(removeDiacritics(formatReportDate(reportDate)), leftX, y);
  y += 4;
  doc.setFontSize(8.5);
  doc.setTextColor(120);
  doc.text(
    removeDiacritics(`Vygenerovano: ${formatReportDate(new Date())} ${formatReportTime(new Date())}`),
    leftX,
    y
  );
  doc.setTextColor(0);
  y += 3;

  divider(3);

  // ---- Souhrn ----
  const sorted = [...sales].sort(
    (a, b) => toDate(a.createdAt).getTime() - toDate(b.createdAt).getTime()
  );

  const totalCount = sorted.length;
  let czkTotal = 0;
  let eurTotal = 0;
  let cashCzk = 0;
  let cardCzk = 0;
  let qrCzk = 0;
  let tipTotalCzk = 0;
  let discountTotalCzk = 0;
  let refundCount = 0;

  sorted.forEach((sale) => {
    const czk = czkEquivalent(sale);
    if (sale.currency === 'EUR') eurTotal += sale.totalAmount;
    czkTotal += czk;
    if (sale.paymentMethod === 'cash') cashCzk += czk;
    else if (sale.paymentMethod === 'card') cardCzk += czk;
    else if (sale.paymentMethod === 'qr') qrCzk += czk;
    if (typeof sale.tipAmount === 'number' && sale.tipAmount > 0) {
      tipTotalCzk += sale.currency === 'EUR' ? sale.tipAmount * (sale.eurRate ?? 0) : sale.tipAmount;
    }
    if (typeof sale.discountAmount === 'number') discountTotalCzk += sale.discountAmount;
    if (sale.isRefund) refundCount += 1;
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Souhrn', leftX, y);
  y += 5;

  const summaryRow = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 10.5 : 9.5);
    doc.text(removeDiacritics(label), leftX, y);
    doc.text(removeDiacritics(value), rightX, y, { align: 'right' });
    y += bold ? 5.5 : 4.8;
  };

  summaryRow('Pocet dokladu', String(totalCount));
  if (refundCount > 0) summaryRow('z toho vratky', String(refundCount));
  summaryRow('Hotovost', formatCZKAmount(cashCzk));
  summaryRow('Karta', formatCZKAmount(cardCzk));
  summaryRow('QR platba', formatCZKAmount(qrCzk));
  if (discountTotalCzk > 0) summaryRow('Slevy celkem', `-${formatCZKAmount(discountTotalCzk)}`);
  if (tipTotalCzk > 0) summaryRow('Spropitne celkem', formatCZKAmount(tipTotalCzk));
  if (eurTotal !== 0) summaryRow('Trzby v EUR', `${eurTotal.toFixed(2)} EUR`);
  summaryRow('Trzba celkem', formatCZKAmount(czkTotal), true);

  divider(3);

  // ---- Detailní seznam dokladů ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  ensureSpace(10);
  doc.text('Doklady', leftX, y);
  y += 6;

  if (sorted.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Za tento den nejsou zadne doklady.', leftX, y);
    y += 6;
  }

  sorted.forEach((sale, index) => {
    const createdAt = toDate(sale.createdAt);

    // Odhad výšky bloku dokladu, aby se nezalomil uprostřed
    const estimatedRows = sale.items.reduce((sum, item) => {
      const lines = doc.splitTextToSize(
        removeDiacritics(item.productName || 'Polozka'),
        nameColWidth
      ).length;
      return sum + Math.max(1, lines);
    }, 0);
    const estimatedBlockHeight = 16 + estimatedRows * 4.4 + 14;
    ensureSpace(Math.min(estimatedBlockHeight, pageHeight - A4_MARGIN * 2));

    // Záhlaví dokladu: číslo + datum/čas
    doc.setFillColor(243, 244, 246);
    doc.rect(leftX, y - 4, contentWidth, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(
      removeDiacritics(`${index + 1}. Doklad c. ${sale.documentId || sale.id}`),
      leftX + 1.5,
      y
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      removeDiacritics(
        `${new Intl.DateTimeFormat('cs-CZ', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }).format(createdAt)} ${formatReportTime(createdAt)}`
      ),
      rightX - 1.5,
      y,
      { align: 'right' }
    );
    y += 6;

    // Meta řádek: platba, měna, zákazník, vratka
    const metaParts: string[] = [normalizePaymentMethod(sale.paymentMethod)];
    if (sale.currency === 'EUR') metaParts.push('EUR');
    if (sale.customerName) metaParts.push(`Jmeno: ${sale.customerName}`);
    if (sale.isRefund) metaParts.push('VRATKA');
    if (sale.paymentMethod === 'card' && sale.sumUpData?.sumUpTxCode) {
      metaParts.push(`SumUp: ${sale.sumUpData.sumUpTxCode}`);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(90);
    const metaLines = doc.splitTextToSize(
      removeDiacritics(metaParts.join('  •  ')),
      contentWidth
    );
    metaLines.forEach((line: string) => {
      doc.text(line, leftX, y);
      y += 4;
    });
    doc.setTextColor(0);

    // Hlavička sloupců položek
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.text('Polozka', leftX, y);
    doc.text('Ks', qtyRightX, y, { align: 'right' });
    doc.text('Cena', rightX, y, { align: 'right' });
    y += 4;

    // Položky
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.6);
    sale.items.forEach((item) => {
      const rowPrice = item.price * item.quantity;
      const wrapped = doc.splitTextToSize(
        removeDiacritics(item.productName || 'Polozka'),
        nameColWidth
      );
      ensureSpace(wrapped.length * 4.4 + 4);
      wrapped.forEach((line: string, i: number) => {
        doc.text(line, leftX, y);
        if (i === 0) {
          doc.text(String(item.quantity), qtyRightX, y, { align: 'right' });
          doc.text(removeDiacritics(formatCZKAmount(rowPrice)), rightX, y, { align: 'right' });
        }
        y += 4.2;
      });
    });

    // Sleva / spropitné / celkem
    y += 1;
    if (typeof sale.discountAmount === 'number' && sale.discountAmount > 0) {
      const discountLabel =
        sale.discount?.type === 'percentage' ? `Sleva ${sale.discount.value}%` : 'Sleva';
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.6);
      doc.text(removeDiacritics(discountLabel), leftX, y);
      doc.text(`-${removeDiacritics(formatCZKAmount(sale.discountAmount))}`, rightX, y, {
        align: 'right',
      });
      y += 4.2;
    }
    if (typeof sale.tipAmount === 'number' && sale.tipAmount > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.6);
      doc.text('Spropitne', leftX, y);
      doc.text(
        removeDiacritics(
          sale.currency === 'EUR' ? `${sale.tipAmount.toFixed(2)} EUR` : formatCZKAmount(sale.tipAmount)
        ),
        rightX,
        y,
        { align: 'right' }
      );
      y += 4.2;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Celkem', leftX, y);
    let totalText = formatAmount(sale.totalAmount, sale.currency);
    if (sale.currency === 'EUR' && sale.originalAmountCZK) {
      totalText += ` (${formatCZKAmount(sale.originalAmountCZK)})`;
    }
    doc.text(removeDiacritics(totalText), rightX, y, { align: 'right' });
    y += 4.5;

    divider(2.5);
  });

  // ---- Číslování stránek ----
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(`Strana ${i} / ${pageCount}`, rightX, pageHeight - 8, { align: 'right' });
    doc.text(removeDiacritics(companyName), leftX, pageHeight - 8);
    doc.setTextColor(0);
  }

  return doc.output('blob');
};
