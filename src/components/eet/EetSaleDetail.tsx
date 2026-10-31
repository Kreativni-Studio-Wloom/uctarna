'use client';

import React, { useState } from 'react';
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react';
import { canResendToEet, toDateLoose, type EetSaleLike } from '@/lib/eetUi';
import type { Store } from '@/types';
import { EetBadge } from './EetBadge';

interface EetSaleDetailProps {
  sale: EetSaleLike & { id: string };
  store: Pick<Store, 'eet'> | null;
  onResend: (saleId: string) => Promise<void>;
}

const fmt = (v: unknown) => {
  const d = toDateLoose(v);
  return d ? new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d) : '—';
};

const RESULT_LABEL: Record<string, string> = { ok: 'přijato', error: 'chyba', timeout: 'bez odpovědi', network: 'nedostupné' };

/** Detail dokladu → sekce EET: stav, POK, varování, pokusy a „Odeslat znovu“ (kap. 6.4). */
export const EetSaleDetail: React.FC<EetSaleDetailProps> = ({ sale, store, onResend }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eet = sale.eet;
  if (!eet && !sale.receiptNo && !sale.stornoOf && !sale.storno) return null;

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      await onResend(sale.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-900 dark:text-white">EET</span>
        <EetBadge sale={sale} />
      </div>
      {eet?.env && (
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Prostředí</span>
          <span className="text-gray-900 dark:text-white">{eet.env === 'production' ? 'Produkce' : 'Playground (test)'}</span>
        </div>
      )}
      {eet?.pok && (
        <div>
          <div className="text-gray-600 dark:text-gray-400">POK</div>
          <div className="font-mono text-xs break-all text-gray-900 dark:text-white">{eet.pok}</div>
        </div>
      )}
      {eet?.receivedAt && (
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Přijato</span>
          <span className="text-gray-900 dark:text-white">{fmt(eet.receivedAt)}</span>
        </div>
      )}
      {eet?.reason && <p className="text-gray-700 dark:text-gray-300">{eet.reason}</p>}
      {eet?.message && eet.status !== 'sent' && <p className="text-red-700 dark:text-red-300">{eet.message}</p>}
      {sale.stornoOf && <p className="text-gray-700 dark:text-gray-300">Storno dokladu {sale.stornoOf}</p>}
      {sale.storno?.saleId && <p className="text-gray-700 dark:text-gray-300">Stornováno dokladem {sale.storno.saleId}</p>}
      {sale.pendingNumber && !sale.receiptNo && <p className="text-gray-600 dark:text-gray-400">Uloženo offline, číslo dokladu se přidělí po připojení.</p>}

      {eet?.warnings && eet.warnings.length > 0 && (
        <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 space-y-1">
          {eet.warnings.map((w) => (
            <div key={`${w.code}-${w.text}`} className="flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {w.text} (kód {w.code})
              </span>
            </div>
          ))}
        </div>
      )}

      {eet?.attempts && eet.attempts.length > 0 && (
        <details className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-2">
          <summary className="cursor-pointer text-gray-700 dark:text-gray-300">Pokusy o odeslání ({eet.attempts.length})</summary>
          <ol className="mt-2 space-y-2">
            {eet.attempts.map((a, i) => (
              <li key={a.uuid || i} className="text-xs text-gray-700 dark:text-gray-300">
                <div>
                  {i + 1}. {fmt(a.sentAt)} · {RESULT_LABEL[a.result] ?? a.result}
                  {typeof a.code === 'number' ? ` (kód ${a.code})` : ''} · {(a.ms / 1000).toFixed(1)} s{a.first ? ' · první zaslání' : ''}
                </div>
                {a.text && <div className="text-gray-500 dark:text-gray-400">{a.text}</div>}
                {a.xGlobalTransactionId && <div className="font-mono text-gray-500 dark:text-gray-400 break-all">X-Global-Transaction-Id: {a.xGlobalTransactionId}</div>}
              </li>
            ))}
          </ol>
        </details>
      )}

      {canResendToEet(store, sale) && (
        <button
          type="button"
          onClick={resend}
          disabled={busy}
          className="w-full mt-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 py-2 px-4 rounded-lg font-medium hover:bg-red-100 dark:hover:bg-red-900/40 flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" aria-hidden="true" />}
          Odeslat znovu
        </button>
      )}
      {error && (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
};
