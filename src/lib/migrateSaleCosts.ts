import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { CartItem } from '@/types';

const MIGRATION_FLAG = 'saleCostBackfillV1';

/**
 * Jednorázová migrace: do položek už existujících prodejů doplní nákupní cenu
 * (`cost`) podle AKTUÁLNÍ hodnoty v katalogu. Tím se náklad u historických
 * prodejů "zamrazí" – pozdější změna nákupky v katalogu už neovlivní zisk
 * dříve prodaných produktů.
 *
 * Migrace se pro danou prodejnu spustí jen jednou (příznak ve `state/migrations`).
 * Položky, které už mají numerický `cost`, se nemění.
 */
export async function backfillSaleCosts(userId: string, storeId: string): Promise<void> {
  if (!userId || !storeId) return;

  const migrationsRef = doc(db, 'users', userId, 'stores', storeId, 'state', 'migrations');

  try {
    const migrationsSnap = await getDoc(migrationsRef);
    if (migrationsSnap.exists() && migrationsSnap.data()?.[MIGRATION_FLAG]) {
      return;
    }

    const productsSnap = await getDocs(
      collection(db, 'users', userId, 'stores', storeId, 'products')
    );
    const costByProductId = new Map<string, number | null>();
    productsSnap.forEach((productDoc) => {
      const data = productDoc.data() as { cost?: unknown };
      costByProductId.set(
        productDoc.id,
        typeof data.cost === 'number' ? data.cost : null
      );
    });

    const salesSnap = await getDocs(
      collection(db, 'users', userId, 'stores', storeId, 'sales')
    );

    let batch = writeBatch(db);
    let opsInBatch = 0;
    const commits: Promise<void>[] = [];

    salesSnap.forEach((saleDoc) => {
      const data = saleDoc.data() as { items?: CartItem[] };
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) return;

      let changed = false;
      const nextItems = items.map((item) => {
        if (typeof item.cost === 'number') return item;
        const lockedCost = item.productId ? costByProductId.get(item.productId) : undefined;
        changed = true;
        return { ...item, cost: typeof lockedCost === 'number' ? lockedCost : null };
      });

      if (!changed) return;

      batch.update(saleDoc.ref, { items: nextItems });
      opsInBatch += 1;

      // Firestore batch má limit 500 operací.
      if (opsInBatch >= 400) {
        commits.push(batch.commit());
        batch = writeBatch(db);
        opsInBatch = 0;
      }
    });

    if (opsInBatch > 0) {
      commits.push(batch.commit());
    }

    await Promise.all(commits);

    await setDoc(
      migrationsRef,
      { [MIGRATION_FLAG]: true, [`${MIGRATION_FLAG}At`]: new Date().toISOString() },
      { merge: true }
    );
  } catch (e) {
    // Migrace je best-effort; při chybě necháme příznak nenastavený a zkusíme příště.
    console.error('Migrace nákladů prodejů selhala', e);
  }
}
