import { NextRequest, NextResponse } from 'next/server';
import { addDoc, collection, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { fetchSumUpTerminalTip } from '@/lib/sumup-server';

// Funkce pro ukládání všech SumUp odpovědí do Firebase
async function saveSumUpResponseToFirebase(body: any, request: NextRequest) {
  try {
    // Pokusíme se najít userId a storeId z různých zdrojů
    let userId = body.userId || body['user_id'];
    let storeId = body.storeId || body['store_id'];
    
    console.log('🔍 Hledám userId a storeId v datech:', { 
      userId, 
      storeId, 
      bodyKeys: Object.keys(body) 
    });
    
    // Pokud nemáme userId nebo storeId, použijeme fallback
    if (!userId) {
      userId = 'debug-user';
      console.log('⚠️ Používám fallback userId:', userId);
    }
    
    if (!storeId) {
      storeId = 'debug-store';
      console.log('⚠️ Používám fallback storeId:', storeId);
    }
    
    const sumUpResponse = {
      timestamp: serverTimestamp(),
      requestMethod: request.method,
      requestUrl: request.url,
      userAgent: request.headers.get('user-agent'),
      contentType: request.headers.get('content-type'),
      rawBody: body,
      extractedData: {
        status: body.status || body['smp-status'] || body['payment_status'] || body['transaction_status'],
        txCode: body.txCode || body['smp-tx-code'] || body['tx_code'] || body['transaction_code'],
        foreignTxId: body.foreignTxId || body['foreign-tx-id'] || body['foreign_tx_id'] || body['transaction_id'],
        amount: body.amount || body['payment_amount'] || body['total_amount'],
        currency: body.currency || body['payment_currency'] || 'CZK',
        storeId: body.storeId || body['store_id'],
        userId: body.userId || body['user_id'],
        cartItems: body.cartItems || body['cart_items'] || body['items'],
        discount: body.discount || body['discount_info'],
        discountAmount: body.discountAmount || body['discount_amount'],
        finalAmount: body.finalAmount || body['final_amount'],
        customerName: body.customerName || body['customer_name']
      },
      allKeys: Object.keys(body),
      processedAt: new Date().toISOString()
    };
    
    // Uložíme do správné struktury: users/{userId}/stores/{storeId}/sumup
    const docRef = await addDoc(collection(db, 'users', userId, 'stores', storeId, 'sumup'), sumUpResponse);
    console.log('💾 SumUp odpověď uložena do Firebase:', docRef.id);
    console.log('💾 Cesta:', `users/${userId}/stores/${storeId}/sumup`);
    
    // Také uložíme do obecné složky pro debugging
    try {
      const debugDocRef = await addDoc(collection(db, 'sumup-debug'), sumUpResponse);
      console.log('💾 SumUp odpověď uložena do Firebase (debug složka):', debugDocRef.id);
    } catch (debugError) {
      console.error('❌ Chyba při ukládání do debug složky:', debugError);
    }
    
  } catch (error) {
    console.error('❌ Chyba při ukládání SumUp odpovědi do Firebase:', error);
    // Nevyhodíme chybu, aby se neblokoval hlavní proces
  }
}

export async function POST(request: NextRequest) {
  console.log('🚀 SumUp callback endpoint byl zavolán');
  console.log('🚀 Request method:', request.method);
  console.log('🚀 Request headers:', Object.fromEntries(request.headers.entries()));
  console.log('🚀 Request URL:', request.url);
  console.log('🚀 Request timestamp:', new Date().toISOString());
  console.log('🚀 User-Agent:', request.headers.get('user-agent'));
  console.log('🚀 Content-Type:', request.headers.get('content-type'));
  
  try {
    const body = await request.json();
    console.log('📥 SumUp callback přijat:', JSON.stringify(body, null, 2));
    console.log('📥 Raw body type:', typeof body);
    console.log('📥 Body keys:', Object.keys(body));
    
    // Uložíme všechny příchozí data do Firebase pro debugging
    await saveSumUpResponseToFirebase(body, request);
    
    // Zkusíme různé názvy parametrů pro různé typy plateb
    const status = body.status || body['smp-status'] || body['payment_status'] || body['transaction_status'];
    const txCode = body.txCode || body['smp-tx-code'] || body['tx_code'] || body['transaction_code'];
    const foreignTxId = body.foreignTxId || body['foreign-tx-id'] || body['foreign_tx_id'] || body['transaction_id'];
    const documentId = body.documentId || body['document_id'] || foreignTxId;
    const amount = body.amount || body['payment_amount'] || body['total_amount'];
    const currency = body.currency || body['payment_currency'] || 'CZK';
    const storeId = body.storeId || body['store_id'];
    const userId = body.userId || body['user_id'];
    const cartItems = body.cartItems || body['cart_items'] || body['items'];
    const discount = body.discount || body['discount_info'];
    const discountAmount = body.discountAmount || body['discount_amount'];
    const finalAmount = body.finalAmount || body['final_amount'] || amount;
    const customerName = body.customerName || body['customer_name'];
    const tipAmountRaw = body.tipAmount ?? body['tip_amount'];
    const appTipAmount =
      typeof tipAmountRaw === 'number' && tipAmountRaw > 0 ? tipAmountRaw : 0;
    const sentToSumUp =
      typeof amount === 'number' ? amount : parseFloat(String(amount ?? ''));

    // Rozšířené logování pro debugging
    console.log('📊 Extrahované parametry:', {
      status: status,
      txCode: txCode,
      foreignTxId: foreignTxId,
      documentId: documentId,
      amount: amount,
      sentToSumUp,
      currency: currency,
      storeId: storeId,
      userId: userId,
      cartItemsLength: cartItems?.length,
      discount: discount,
      discountAmount: discountAmount,
      finalAmount: finalAmount,
      customerName: customerName,
      appTipAmount,
    });

    // Validace povinných parametrů - více flexibilní pro různé typy plateb
    if (!status) {
      console.error('❌ Chybí status parametr');
      console.error('❌ Dostupné parametry:', Object.keys(body));
      console.error('❌ Celé body:', body);
      console.error('❌ Možné alternativní názvy:', {
        'smp-status': body['smp-status'],
        'status': body['status'],
        'payment_status': body['payment_status'],
        'transaction_status': body['transaction_status']
      });
      return NextResponse.json(
        { error: 'Chybí status parametr', availableParams: Object.keys(body) },
        { status: 400 }
      );
    }

    if (!foreignTxId) {
      console.error('❌ Chybí foreignTxId parametr');
      return NextResponse.json(
        { error: 'Chybí foreignTxId parametr' },
        { status: 400 }
      );
    }

    if (!storeId) {
      console.error('❌ Chybí storeId parametr');
      return NextResponse.json(
        { error: 'Chybí storeId parametr' },
        { status: 400 }
      );
    }

    if (!userId) {
      console.error('❌ Chybí userId parametr');
      return NextResponse.json(
        { error: 'Chybí userId parametr' },
        { status: 400 }
      );
    }

    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      console.error('❌ Chybí nebo neplatné cartItems:', cartItems);
      return NextResponse.json(
        { error: 'Chybí nebo neplatné cartItems' },
        { status: 400 }
      );
    }

    if (amount === undefined || amount === null) {
      console.error('❌ Chybí amount parametr:', amount);
      return NextResponse.json(
        { error: 'Chybí amount parametr' },
        { status: 400 }
      );
    }

    if (!currency) {
      console.error('❌ Chybí currency parametr');
      return NextResponse.json(
        { error: 'Chybí currency parametr' },
        { status: 400 }
      );
    }

    // Kontrola, zda je platba úspěšná
    if (status === 'success') {
      console.log('💳 Zpracovávám úspěšnou platbu...');

      // Spropitné z terminálu načteme server-side ze SumUp REST API (tip_amount
      // nebo rozdíl mezi zaplacenou a poslanou částkou). Při chybě API = 0 Kč.
      const terminalLookup = await fetchSumUpTerminalTip(
        txCode,
        documentId || foreignTxId,
        Number.isFinite(sentToSumUp) ? sentToSumUp : undefined
      );
      const terminalTip = terminalLookup.tipAmount;
      const combinedTip = appTipAmount + terminalTip;
      const tipAmount = combinedTip > 0 ? combinedTip : null;
      const saleTotalAmount = (Number.isFinite(sentToSumUp) ? sentToSumUp : amount || 0) + terminalTip;
      const baseFinal =
        typeof finalAmount === 'number'
          ? finalAmount
          : Number.isFinite(sentToSumUp)
            ? sentToSumUp
            : amount || 0;
      const saleFinalAmount = baseFinal + terminalTip;

      console.log('💰 Spropitné:', {
        appTipAmount,
        terminalTip,
        combinedTip,
        sentToSumUp,
        saleTotalAmount,
        terminalSource: terminalLookup.source,
      });
      
      // Vytvoř prodej v Firestore
      const sale = {
        items: cartItems,
        totalAmount: saleTotalAmount,
        paymentMethod: 'card',
        documentId: documentId || foreignTxId, // Použij documentId nebo fallback na foreignTxId
        createdAt: serverTimestamp(),
        storeId,
        userId,
        customerName: customerName || null,
        isRefund: false,
        refundAmount: null,
        served: false,
        // Sleva
        discount: discount || null,
        discountAmount: discountAmount || 0,
        finalAmount: saleFinalAmount,
        tipAmount,
        sumUpData: {
          foreignTxId,
          sumUpTxCode: txCode,
          status: 'success',
          callbackReceived: true,
          callbackTimestamp: new Date(),
          sentToSumUp: Number.isFinite(sentToSumUp) ? sentToSumUp : null,
          terminalTip: terminalTip > 0 ? terminalTip : null,
          terminalTipSource: terminalLookup.source,
          terminalTipDebug: terminalLookup.debugError ?? null,
          sumUpAuthSource: terminalLookup.authSource ?? null,
        }
      };

      console.log('💾 Ukládám prodej do databáze...', { storeId, userId, itemsCount: cartItems.length });
      
      // Ulož prodej do databáze
      const saleRef = await addDoc(collection(db, 'users', userId, 'stores', storeId, 'sales'), sale);
      console.log('✅ Prodej uložen s ID:', saleRef.id);

      // Aktualizace produktů je best-effort: případné chyby logujeme, ale neblokují odpověď
      let inventoryUpdated = 0;
      let inventoryFailed = 0;
      try {
        console.log('📊 Aktualizuji počty prodaných kusů...');
        for (const item of cartItems) {
          try {
            console.log(`  - Produkt ${item.productId}: +${item.quantity} kusů`);
            const productRef = doc(db, 'users', userId, 'stores', storeId, 'products', item.productId);
            await updateDoc(productRef, {
              soldCount: increment(item.quantity),
              updatedAt: serverTimestamp()
            });
            inventoryUpdated += 1;
          } catch (e) {
            inventoryFailed += 1;
            console.error('⚠️ Nepodařilo se aktualizovat produkt', item?.productId, e);
          }
        }
      } catch (e) {
        console.error('⚠️ Chyba při hromadné aktualizaci produktů:', e);
      }

      console.log('✅ SumUp platba úspěšně uložena:', saleRef.id, {
        inventoryUpdated,
        inventoryFailed,
      });

      return NextResponse.json({
        success: true,
        saleId: saleRef.id,
        message: 'Prodej byl úspěšně uložen',
        inventoryUpdated,
        inventoryFailed,
        terminalTip: terminalTip > 0 ? terminalTip : null,
        tipAmount,
        totalAmount: saleTotalAmount,
        terminalTipDebug: terminalLookup.debugError ?? null,
      });

    } else {
      // Platba se nezdařila - neukládáme do databáze
      console.log('❌ SumUp platba se nezdařila:', status);

      return NextResponse.json({
        success: false,
        message: 'Platba se nezdařila - položky zůstávají v košíku'
      });
    }

  } catch (error) {
    console.error('❌ Chyba při zpracování SumUp callback:', error);
    console.error('❌ Stack trace:', error instanceof Error ? error.stack : 'N/A');
    console.error('❌ Error type:', typeof error);
    console.error('❌ Error constructor:', error?.constructor?.name);
    console.error('❌ Request URL:', request.url);
    console.error('❌ Request method:', request.method);

    // Rozlišení typických chyb Firestore
    const message = error instanceof Error ? error.message : String(error);
    const isPermission = /PERMISSION_DENIED/i.test(message);
    const isNotFound = /NOT_FOUND/i.test(message);
    const isInvalidArgument = /INVALID_ARGUMENT/i.test(message);
    const isUnavailable = /UNAVAILABLE/i.test(message);
    const isDeadlineExceeded = /DEADLINE_EXCEEDED/i.test(message);

    let statusCode = 500;
    let statusText = 'Interní chyba serveru';

    if (isPermission) {
      statusCode = 403;
      statusText = 'Nedostatečná oprávnění';
    } else if (isNotFound) {
      statusCode = 404;
      statusText = 'Dokument nebyl nalezen';
    } else if (isInvalidArgument) {
      statusCode = 400;
      statusText = 'Neplatné argumenty';
    } else if (isUnavailable) {
      statusCode = 503;
      statusText = 'Služba není dostupná';
    } else if (isDeadlineExceeded) {
      statusCode = 504;
      statusText = 'Vypršel časový limit';
    }

    console.error('❌ Vracím chybu:', { statusCode, statusText, message });

    return NextResponse.json(
      {
        error: statusText,
        details: message,
        timestamp: new Date().toISOString(),
        errorType: error?.constructor?.name || 'Unknown'
      },
      { status: statusCode }
    );
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  // SumUp někdy volá callback jako GET s query parametry – přesměruj na /payment/success,
  // kde proběhne standardní tok uložení prodeje (POST sumup-callback).
  const status = params['smp-status'] || params.status;
  const txCode = params['smp-tx-code'] || params.tx_code || params.txCode;
  if (status === 'success' || status === 'failed' || status === 'invalidstate') {
    const target = new URL(`${url.origin}/payment/${status === 'success' ? 'success' : 'fail'}`);
    for (const [key, value] of url.searchParams.entries()) {
      target.searchParams.set(key, value);
    }
    return NextResponse.redirect(target);
  }

  console.log('📥 SumUp callback GET (bez smp parametrů):', JSON.stringify(params));

  await saveSumUpResponseToFirebase(params, request);

  return NextResponse.json({
    success: true,
    message:
      'Toto je debug endpoint. Prodej se ukládá přes POST z aplikace po návratu na /payment/success. Pro diagnostiku SumUp API použij /api/sumup/debug',
    params,
    timestamp: new Date().toISOString(),
  });
}
