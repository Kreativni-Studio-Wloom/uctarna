// „Duplikovat prodejnu“ (Dashboard): co se smí zkopírovat do nové prodejny.
// Čisté funkce bez Firebase, aby šly testovat. U prodejny a dokladů bez EET vrací přesně
// to, co dashboard kopíroval dřív (stejný objekt, jen s novým storeId / userId u dokladů).
//
// EET 2.0: kopie nesmí převzít EET identitu původní prodejny ani jejích dokladů:
// - doklad: bez `receiptNo`, `eet`, `pendingNumber` (jinak by ho fronta odeslala podruhé a číslo
//   by bylo v řadě dvakrát); místo nich `copiedFrom` (odkud kopie pochází, jen pro informaci),
// - prodejna: `eet.enabled = false`, bez `eet.certificate` (tajná data v `private/eet` se nekopírují,
//   metadata by lhala) a bez `eet.unitId` (každá prodejna = vlastní evidenční jednotka, se stejnou
//   jednotkou a novou řadou by vznikla duplicitní pořadová čísla).
// Podkolekce `counters` a `private` dashboard nekopíruje vůbec (kopíruje jen products a sales).
// Kopie tedy nikdy nevstoupí do fronty EET (ta hledá `eet.status` pending/queued).

type Data = Record<string, unknown>;

/** Pole dokladu, která patří jen originálu (EET identita). */
export const SALE_EET_IDENTITY_FIELDS = ['receiptNo', 'eet', 'pendingNumber'] as const;

export interface SaleCopiedFrom {
  storeId: string;
  saleId: string;
  receiptNo?: string;
}

/** Nastavení EET pro kopii prodejny (nebo `undefined`, když původní prodejna EET pole nemá). */
export function duplicateStoreEet(eet: unknown): Data | undefined {
  if (!eet || typeof eet !== 'object') return undefined;
  const rest: Data = { ...(eet as Data) };
  delete rest.certificate;
  delete rest.unitId;
  return { ...rest, enabled: false };
}

/** Data nové prodejny z dat původní (bez jména/časů, ty doplní dashboard). */
export function duplicateStoreData(storeData: Data): Data {
  if (!('eet' in storeData)) return { ...storeData };
  const copy: Data = { ...storeData };
  const eet = duplicateStoreEet(storeData.eet);
  if (eet) copy.eet = eet;
  else delete copy.eet;
  return copy;
}

export interface DuplicateSaleContext {
  sourceStoreId: string;
  sourceSaleId: string;
  newStoreId: string;
  userId: string;
  productIdMap: Map<string, string>;
  /** Staré id dokladu → nové (kvůli vazbě storno ↔ původní doklad). */
  saleIdMap: Map<string, string>;
}

export function duplicateSaleData(saleData: Data, ctx: DuplicateSaleContext): Data {
  const items = Array.isArray(saleData.items)
    ? saleData.items.map((item: { productId?: string }) => ({
        ...item,
        productId: item.productId ? ctx.productIdMap.get(item.productId) || item.productId : item.productId,
      }))
    : saleData.items;

  const copy: Data = { ...saleData, items, storeId: ctx.newStoreId, userId: ctx.userId };

  const hadEetFields = SALE_EET_IDENTITY_FIELDS.some((f) => f in saleData);
  if (!hadEetFields && !('stornoOf' in saleData) && !('storno' in saleData)) return copy;

  for (const f of SALE_EET_IDENTITY_FIELDS) delete copy[f];
  if (hadEetFields) {
    const from: SaleCopiedFrom = { storeId: ctx.sourceStoreId, saleId: ctx.sourceSaleId };
    if (typeof saleData.receiptNo === 'string' && saleData.receiptNo) from.receiptNo = saleData.receiptNo;
    copy.copiedFrom = from;
  }

  // Vazbu storna přemapovat na nová id; když protějšek v kopii není, vazbu vynechat.
  if (typeof saleData.stornoOf === 'string') {
    const mapped = ctx.saleIdMap.get(saleData.stornoOf);
    if (mapped) copy.stornoOf = mapped;
    else delete copy.stornoOf;
  }
  const storno = saleData.storno as { saleId?: string } | null | undefined;
  if (storno && typeof storno === 'object') {
    const mapped = storno.saleId ? ctx.saleIdMap.get(storno.saleId) : undefined;
    if (mapped) copy.storno = { ...storno, saleId: mapped };
    else delete copy.storno;
  }
  return copy;
}
