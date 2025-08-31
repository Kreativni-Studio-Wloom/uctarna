"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testFunction = exports.generateReportPDF = exports.testAuth = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const date_fns_1 = require("date-fns");
const locale_1 = require("date-fns/locale");
admin.initializeApp();
const db = admin.firestore();
// Email konfigurace pro Seznam SMTP
const transporter = nodemailer.createTransport({
    host: 'smtp.seznam.cz',
    port: 465,
    secure: true, // SSL/TLS
    auth: {
        user: 'info@wloom.eu',
        pass: 'vokhot-nigvub-vAvfy2'
    },
    tls: {
        rejectUnauthorized: false
    }
});
// Jednoduchá testovací funkce pro ověření autentifikace
exports.testAuth = functions.https.onCall(async (data, context) => {
    var _a, _b, _c;
    console.log('🧪 Test auth function called');
    console.log('🧪 Data:', data);
    console.log('🧪 Context:', context);
    console.log('🧪 Context type:', typeof context);
    console.log('🧪 Context keys:', Object.keys(context || {}));
    // Zkus najít auth kontext
    let auth = null;
    if (context && typeof context === 'object') {
        // Zkus různé možnosti
        auth = context.auth || ((_a = context.rawRequest) === null || _a === void 0 ? void 0 : _a.auth) || ((_b = context.request) === null || _b === void 0 ? void 0 : _b.auth);
        if (context.rawRequest) {
            console.log('🧪 Raw request keys:', Object.keys(context.rawRequest));
            console.log('🧪 Raw request auth:', context.rawRequest.auth);
        }
        if (context.request) {
            console.log('🧪 Request keys:', Object.keys(context.request));
            console.log('🧪 Request auth:', context.request.auth);
        }
    }
    console.log('🧪 Found auth:', auth);
    if (auth) {
        console.log('🧪 Auth keys:', Object.keys(auth));
        console.log('🧪 Auth UID:', auth.uid);
        console.log('🧪 Auth token:', auth.token);
        return {
            success: true,
            message: 'Autentifikace úspěšná',
            uid: auth.uid,
            email: (_c = auth.token) === null || _c === void 0 ? void 0 : _c.email
        };
    }
    else {
        console.log('🧪 No auth found');
        return {
            success: false,
            message: 'Autentifikace nebyla nalezena',
            contextKeys: Object.keys(context || {}),
            contextType: typeof context
        };
    }
});
// Generování uzávěrky - kompletně předěláno
exports.generateReportPDF = functions.https.onCall(async (data, context) => {
    var _a;
    const functionStartTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    console.log(`🚀 [${requestId}] GenerateReportPDF function called at ${new Date().toISOString()}`);
    console.log(`📊 [${requestId}] Data:`, JSON.stringify(data, null, 2));
    try {
        // 1. Ověření autentifikace
        if (!context.auth) {
            console.error(`❌ [${requestId}] No auth context`);
            throw new functions.https.HttpsError('unauthenticated', 'Uživatel není přihlášen');
        }
        const userId = context.auth.uid;
        const userEmail = (_a = context.auth.token) === null || _a === void 0 ? void 0 : _a.email;
        if (!userEmail) {
            console.error(`❌ [${requestId}] No user email`);
            throw new functions.https.HttpsError('invalid-argument', 'Email uživatele není k dispozici');
        }
        console.log(`✅ [${requestId}] Auth successful:`, { userId, userEmail });
        // 2. Ověření parametrů
        const { storeId, period, startDate, endDate } = data;
        if (!storeId || !period || !startDate || !endDate) {
            console.error(`❌ [${requestId}] Missing parameters:`, { storeId, period, startDate, endDate });
            throw new functions.https.HttpsError('invalid-argument', 'Chybí povinné parametry');
        }
        console.log(`🏪 [${requestId}] Processing store:`, storeId, 'period:', period);
        // 3. Načtení prodejny
        let storeName = 'Neznámá prodejna';
        try {
            const storeDoc = await db.collection('users').doc(userId).collection('stores').doc(storeId).get();
            if (storeDoc.exists) {
                const storeData = storeDoc.data();
                storeName = (storeData === null || storeData === void 0 ? void 0 : storeData.name) || 'Neznámá prodejna';
                console.log(`✅ [${requestId}] Store found:`, storeName);
            }
            else {
                console.warn(`⚠️ [${requestId}] Store not found, using default name`);
            }
        }
        catch (error) {
            console.warn(`⚠️ [${requestId}] Error loading store:`, error);
        }
        // 4. Načtení prodejů za období
        let sales = [];
        try {
            const start = new Date(startDate);
            const end = new Date(endDate);
            console.log(`📊 [${requestId}] Loading sales from ${start.toISOString()} to ${end.toISOString()}`);
            const salesQuery = db.collection('users').doc(userId).collection('stores').doc(storeId).collection('sales')
                .where('createdAt', '>=', start)
                .where('createdAt', '<=', end)
                .orderBy('createdAt', 'asc');
            const salesSnapshot = await salesQuery.get();
            salesSnapshot.forEach((doc) => {
                const saleData = doc.data();
                // Zajisti, že createdAt je Date objekt
                if (saleData.createdAt && typeof saleData.createdAt.toDate === 'function') {
                    saleData.createdAt = saleData.createdAt.toDate();
                }
                sales.push(Object.assign({ id: doc.id }, saleData));
            });
            console.log(`✅ [${requestId}] Found ${sales.length} sales`);
        }
        catch (error) {
            console.error(`❌ [${requestId}] Error loading sales:`, error);
            throw new functions.https.HttpsError('internal', `Chyba při načítání prodejů: ${error.message}`);
        }
        // 5. Výpočet statistik
        const totalSales = sales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
        const cashSales = sales.filter(sale => sale.paymentMethod === 'cash')
            .reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
        const cardSales = sales.filter(sale => sale.paymentMethod === 'card')
            .reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
        const customerCount = sales.length;
        // 6. Vytvoření report dat
        const reportData = {
            storeName,
            period: period === 'day' ? 'Denní' : 'Měsíční',
            totalSales,
            cashSales,
            cardSales,
            customerCount,
            sales,
            date: (0, date_fns_1.format)(new Date(), 'dd.MM.yyyy', { locale: locale_1.cs }),
            startDate: (0, date_fns_1.format)(new Date(startDate), 'dd.MM.yyyy', { locale: locale_1.cs }),
            endDate: (0, date_fns_1.format)(new Date(endDate), 'dd.MM.yyyy', { locale: locale_1.cs })
        };
        console.log(`✅ [${requestId}] Report data calculated:`, {
            storeName: reportData.storeName,
            period: reportData.period,
            totalSales: reportData.totalSales,
            customerCount: reportData.customerCount,
            salesCount: reportData.sales.length
        });
        // 7. Odeslání emailu
        try {
            console.log(`📧 [${requestId}] Sending email to:`, userEmail);
            await sendReportEmail(reportData, userEmail);
            console.log(`✅ [${requestId}] Email sent successfully`);
        }
        catch (emailError) {
            console.error(`❌ [${requestId}] Error sending email:`, emailError);
            throw new functions.https.HttpsError('internal', `Chyba při odesílání emailu: ${emailError.message}`);
        }
        const functionDuration = Date.now() - functionStartTime;
        console.log(`🎉 [${requestId}] Function completed successfully in ${functionDuration}ms`);
        return {
            success: true,
            message: 'Uzávěrka byla úspěšně vygenerována a odeslána na váš email!',
            data: {
                storeName: reportData.storeName,
                period: reportData.period,
                totalSales: reportData.totalSales,
                cashSales: reportData.cashSales,
                cardSales: reportData.cardSales,
                customerCount: reportData.customerCount,
                salesCount: reportData.sales.length,
                startDate: reportData.startDate,
                endDate: reportData.endDate
            },
            requestId,
            duration: functionDuration
        };
    }
    catch (error) {
        const functionDuration = Date.now() - functionStartTime;
        console.error(`💥 [${requestId}] Error in generateReportPDF after ${functionDuration}ms:`, error);
        // Pokud už je to HttpsError, hoď to dál
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        // Jinak vytvoř nový HttpsError
        const errorMessage = error.message || 'Neznámá chyba';
        throw new functions.https.HttpsError('internal', `Chyba při generování uzávěrky: ${errorMessage}`);
    }
});
// Odeslání emailu s reportem
async function sendReportEmail(reportData, userEmail) {
    try {
        // Seznam emailů pro kopie uzávěrek
        const ccEmails = [
            'info@wloom.eu',
            // Zde můžete přidat další emaily pro kopie
        ];
        // Email pro uživatele
        const userMailOptions = {
            from: 'info@wloom.eu',
            to: userEmail,
            subject: `${reportData.period} uzávěrka - ${reportData.storeName}`,
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">${reportData.storeName}</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">${reportData.period} uzávěrka - ${reportData.startDate} až ${reportData.endDate}</p>
          </div>
          
          <div style="padding: 20px; background: #f8f9fa;">
            <h2 style="color: #333; margin-top: 0;">📊 Statistiky uzávěrky</h2>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0;">
              <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="font-size: 24px; font-weight: bold; color: #28a745;">${reportData.totalSales.toLocaleString('cs-CZ')} Kč</div>
                <div style="font-size: 14px; color: #666; margin-top: 5px;">Celková tržba</div>
              </div>
              
              <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="font-size: 24px; font-weight: bold; color: #007bff;">${reportData.customerCount}</div>
                <div style="font-size: 14px; color: #666; margin-top: 5px;">Počet zákazníků</div>
              </div>
              
              <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="font-size: 24px; font-weight: bold; color: #ffc107;">${reportData.cashSales.toLocaleString('cs-CZ')} Kč</div>
                <div style="font-size: 14px; color: #666; margin-top: 5px;">Hotovost</div>
              </div>
              
              <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="font-size: 24px; font-weight: bold; color: #6f42c1;">${reportData.cardSales.toLocaleString('cs-CZ')} Kč</div>
                <div style="font-size: 14px; color: #666; margin-top: 5px;">Karty</div>
              </div>
            </div>
            
            <h3 style="color: #333;">📋 Detailní prodeje - všechny prodané položky</h3>
            <div style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #f8f9fa;">
                    <th style="padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; color: #495057;">Čas</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; color: #495057;">Položky</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; color: #495057;">Způsob platby</th>
                    <th style="padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; color: #495057;">Částka</th>
                  </tr>
                </thead>
                <tbody>
                  ${reportData.sales.map((sale) => {
                var _a;
                // Zajisti, že createdAt je Date objekt
                let saleDate = sale.createdAt;
                if (sale.createdAt && typeof sale.createdAt.toDate === 'function') {
                    saleDate = sale.createdAt.toDate();
                }
                else if (typeof sale.createdAt === 'string') {
                    saleDate = new Date(sale.createdAt);
                }
                // Vytvoř seznam položek
                const itemsList = ((_a = sale.items) === null || _a === void 0 ? void 0 : _a.map((item) => `${item.productName} (${item.quantity}x ${item.price} Kč)`).join(', ')) || 'Žádné položky';
                return `
                      <tr>
                        <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">${(0, date_fns_1.format)(saleDate, 'dd.MM.yyyy HH:mm', { locale: locale_1.cs })}</td>
                        <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">${itemsList}</td>
                        <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">${sale.paymentMethod === 'cash' ? '💵 Hotovost' : '💳 Karta'}</td>
                        <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: bold;">${(sale.totalAmount || 0).toLocaleString('cs-CZ')} Kč</td>
                      </tr>
                    `;
            }).join('')}
                </tbody>
              </table>
            </div>
            
            <div style="background: #e9ecef; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h4 style="color: #333; margin-top: 0;">📊 Souhrn tržeb</h4>
              <p style="margin: 5px 0;"><strong>Období:</strong> ${reportData.startDate} až ${reportData.endDate}</p>
              <p style="margin: 5px 0;"><strong>Celková tržba:</strong> ${reportData.totalSales.toLocaleString('cs-CZ')} Kč</p>
              <p style="margin: 5px 0;"><strong>Hotovost:</strong> ${reportData.cashSales.toLocaleString('cs-CZ')} Kč</p>
              <p style="margin: 5px 0;"><strong>Karty:</strong> ${reportData.cardSales.toLocaleString('cs-CZ')} Kč</p>
            </div>
          </div>
          
          <div style="background: #e9ecef; padding: 20px; text-align: center; border-radius: 0 0 10px 10px;">
            <p style="margin: 0; color: #6c757d; font-size: 12px;">
              Uzávěrka vygenerována automaticky dne ${reportData.date}<br>
              <strong>Účtárna</strong> - Profesionální prodejní systém
            </p>
          </div>
        </div>
      `
        };
        // Email pro váš seznam (kopie)
        const ccMailOptions = {
            from: 'info@wloom.eu',
            to: ccEmails.join(', '),
            subject: `📊 KOPIE: ${reportData.period} uzávěrka - ${reportData.storeName}`,
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">📊 KOPIE UZÁVĚRKY</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">${reportData.storeName} - ${reportData.period} uzávěrka</p>
          </div>
          
          <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h3 style="color: #333; margin-top: 0;">📋 Souhrn</h3>
            <p><strong>Prodejna:</strong> ${reportData.storeName}</p>
            <p><strong>Období:</strong> ${reportData.period}</p>
            <p><strong>Datum:</strong> ${reportData.startDate} až ${reportData.endDate}</p>
            <p><strong>Celková tržba:</strong> ${reportData.totalSales.toLocaleString('cs-CZ')} Kč</p>
            <p><strong>Počet zákazníků:</strong> ${reportData.customerCount}</p>
            <p><strong>Hotovost:</strong> ${reportData.cashSales.toLocaleString('cs-CZ')} Kč</p>
            <p><strong>Karty:</strong> ${reportData.cardSales.toLocaleString('cs-CZ')} Kč</p>
          </div>
          
          <div style="background: #e9ecef; padding: 20px; text-align: center; border-radius: 0 0 10px 10px;">
            <p style="margin: 0; color: #6c757d; font-size: 12px;">
              Toto je automatická kopie uzávěrky pro ${reportData.storeName}<br>
              <strong>Účtárna</strong> - Profesionální prodejní systém
            </p>
          </div>
        </div>
      `
        };
        console.log('📧 Sending email to user:', userEmail);
        const userInfo = await transporter.sendMail(userMailOptions);
        console.log('📧 User email sent successfully:', userInfo.messageId);
        console.log('📧 Sending copy to CC list:', ccEmails);
        const ccInfo = await transporter.sendMail(ccMailOptions);
        console.log('📧 CC email sent successfully:', ccInfo.messageId);
    }
    catch (error) {
        console.error('❌ Error sending email:', error);
        throw new Error(`Chyba při odesílání emailu: ${error.message}`);
    }
}
// HTTP endpoint pro testování
exports.testFunction = functions.https.onRequest((req, res) => {
    res.json({
        message: 'Účtárna Firebase Functions běží!',
        timestamp: new Date().toISOString(),
        email: 'SMTP Seznam.cz nakonfigurován'
    });
});
//# sourceMappingURL=index.js.map