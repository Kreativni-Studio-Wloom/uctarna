import { NextRequest, NextResponse } from 'next/server';
import { addDoc, collection, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SumUpCallbackParams } from '@/lib/sumup';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      status, 
      txCode, 
      foreignTxId, 
      amount, 
      currency, 
      storeId, 
      userId, 
      cartItems 
    } = body;

    // Validace povinných parametrů
    if (!status || !foreignTxId || !storeId || !userId || !cartItems || amount === undefined || !currency) {
      return NextResponse.json(
        { error: 'Chybí povinné parametry' },
        { status: 400 }
      );
    }

    // Kontrola, zda je platba úspěšná
    if (status === 'success') {
      // Vytvoř prodej v Firestore
      const sale = {
        items: cartItems,
        totalAmount: amount || 0,
        paymentMethod: 'card',
        createdAt: serverTimestamp(),
        storeId,
        userId,
        isRefund: false,
        refundAmount: null,
        served: false,
        sumUpData: {
          foreignTxId,
          sumUpTxCode: txCode,
          status: 'success',
          callbackReceived: true,
          callbackTimestamp: new Date()
        }
      };

      // Ulož prodej do databáze
      const saleRef = await addDoc(collection(db, 'users', userId, 'stores', storeId, 'sales'), sale);

      // Aktualizuj počet prodaných kusů pro každý produkt
      for (const item of cartItems) {
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
    
    return NextResponse.json(
      { error: 'Interní chyba serveru' },
      { status: 500 }
    );
  }
}
