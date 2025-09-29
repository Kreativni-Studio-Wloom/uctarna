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
          .stats-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 15px; margin: 20px 0; }
          .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #e9ecef; }
          .stat-value { font-size: 24px; font-weight: bold; color: #28a745; margin-bottom: 5px; }
          .stat-label { font-size: 14px; color: #666; }
          .cash-value { color: #ffc107; }
          .card-value { color: #6f42c1; }
          .customer-value { color: #007bff; }
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
            
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-value">${reportData.totalSales.toLocaleString('cs-CZ')} Kč</div>
                <div class="stat-label">Celková tržba</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-value cash-value">${reportData.salesInCZK.toLocaleString('cs-CZ')} Kč</div>
                <div class="stat-label">Koruny (po vrácení)</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-value card-value">${reportData.salesInEUR.toFixed(2)} €</div>
                <div class="stat-label">Eura (vybrané)</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-value">${reportData.totalProfit.toLocaleString('cs-CZ')} Kč</div>
                <div class="stat-label">Zisk</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-value customer-value">${reportData.customerCount}</div>
                <div class="stat-label">Počet zákazníků</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-value" style="color: #dc3545;">${(reportData.totalDiscounts || 0).toLocaleString('cs-CZ')} Kč</div>
                <div class="stat-label">Slevy</div>
                <div style="font-size: 12px; color: #666; margin-top: 5px;">${reportData.salesWithDiscount || 0} prodejů</div>
              </div>
            </div>
            
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
