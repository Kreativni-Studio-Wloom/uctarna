'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Copy, AlertTriangle, Check, Trash2, Search, ClipboardCopy } from 'lucide-react';
import { db } from '@/lib/firebase';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';

interface DuplicateSalesCleanerProps {
  storeId: string;
}

type SaleRecord = {
  id: string;
  documentId?: string;
  paymentMethod?: string;
  totalAmount?: number;
  tipAmount?: number | null;
  createdAtMs: number;
  sumUpTxCode?: string;
};

type DuplicateGroup = {
  key: string;
  keep: SaleRecord;
  remove: SaleRecord[];
};

function toMillis(createdAt: unknown): number {
  if (!createdAt) return 0;
  if (typeof createdAt === 'object' && createdAt !== null) {
    const anyVal = createdAt as { toMillis?: () => number; seconds?: number };
    if (typeof anyVal.toMillis === 'function') return anyVal.toMillis();
    if (typeof anyVal.seconds === 'number') return anyVal.seconds * 1000;
  }
  const parsed = Date.parse(String(createdAt));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDateTime(ms: number): string {
  if (!ms) return 'neznámé datum';
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms));
}

// Klíče pro rozpoznání duplicit: doklad se považuje za duplicitní, pokud sdílí
// stejné číslo dokladu (documentId) NEBO stejný SumUp kód transakce.
// Vracíme všechny dostupné klíče – seskupení pak spojí i případy, kdy se shoduje
// jen jeden z nich (přechodně).
function recordKeys(sale: SaleRecord): string[] {
  const keys: string[] = [];
  if (sale.documentId && sale.documentId.trim()) keys.push(`doc:${sale.documentId.trim()}`);
  if (sale.sumUpTxCode && sale.sumUpTxCode.trim()) keys.push(`smp:${sale.sumUpTxCode.trim()}`);
  return keys;
}

// Z každé skupiny necháme jeden doklad: přednost má ten se spropitným
// (nejúplnější data), při shodě nejstarší (původní) záznam.
function pickKeeper(records: SaleRecord[]): SaleRecord {
  return [...records].sort((a, b) => {
    const tipA = a.tipAmount ?? 0;
    const tipB = b.tipAmount ?? 0;
    if (tipA !== tipB) return tipB - tipA;
    return a.createdAtMs - b.createdAtMs;
  })[0];
}

export const DuplicateSalesCleaner: React.FC<DuplicateSalesCleanerProps> = ({ storeId }) => {
  const { user } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const totalToRemove = groups.reduce((sum, g) => sum + g.remove.length, 0);

  const buildReportText = (): string => {
    const lines: string[] = [];
    lines.push(
      `Duplicitní doklady – ${groups.length} skupin, ke smazání ${totalToRemove} dokladů`
    );
    lines.push('');
    for (const g of groups) {
      const label = g.keep.documentId || g.keep.sumUpTxCode || g.key;
      const amount = typeof g.keep.totalAmount === 'number' ? `${g.keep.totalAmount} Kč` : '—';
      lines.push(`${label} · ${amount} · celkem ${g.remove.length + 1}×`);
      lines.push(`  NECHAT: ${formatDateTime(g.keep.createdAtMs)} (id ${g.keep.id})`);
      for (const r of g.remove) {
        lines.push(`  SMAZAT: ${formatDateTime(r.createdAtMs)} (id ${r.id})`);
      }
      lines.push('');
    }
    return lines.join('\n').trim();
  };

  const handleCopy = async () => {
    try {
      const text = buildReportText();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('❌ Kopírování selhalo:', e);
      setError('Kopírování do schránky se nezdařilo.');
    }
  };

  const handleScan = async () => {
    if (!user) return;
    setScanning(true);
    setError(null);
    setDoneMessage(null);
    setScanned(false);
    setGroups([]);

    try {
      const snapshot = await getDocs(collection(db, 'users', user.uid, 'stores', storeId, 'sales'));

      const records: SaleRecord[] = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const sumUpData = (data.sumUpData as Record<string, unknown> | undefined) ?? undefined;
        return {
          id: d.id,
          documentId: typeof data.documentId === 'string' ? data.documentId : undefined,
          paymentMethod: typeof data.paymentMethod === 'string' ? data.paymentMethod : undefined,
          totalAmount: typeof data.totalAmount === 'number' ? data.totalAmount : undefined,
          tipAmount: typeof data.tipAmount === 'number' ? data.tipAmount : null,
          createdAtMs: toMillis(data.createdAt),
          sumUpTxCode:
            sumUpData && typeof sumUpData.sumUpTxCode === 'string'
              ? sumUpData.sumUpTxCode
              : undefined,
        };
      });

      // Union-find: spojíme doklady, které sdílejí kterýkoli klíč (documentId nebo
      // SumUp kód). Tím zachytíme i případy, kdy se shoduje jen jeden z nich.
      const parent = new Map<number, number>();
      const find = (x: number): number => {
        let root = x;
        while (parent.get(root) !== root) root = parent.get(root)!;
        // komprese cesty
        let cur = x;
        while (parent.get(cur) !== root) {
          const next = parent.get(cur)!;
          parent.set(cur, root);
          cur = next;
        }
        return root;
      };
      const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
      };

      records.forEach((_, i) => parent.set(i, i));

      const keyToFirstIndex = new Map<string, number>();
      records.forEach((rec, i) => {
        for (const key of recordKeys(rec)) {
          const existing = keyToFirstIndex.get(key);
          if (existing === undefined) {
            keyToFirstIndex.set(key, i);
          } else {
            union(existing, i);
          }
        }
      });

      const byRoot = new Map<number, SaleRecord[]>();
      records.forEach((rec, i) => {
        // Doklad bez jakéhokoli klíče nelze porovnat – přeskočíme.
        if (recordKeys(rec).length === 0) return;
        const root = find(i);
        const arr = byRoot.get(root) ?? [];
        arr.push(rec);
        byRoot.set(root, arr);
      });

      const dupGroups: DuplicateGroup[] = [];
      for (const [root, recs] of byRoot.entries()) {
        if (recs.length < 2) continue;
        const keep = pickKeeper(recs);
        const remove = recs.filter((r) => r.id !== keep.id);
        const key = keep.documentId || keep.sumUpTxCode || `group:${root}`;
        dupGroups.push({ key, keep, remove });
      }

      dupGroups.sort((a, b) => b.remove.length - a.remove.length);
      setGroups(dupGroups);
      setScanned(true);
    } catch (e) {
      console.error('❌ Chyba při hledání duplicit:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const handleDelete = async () => {
    if (!user || totalToRemove === 0) return;
    const confirmed = window.confirm(
      `Opravdu smazat ${totalToRemove} duplicitních dokladů? Z každé skupiny zůstane jeden. Tuto akci nelze vrátit zpět.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      let removed = 0;
      for (const group of groups) {
        for (const rec of group.remove) {
          await deleteDoc(doc(db, 'users', user.uid, 'stores', storeId, 'sales', rec.id));
          removed += 1;
        }
      }
      setDoneMessage(`Smazáno ${removed} duplicitních dokladů. Tržba i sklad teď sedí.`);
      setGroups([]);
      setScanned(false);
    } catch (e) {
      console.error('❌ Chyba při mazání duplicit:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.24 }}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
    >
      <div className="flex items-start mb-4">
        <div className="w-12 h-12 shrink-0 bg-red-100 dark:bg-red-900/20 rounded-lg flex items-center justify-center mr-4">
          <Copy className="h-6 w-6 text-red-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Duplicitní doklady
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Najde doklady, které vznikly vícekrát ke stejné platbě (stejné číslo dokladu / SumUp kód), a nechá z každé skupiny jen jeden. Opraví tím nafouknutou tržbu.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleScan}
          disabled={scanning || deleting}
          className="inline-flex items-center px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-60 transition-colors text-sm font-medium"
        >
          {scanning ? (
            <span className="w-4 h-4 mr-2 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
          ) : (
            <Search className="w-4 h-4 mr-2" />
          )}
          {scanning ? 'Hledám…' : 'Zkontrolovat duplicity'}
        </button>

        {scanned && totalToRemove > 0 && (
          <>
            <button
              onClick={handleCopy}
              disabled={deleting}
              className="inline-flex items-center px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-60 transition-colors text-sm font-medium"
            >
              {copied ? (
                <Check className="w-4 h-4 mr-2 text-green-600" />
              ) : (
                <ClipboardCopy className="w-4 h-4 mr-2" />
              )}
              {copied ? 'Zkopírováno' : 'Kopírovat výsledek'}
            </button>

            <button
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center px-4 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 transition-colors text-sm font-medium"
            >
              {deleting ? (
                <span className="w-4 h-4 mr-2 rounded-full border-2 border-white/40 border-t-white animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              {deleting ? 'Mažu…' : `Smazat duplicity (${totalToRemove})`}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {doneMessage && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{doneMessage}</span>
        </div>
      )}

      {scanned && totalToRemove === 0 && !doneMessage && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Žádné duplicitní doklady nenalezeny.</span>
        </div>
      )}

      {scanned && totalToRemove > 0 && (
        <div className="mt-4">
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
            Nalezeno <strong>{groups.length}</strong> platebních skupin s duplicitou, ke smazání <strong>{totalToRemove}</strong> dokladů (z každé skupiny zůstane jeden):
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
            {groups.map((g) => (
              <div key={g.key} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-gray-900 dark:text-white truncate">
                      {g.keep.documentId || g.keep.sumUpTxCode || g.key}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {typeof g.keep.totalAmount === 'number' ? `${g.keep.totalAmount} Kč` : ''}
                      {' · '}celkem {g.remove.length + 1}× → nechat 1, smazat {g.remove.length}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                    −{g.remove.length}
                  </span>
                </div>
                <div className="mt-1.5 space-y-0.5 text-xs">
                  <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                    <span className="shrink-0 font-medium">Nechat:</span>
                    <span>{formatDateTime(g.keep.createdAtMs)}</span>
                  </div>
                  {g.remove.map((r) => (
                    <div key={r.id} className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 line-through">
                      <span className="shrink-0 font-medium no-underline">Smazat:</span>
                      <span>{formatDateTime(r.createdAtMs)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};
