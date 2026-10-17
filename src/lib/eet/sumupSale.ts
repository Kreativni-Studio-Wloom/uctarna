import 'server-only';
import { HttpError, paths, type Db } from './db';
import { prepareNewSaleEet } from './finalize';
import { isEetEnabled } from './flags';
import type { SaleEet, Store } from '@/types';

/*
 * Transakce SumUp callbacku (/api/sumup-callback): uložení prodeje pod deterministickým ID
 * (documentId), duplicitní callback nic nepřepíše.
 *  - EET vypnuté: zapíše se PŘESNĚ objekt `sale` od volajícího (jako dřív). Navíc se jen čte prodejna.
 *  - EET zapnuté: požaduje přihlášení vlastníka prodejny (Firebase ID token, uid = userId),
 *    v téže transakci přidělí číslo dokladu a doplní `receiptNo` + `eet` (pending).
 *    Odeslání (`registerSale`) volá route až po commitu.
 */

export interface SaveSumUpSaleInput {
  userId: string;
  storeId: string;
  saleDocId: string;
  sale: Record<string, unknown>;
  /** uid z ověřeného ID tokenu (null = bez přihlášení) */
  authUid: string | null;
  now?: Date;
}

export interface SaveSumUpSaleResult {
  alreadyExists: boolean;
  eetEnabled: boolean;
  receiptNo?: string;
  eet?: SaleEet;
}

export async function saveSumUpSale(db: Db, input: SaveSumUpSaleInput): Promise<SaveSumUpSaleResult> {
  const saleRef = db.doc(paths.sale(input.userId, input.storeId, input.saleDocId));
  const storeRef = db.doc(paths.store(input.userId, input.storeId));
  const out: SaveSumUpSaleResult = { alreadyExists: false, eetEnabled: false };

  await db.runTransaction(async (tx) => {
    out.alreadyExists = false;
    out.eetEnabled = false;
    const existing = await tx.get(saleRef);
    if (existing.exists) {
      out.alreadyExists = true;
      return;
    }
    const storeSnap = await tx.get(storeRef);
    const store = (storeSnap.exists ? storeSnap.data() : undefined) as Pick<Store, 'eet'> | undefined;
    if (!store || !isEetEnabled(store)) {
      tx.set(saleRef, input.sale);
      return;
    }
    out.eetEnabled = true;
    if (input.authUid !== input.userId) {
      throw new HttpError(401, 'auth_required', 'Prodejna má zapnuté EET: uložení platby vyžaduje přihlášení');
    }
    const prepared = await prepareNewSaleEet(tx, db, input.userId, input.storeId, store, { now: input.now ?? new Date() });
    prepared.commit();
    tx.set(saleRef, { ...input.sale, ...prepared.fields });
    out.receiptNo = prepared.fields.receiptNo;
    out.eet = prepared.fields.eet;
  });
  return out;
}
