import { NextRequest, NextResponse } from 'next/server';
import { addDoc, collection, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SumUpCallbackParams } from '@/lib/sumup';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('📥 SumUp callback přijat:', JSON.stringify(body, null, 2));
    
    const { 
      status, 
      txCode, 
      foreignTxId, 
      documentId,
      amount, 
      currency, 
      storeId, 
      userId, 
      cartItems,
      discount,
      discountAmount,
      finalAmount,
      customerName
    } = body;

    // Validace povinných parametrů
    if (!status || !foreignTxId || !storeId || !userId || !cartItems || amount === undefined || !currency) {
      console.error('❌ Chybí povinné parametry:', {
        status: !!status,
        foreignTxId: !!foreignTxId,
        storeId: !!storeId,
        userId: !!userId,
        cartItems: !!cartItems,
        amount: amount,
        currency: !!currency
      });
      return NextResponse.json(
        { error: 'Chybí povinné parametry' },
        { status: 400 }
      );
    }

    // Kontrola, zda je platba úspěšná
    if (status === 'success') {
      console.log('💳 Zpracovávám úspěšnou platbu...');
      
      // Vytvoř prodej v Firestore
      const sale = {
        items: cartItems,
        totalAmount: amount || 0,
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
        finalAmount: finalAmount || amount || 0,
        sumUpData: {
          foreignTxId,
          sumUpTxCode: txCode,
          status: 'success',
          callbackReceived: true,
          callbackTimestamp: new Date()
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

    // Rozlišení typických chyb Firestore
    const message = error instanceof Error ? error.message : String(error);
    const isPermission = /PERMISSION_DENIED/i.test(message);
    const isNotFound = /NOT_FOUND/i.test(message);

    const statusCode = isPermission ? 403 : isNotFound ? 404 : 500;
    const statusText = isPermission
      ? 'Nedostatečná oprávnění'
      : isNotFound
      ? 'Dokument nebyl nalezen'
      : 'Interní chyba serveru';

    return NextResponse.json(
      {
        error: statusText,
        details: message,
      },
      { status: statusCode }
    );
  }
}
