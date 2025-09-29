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

      // Aktualizuj počet prodaných kusů pro každý produkt
      console.log('📊 Aktualizuji počty prodaných kusů...');
      for (const item of cartItems) {
        console.log(`  - Produkt ${item.productId}: +${item.quantity} kusů`);
        const productRef = doc(db, 'users', userId, 'stores', storeId, 'products', item.productId);
        await updateDoc(productRef, {
          soldCount: increment(item.quantity),
          updatedAt: serverTimestamp()
        });
      }

      console.log('✅ SumUp platba úspěšně uložena:', saleRef.id);

      return NextResponse.json({
        success: true,
        saleId: saleRef.id,
        message: 'Prodej byl úspěšně uložen'
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
    
    return NextResponse.json(
      { 
        error: 'Interní chyba serveru',
        details: error instanceof Error ? error.message : 'Neznámá chyba'
      },
      { status: 500 }
    );
  }
}
