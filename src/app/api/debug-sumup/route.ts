import { NextRequest, NextResponse } from 'next/server';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// Funkce pro ukládání debug dat do Firebase
async function saveDebugDataToFirebase(body: any, request: NextRequest) {
  try {
    const debugData = {
      timestamp: serverTimestamp(),
      requestMethod: request.method,
      requestUrl: request.url,
      userAgent: request.headers.get('user-agent'),
      contentType: request.headers.get('content-type'),
      rawBody: body,
      processedAt: new Date().toISOString()
    };
    
    // Uložíme do debug složky
    const docRef = await addDoc(collection(db, 'debug', 'sumup'), debugData);
    console.log('🔍 Debug data uložena do Firebase:', docRef.id);
    
  } catch (error) {
    console.error('❌ Chyba při ukládání debug dat do Firebase:', error);
  }
}

export async function POST(request: NextRequest) {
  console.log('🔍 DEBUG: SumUp callback test endpoint');
  console.log('🔍 Request method:', request.method);
  console.log('🔍 Request headers:', Object.fromEntries(request.headers.entries()));
  console.log('🔍 Request URL:', request.url);
  console.log('🔍 Request timestamp:', new Date().toISOString());
  
  try {
    const body = await request.json();
    console.log('🔍 RAW BODY:', JSON.stringify(body, null, 2));
    console.log('🔍 Body type:', typeof body);
    console.log('🔍 Body keys:', Object.keys(body));
    
    // Uložíme debug data do Firebase
    await saveDebugDataToFirebase(body, request);
    
    // Zkusíme různé názvy parametrů
    console.log('🔍 Status variants:', {
      status: body.status,
      'smp-status': body['smp-status'],
      'payment_status': body['payment_status'],
      'transaction_status': body['transaction_status']
    });
    
    console.log('🔍 ForeignTxId variants:', {
      foreignTxId: body.foreignTxId,
      'foreign-tx-id': body['foreign-tx-id'],
      'foreign_tx_id': body['foreign_tx_id'],
      'transaction_id': body['transaction_id']
    });
    
    console.log('🔍 Amount variants:', {
      amount: body.amount,
      'payment_amount': body['payment_amount'],
      'total_amount': body['total_amount']
    });
    
    return NextResponse.json({
      success: true,
      message: 'Debug data logged',
      receivedData: body,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('🔍 Error parsing body:', error);
    
    // Zkusíme přečíst raw text
    try {
      const text = await request.text();
      console.log('🔍 Raw text:', text);
    } catch (e) {
      console.error('🔍 Error reading text:', e);
    }
    
    return NextResponse.json({
      success: false,
      error: 'Failed to parse request body',
      timestamp: new Date().toISOString()
    }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  console.log('🔍 DEBUG: SumUp callback GET test endpoint');
  console.log('🔍 Request URL:', request.url);
  console.log('🔍 Request timestamp:', new Date().toISOString());
  console.log('🔍 User-Agent:', request.headers.get('user-agent'));
  
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  
  console.log('🔍 GET parametry:', JSON.stringify(params, null, 2));
  
  // Uložíme debug data do Firebase
  await saveDebugDataToFirebase(params, request);
  
  return NextResponse.json({
    success: true,
    message: 'Debug GET data logged',
    params: params,
    timestamp: new Date().toISOString()
  });
}