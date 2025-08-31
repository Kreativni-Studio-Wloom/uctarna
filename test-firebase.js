const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "prodejni-system-uctarna.firebaseapp.com",
  projectId: "prodejni-system-uctarna",
  storageBucket: "prodejni-system-uctarna.appspot.com",
  messagingSenderId: "789375134911",
  appId: "1:789375134911:web:XXXXXXXXXXXXXXXXXXXX"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'us-central1');

async function testFunctions() {
  console.log('🧪 Testuji Firebase Functions...');
  
  try {
    // Test testAuth
    console.log('\n1️⃣ Testuji testAuth...');
    const testAuth = httpsCallable(functions, 'testAuth');
    const authResult = await testAuth({ test: true });
    console.log('✅ testAuth úspěšný:', authResult.data);
    
    // Test generateReportPDF
    console.log('\n2️⃣ Testuji generateReportPDF...');
    const generateReport = httpsCallable(functions, 'generateReportPDF');
    const reportResult = await generateReport({
      storeId: 'test-store',
      period: 'day',
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString()
    });
    console.log('✅ generateReportPDF úspěšný:', reportResult.data);
    
  } catch (error) {
    console.error('❌ Chyba:', error);
    console.error('Kód chyby:', error.code);
    console.error('Zpráva:', error.message);
    console.error('Detaily:', error.details);
  }
}

testFunctions();
