// Tento modul poskytuje pouze generování obsahu e-mailu pro uzávěrky.

export interface ProductSummaryRow {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  totalProfit: number;
}

export interface EmailReportData {
  storeName: string;
  period: string;
  startDate: string;
  endDate: string;
  totalSales: number;
  salesInCZK: number;
  salesInEUR: number;
  cashSales: number;
  cardSales: number;
  qrSales: number;
  customerCount: number;
  totalCosts: number;
  totalProfit: number;
  totalDiscounts?: number;
  salesWithDiscount?: number;
  totalTips?: number;
  numCashSales: number;
  numCardSales: number;
  numQrSales: number;
  productSummary: ProductSummaryRow[];
}

type SaleItemForEmail = {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
};

type SaleForEmail = {
  items?: SaleItemForEmail[];
  paymentMethod: string;
};

type ProductCostLookup = {
  id: string;
  cost?: number;
};

export function buildEmailReportData(
  meta: Pick<EmailReportData, 'storeName' | 'period' | 'startDate' | 'endDate'>,
  totals: Pick<
    EmailReportData,
    | 'totalSales'
    | 'salesInCZK'
    | 'salesInEUR'
    | 'cashSales'
    | 'cardSales'
    | 'qrSales'
    | 'customerCount'
    | 'totalCosts'
    | 'totalProfit'
    | 'totalDiscounts'
    | 'salesWithDiscount'
    | 'totalTips'
  >,
  sales: SaleForEmail[],
  products: ProductCostLookup[]
): EmailReportData {
  const productMap = new Map(products.map((product) => [product.id, product]));
  const summaryMap = new Map<string, ProductSummaryRow>();

  sales.forEach((sale) => {
    sale.items?.forEach((item) => {
      const itemCost = productMap.get(item.productId)?.cost || 0;
      const totalPrice = item.quantity * item.price;
      const totalProfit = (item.price - itemCost) * item.quantity;
      const existing = summaryMap.get(item.productName);

      if (existing) {
        existing.quantity += item.quantity;
        existing.totalPrice += totalPrice;
        existing.totalProfit += totalProfit;
        return;
      }

      summaryMap.set(item.productName, {
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.price,
        totalPrice,
        totalProfit,
      });
    });
  });

  return {
    ...meta,
    ...totals,
    numCashSales: sales.filter((sale) => sale.paymentMethod === 'cash').length,
    numCardSales: sales.filter((sale) => sale.paymentMethod === 'card').length,
    numQrSales: sales.filter((sale) => sale.paymentMethod === 'qr').length,
    productSummary: Array.from(summaryMap.values()).sort((a, b) => b.totalPrice - a.totalPrice),
  };
}

function formatPeriodLabel(reportData: EmailReportData) {
  if (reportData.period === 'Denní') {
    return `Denní uzávěrka z ${reportData.startDate}`;
  }
  if (reportData.period === 'Měsíční') {
    return `Uzávěrka za měsíc ${reportData.startDate}`;
  }
  if (reportData.period === 'Vlastní období') {
    return `Uzávěrka ${reportData.startDate} – ${reportData.endDate}`;
  }
  return `Celková uzávěrka od ${reportData.startDate} do ${reportData.endDate}`;
}

export function generateEmailContent(reportData: EmailReportData, actionName?: string) {
  const periodLabel = formatPeriodLabel(reportData);
  const uniqueProductCount = reportData.productSummary.length;

  const productSummaryRows = reportData.productSummary
    .map((summary) => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: bold;">${summary.quantity}x ${summary.name}</td>
        <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">${summary.unitPrice.toLocaleString('cs-CZ')} Kč</td>
        <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: bold; color: #28a745;">${summary.totalPrice.toLocaleString('cs-CZ')} Kč</td>
        <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: bold;">${summary.totalProfit.toLocaleString('cs-CZ')} Kč</td>
      </tr>
    `)
    .join('');

  const productSummaryText = reportData.productSummary
    .map((summary) =>
      `${summary.quantity}x ${summary.name} - ${summary.totalPrice.toLocaleString('cs-CZ')} Kč (zisk: ${summary.totalProfit.toLocaleString('cs-CZ')} Kč)`
    )
    .join('\n');

  return {
    html: `
      <!DOCTYPE html>
      <html lang="cs">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${reportData.period} uzávěrka - ${reportData.storeName}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .header p { margin: 10px 0 0 0; opacity: 0.9; }
          .content { padding: 20px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background: #f8f9fa; padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; color: #495057; font-weight: bold; }
          td { padding: 12px; border-bottom: 1px solid #dee2e6; }
          .summary { background: #e9ecef; padding: 15px; border-radius: 8px; margin: 20px 0; }
          .footer { background: #e9ecef; padding: 20px; text-align: center; color: #6c757d; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${reportData.storeName}${actionName ? ` - ${actionName}` : ''}</h1>
            <p>${periodLabel}</p>
          </div>
          
          <div class="content">
            <h2>📊 Statistiky uzávěrky</h2>
            
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#28a745; margin-bottom:5px;">${reportData.totalSales.toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">Celková tržba</div>
                </td>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#ffc107; margin-bottom:5px;">${reportData.salesInCZK.toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">Koruny (po vrácení)</div>
                </td>
              </tr>
              <tr>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#6f42c1; margin-bottom:5px;">${reportData.salesInEUR.toFixed(2)} €</div>
                  <div style="font-size:14px; color:#666;">Eura (vybrané)</div>
                </td>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#28a745; margin-bottom:5px;">${reportData.totalProfit.toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">Zisk</div>
                </td>
              </tr>
              <tr>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#007bff; margin-bottom:5px;">${reportData.customerCount}</div>
                  <div style="font-size:14px; color:#666;">Počet zákazníků</div>
                </td>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#6f42c1; margin-bottom:5px;">${reportData.cardSales.toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">Karty</div>
                  <div style="font-size:12px; color:#666; margin-top:5px;">${reportData.numCardSales} prodejů</div>
                </td>
              </tr>
              <tr>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#ffc107; margin-bottom:5px;">${reportData.cashSales.toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">Hotovost</div>
                  <div style="font-size:12px; color:#666; margin-top:5px;">${reportData.numCashSales} prodejů</div>
                </td>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#0d6efd; margin-bottom:5px;">${reportData.qrSales.toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">QR kód</div>
                  <div style="font-size:12px; color:#666; margin-top:5px;">${reportData.numQrSales} prodejů</div>
                </td>
              </tr>
              <tr>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#dc3545; margin-bottom:5px;">${(reportData.totalDiscounts || 0).toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">Slevy</div>
                  <div style="font-size:12px; color:#666; margin-top:5px;">${reportData.salesWithDiscount || 0} prodejů</div>
                </td>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#d97706; margin-bottom:5px;">${(reportData.totalTips ?? 0).toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">Spropitné</div>
                </td>
              </tr>
            </table>
            
            <h3>📋 Souhrn prodaných položek</h3>
            <table>
              <thead>
                <tr>
                  <th>Položka</th>
                  <th>Cena za kus</th>
                  <th>Celková hodnota</th>
                  <th>Zisk</th>
                </tr>
              </thead>
              <tbody>
                ${productSummaryRows}
              </tbody>
            </table>
            <div class="summary">
              <h4>📊 Souhrn tržeb</h4>
              <p><strong>Období:</strong> ${periodLabel}</p>
              <p><strong>Celková tržba:</strong> ${reportData.totalSales.toLocaleString('cs-CZ')} Kč</p>
              <p><strong>Zisk:</strong> ${reportData.totalProfit.toLocaleString('cs-CZ')} Kč</p>
              <p><strong>Hotovost:</strong> ${reportData.cashSales.toLocaleString('cs-CZ')} Kč (${reportData.numCashSales} prodejů)</p>
              <p><strong>Karty:</strong> ${reportData.cardSales.toLocaleString('cs-CZ')} Kč (${reportData.numCardSales} prodejů)</p>
              <p><strong>QR kód:</strong> ${reportData.qrSales.toLocaleString('cs-CZ')} Kč (${reportData.numQrSales} prodejů)</p>
              <p><strong>Spropitné:</strong> ${(reportData.totalTips ?? 0).toLocaleString('cs-CZ')} Kč</p>
              <p><strong>Eura (vybrané):</strong> ${reportData.salesInEUR.toFixed(2)} €</p>
              <p><strong>Koruny (po vrácení):</strong> ${reportData.salesInCZK.toLocaleString('cs-CZ')} Kč</p>
              <p><strong>Počet různých produktů:</strong> ${uniqueProductCount}</p>
            </div>
          </div>
          
          <div class="footer">
            <p>Uzávěrka vygenerována automaticky dne ${new Date().toLocaleDateString('cs-CZ')}<br>
            <strong>Účtárna</strong> - Profesionální prodejní systém</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
${reportData.period} uzávěrka - ${reportData.storeName}${actionName ? ` - ${actionName}` : ''}

Období: ${periodLabel}

📊 STATISTIKY:
- Celková tržba: ${reportData.totalSales.toLocaleString('cs-CZ')} Kč
- Hotovost: ${reportData.cashSales.toLocaleString('cs-CZ')} Kč (${reportData.numCashSales} prodejů)
- Karty: ${reportData.cardSales.toLocaleString('cs-CZ')} Kč (${reportData.numCardSales} prodejů)
- QR kód: ${reportData.qrSales.toLocaleString('cs-CZ')} Kč (${reportData.numQrSales} prodejů)
- Zisk: ${reportData.totalProfit.toLocaleString('cs-CZ')} Kč
- Eura (vybrané): ${reportData.salesInEUR.toFixed(2)} €
- Koruny (po vrácení): ${reportData.salesInCZK.toLocaleString('cs-CZ')} Kč
- Zákazníci: ${reportData.customerCount}
- Slevy: ${(reportData.totalDiscounts || 0).toLocaleString('cs-CZ')} Kč (${reportData.salesWithDiscount || 0} prodejů)
- Počet různých produktů: ${uniqueProductCount}

📋 SOUHRN PRODANÝCH POLOŽEK:
${productSummaryText}

---
Uzávěrka vygenerována automaticky dne ${new Date().toLocaleDateString('cs-CZ')}
Účtárna - Profesionální prodejní systém
    `,
  };
}
