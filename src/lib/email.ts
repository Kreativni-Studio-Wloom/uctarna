// Tento modul poskytuje pouze generování obsahu e-mailu pro uzávěrky.

// Interface pro report data
export interface ReportData {
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
  products: Array<{
    id: string;
    name: string;
    price: number;
    cost?: number;
  }>;
  sales: Array<{
    createdAt: Date | string;
    items?: Array<{
      productId: string;
      productName: string;
      quantity: number;
      price: number;
    }>;
    paymentMethod: string;
    totalAmount: number;
  }>;
}

// Funkce pro generování email obsahu
export function generateEmailContent(reportData: ReportData, actionName?: string) {
  // Vytvoření mapy produktů pro rychlé vyhledávání nákladů
  const productMap = new Map(reportData.products.map(p => [p.id, p]));
  
  // Agregace všech prodaných položek s výpočtem zisku
  const productSummary = new Map<string, { 
    quantity: number; 
    totalPrice: number; 
    price: number; 
    totalCost: number; 
    totalProfit: number; 
  }>();
  
  reportData.sales.forEach((sale) => {
    sale.items?.forEach((item) => {
      const key = item.productName;
      const product = productMap.get(item.productId);
      const itemCost = product?.cost || 0;
      const itemProfit = (item.price - itemCost) * item.quantity;
      
      const existing = productSummary.get(key);
      
      if (existing) {
        existing.quantity += item.quantity;
        existing.totalPrice += item.quantity * item.price;
        existing.totalCost += itemCost * item.quantity;
        existing.totalProfit += itemProfit;
      } else {
        productSummary.set(key, {
          quantity: item.quantity,
          totalPrice: item.quantity * item.price,
          price: item.price,
          totalCost: itemCost * item.quantity,
          totalProfit: itemProfit
        });
      }
    });
  });

  // Agregace prodejů dle způsobu platby
  const numCardSales = reportData.sales.filter(s => s.paymentMethod === 'card').length;
  const numCashSales = reportData.sales.filter(s => s.paymentMethod === 'cash').length;
  const numQrSales = reportData.sales.filter(s => s.paymentMethod === 'qr').length;

  // Vytvoření řádků pro souhrn položek
  const productSummaryRows = Array.from(productSummary.entries())
    .sort((a, b) => b[1].totalPrice - a[1].totalPrice) // Seřadit podle celkové hodnoty (sestupně)
    .map(([productName, summary]) => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: bold;">${summary.quantity}x ${productName}</td>
        <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">${summary.price.toLocaleString('cs-CZ')} Kč</td>
        <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: bold; color: #28a745;">${summary.totalPrice.toLocaleString('cs-CZ')} Kč</td>
        <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: bold;">${summary.totalProfit.toLocaleString('cs-CZ')} Kč</td>
      </tr>
    `).join('');

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
          .stats-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 15px; margin: 20px 0; }
          .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #e9ecef; }
          .stat-value { font-size: 24px; font-weight: bold; color: #28a745; margin-bottom: 5px; }
          .stat-label { font-size: 14px; color: #666; }
          .cash-value { color: #ffc107; }
          .card-value { color: #6f42c1; }
          .customer-value { color: #007bff; }
          .muted { font-size: 12px; color: #666; margin-top: 5px; }
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
            <p>${reportData.period === 'Denní' 
              ? `Denní uzávěrka z ${reportData.startDate}`
              : reportData.period === 'Měsíční' 
                ? `Uzávěrka za měsíc ${reportData.startDate}`
                : `Celková uzávěrka od ${reportData.startDate} do ${reportData.endDate}`}</p>
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
                  <div style="font-size:12px; color:#666; margin-top:5px;">${numCardSales} prodejů</div>
                </td>
              </tr>
              <tr>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#ffc107; margin-bottom:5px;">${reportData.cashSales.toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">Hotovost</div>
                  <div style="font-size:12px; color:#666; margin-top:5px;">${numCashSales} prodejů</div>
                </td>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#0d6efd; margin-bottom:5px;">${reportData.qrSales.toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">QR kód</div>
                  <div style="font-size:12px; color:#666; margin-top:5px;">${numQrSales} prodejů</div>
                </td>
              </tr>
              <tr>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#dc3545; margin-bottom:5px;">${(reportData.totalDiscounts || 0).toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">Slevy</div>
                  <div style="font-size:12px; color:#666; margin-top:5px;">${reportData.salesWithDiscount || 0} prodejů</div>
                </td>
                <td style="background:#f8f9fa; padding:15px; border:1px solid #e9ecef; text-align:center; width:50%;">
                  <div style="font-size:24px; font-weight:bold; color:#28a745; margin-bottom:5px;">${reportData.totalProfit.toLocaleString('cs-CZ')} Kč</div>
                  <div style="font-size:14px; color:#666;">Zisk</div>
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
              <p><strong>Období:</strong> ${reportData.period === 'Denní' 
                ? `Denní uzávěrka z ${reportData.startDate}`
                : reportData.period === 'Měsíční' 
                  ? `Uzávěrka za měsíc ${reportData.startDate}`
                  : `Celková uzávěrka od ${reportData.startDate} do ${reportData.endDate}`}</p>
              <p><strong>Celková tržba:</strong> ${reportData.totalSales.toLocaleString('cs-CZ')} Kč</p>
              <p><strong>Koruny (po vrácení):</strong> ${reportData.salesInCZK.toLocaleString('cs-CZ')} Kč</p>
              <p><strong>Eura (vybrané):</strong> ${reportData.salesInEUR.toFixed(2)} €</p>
              <p><strong>Karty:</strong> ${reportData.cardSales.toLocaleString('cs-CZ')} Kč (${numCardSales} prodejů)</p>
              <p><strong>Hotovost:</strong> ${reportData.cashSales.toLocaleString('cs-CZ')} Kč (${numCashSales} prodejů)</p>
              <p><strong>QR kód:</strong> ${reportData.qrSales.toLocaleString('cs-CZ')} Kč (${numQrSales} prodejů)</p>
              <p><strong>Zisk:</strong> ${reportData.totalProfit.toLocaleString('cs-CZ')} Kč</p>
              <p><strong>Počet různých produktů:</strong> ${productSummary.size}</p>
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

Období: ${reportData.period === 'Denní' 
  ? `Denní uzávěrka z ${reportData.startDate}`
  : reportData.period === 'Měsíční' 
    ? `Uzávěrka za měsíc ${reportData.startDate}`
    : `Celková uzávěrka od ${reportData.startDate} do ${reportData.endDate}`}

📊 STATISTIKY:
- Celková tržba: ${reportData.totalSales.toLocaleString('cs-CZ')} Kč
- Počet zákazníků: ${reportData.customerCount}
- Koruny (po vrácení): ${reportData.salesInCZK.toLocaleString('cs-CZ')} Kč
- Eura (vybrané): ${reportData.salesInEUR.toFixed(2)} €
- Karty: ${reportData.cardSales.toLocaleString('cs-CZ')} Kč (${numCardSales} prodejů)
- Hotovost: ${reportData.cashSales.toLocaleString('cs-CZ')} Kč (${numCashSales} prodejů)
- QR kód: ${reportData.qrSales.toLocaleString('cs-CZ')} Kč (${numQrSales} prodejů)
- Zisk: ${reportData.totalProfit.toLocaleString('cs-CZ')} Kč
- Slevy: ${(reportData.totalDiscounts || 0).toLocaleString('cs-CZ')} Kč (${reportData.salesWithDiscount || 0} prodejů)
- Počet různých produktů: ${productSummary.size}

📋 SOUHRN PRODANÝCH POLOŽEK:
${Array.from(productSummary.entries())
  .sort((a, b) => b[1].totalPrice - a[1].totalPrice)
  .map(([productName, summary]) => 
    `${summary.quantity}x ${productName} - ${summary.totalPrice.toLocaleString('cs-CZ')} Kč (zisk: ${summary.totalProfit.toLocaleString('cs-CZ')} Kč)`
  ).join('\n')}

---
Uzávěrka vygenerována automaticky dne ${new Date().toLocaleDateString('cs-CZ')}
Účtárna - Profesionální prodejní systém
    `
  };
}
