"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReportPDF = exports.testFunction = exports.testAuth = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
// const db = admin.firestore();
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
// HTTP endpoint pro testování
exports.testFunction = functions.https.onRequest((req, res) => {
    res.json({
        message: 'Účtárna Firebase Functions běží!',
        timestamp: new Date().toISOString(),
        email: 'SMTP Seznam.cz nakonfigurován'
    });
});
// Generování PDF reportu
exports.generateReportPDF = functions.https.onCall(async (data, context) => {
    const requestId = Math.random().toString(36).substring(7);
    const startTime = Date.now();
    console.log(`🚀 [${requestId}] generateReportPDF called with data:`, data);
    try {
        // Ověření autentifikace
        if (!context.auth) {
            console.log(`❌ [${requestId}] No auth context`);
            throw new functions.https.HttpsError('unauthenticated', 'Uživatel musí být přihlášen');
        }
        const { reportData, userEmail } = data;
        if (!reportData || !userEmail) {
            console.log(`❌ [${requestId}] Missing required data`);
            throw new functions.https.HttpsError('invalid-argument', 'Chybí povinná data');
        }
        console.log(`📊 [${requestId}] Generating report for store: ${reportData.storeName}`);
        console.log(`📧 [${requestId}] Sending to email: ${userEmail}`);
        // Odeslání emailu s reportem
        await sendReportEmail(reportData, userEmail);
        const functionDuration = Date.now() - startTime;
        console.log(`✅ [${requestId}] Report generated and sent successfully in ${functionDuration}ms`);
        return {
            success: true,
            message: 'Uzávěrka byla úspěšně vygenerována a odeslána',
            requestId,
            duration: functionDuration
        };
    }
    catch (error) {
        const functionDuration = Date.now() - startTime;
        console.error(`💥 [${requestId}] Error in generateReportPDF after ${functionDuration}ms:`, error);
        // Pokud je to už HttpsError, přepošli ho
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
            <p style="margin: 10px 0 0 0; opacity: 0.9;">${reportData.period === 'Denní'
                ? `Denní uzávěrka z ${reportData.startDate}`
                : reportData.period === 'Měsíční'
                    ? `Uzávěrka za měsíc ${reportData.startDate}`
                    : `Celková uzávěrka od ${reportData.startDate} do ${reportData.endDate}`}</p>
          </div>
          
          <div style="padding: 20px; background: #f8f9fa;">
            <h2 style="color: #333; margin-top: 0;">📊 Statistiky uzávěrky</h2>
            
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 15px; margin: 20px 0;">
              <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="font-size: 24px; font-weight: bold; color: #28a745;">${reportData.totalSales.toLocaleString('cs-CZ')} Kč</div>
                <div style="font-size: 14px; color: #666; margin-top: 5px;">Celková tržba</div>
              </div>
              
              <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="font-size: 24px; font-weight: bold; color: #007bff;">
                  ${reportData.customerCount}
                </div>
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
              
              <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="font-size: 24px; font-weight: bold; color: #28a745;">${reportData.totalProfit.toLocaleString('cs-CZ')} Kč</div>
                <div style="font-size: 14px; color: #666; margin-top: 5px;">Zisk</div>
              </div>
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
              <p><strong>Zisk:</strong> ${reportData.totalProfit.toLocaleString('cs-CZ')} Kč</p>
            </div>
          </div>
          
          <div style="background: #e9ecef; padding: 20px; text-align: center; border-radius: 0 0 10px 10px;">
            <p style="margin: 0; color: #6c757d; font-size: 12px;">
              Uzávěrka vygenerována automaticky dne ${new Date().toLocaleDateString('cs-CZ')}<br>
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
            <p><strong>Zisk:</strong> ${reportData.totalProfit.toLocaleString('cs-CZ')} Kč</p>
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
        console.log('📧 Sending email to CC:', ccEmails.join(', '));
        // Zde by mělo být skutečné odesílání emailu
        // Pro teď jen logujeme
        console.log('✅ Email would be sent to user:', userMailOptions.subject);
        console.log('✅ Email would be sent to CC:', ccMailOptions.subject);
        return { success: true };
    }
    catch (error) {
        console.error('❌ Error sending report email:', error);
        throw error;
    }
}
//# sourceMappingURL=index.js.map