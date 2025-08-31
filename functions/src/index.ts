import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

const db = admin.firestore();

// Jednoduchá testovací funkce pro ověření autentifikace
export const testAuth = functions.https.onCall(async (data: any, context: any) => {
  console.log('🧪 Test auth function called');
  console.log('🧪 Data:', data);
  console.log('🧪 Context:', context);
  console.log('🧪 Context type:', typeof context);
  console.log('🧪 Context keys:', Object.keys(context || {}));
  
  // Zkus najít auth kontext
  let auth = null;
  
  if (context && typeof context === 'object') {
    // Zkus různé možnosti
    auth = context.auth || context.rawRequest?.auth || context.request?.auth;
    
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
      email: auth.token?.email
    };
  } else {
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
export const testFunction = functions.https.onRequest((req: any, res: any) => {
  res.json({ 
    message: 'Účtárna Firebase Functions běží!', 
    timestamp: new Date().toISOString(),
    email: 'SMTP Seznam.cz nakonfigurován'
  });
});

