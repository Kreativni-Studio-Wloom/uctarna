'use client';

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { profitProtectionRequest } from '@/lib/profit-protection-client';

const Privacy = createContext({ revealed: false, hideProfit: true, busy: false, reveal: () => {}, hide: () => {} });

export function ProfitPrivacy({ children, storeId }: { children: React.ReactNode; storeId: string }) {
  return <ProfitPrivacyState key={storeId} storeId={storeId}>{children}</ProfitPrivacyState>;
}

function ProfitPrivacyState({ children, storeId }: { children: React.ReactNode; storeId: string }) {
  const [revealed, setRevealed] = useState(false);
  const [hideProfit, setHideProfit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [protectionEnabled, setProtectionEnabled] = useState(false);
  const [protectionLoaded, setProtectionLoaded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const hide = () => {
      if (document.hidden) {
        setRevealed(false);
        dialog.current?.close();
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => { active.current = false; document.removeEventListener('visibilitychange', hide); };
  }, []);

  // Stav ochrany načteme při otevření přehledu, aby kliknutí na blur nebylo
  // závislé na odezvě sítě.
  useEffect(() => {
    let active = true;
    profitProtectionRequest(storeId).then(status => {
      if (!active) return;
      setProtectionEnabled(status.enabled === true);
      setHideProfit(status.hideProfit === true);
      setProtectionLoaded(true);
    }).catch(() => {
      // Bez ověřeného nastavení zůstává zisk skrytý; kliknutí načtení zopakuje.
    });
    return () => { active = false; };
  }, [storeId]);

  const reveal = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNeedsPin(false);
    try {
      let hidden = hideProfit;
      let protectedByPin = protectionEnabled;
      if (!protectionLoaded) {
        const status = await profitProtectionRequest(storeId);
        if (!active.current || document.hidden) return;
        hidden = status.hideProfit === true;
        protectedByPin = status.enabled === true;
        setHideProfit(hidden);
        setProtectionEnabled(protectedByPin);
        setProtectionLoaded(true);
      }
      if (!active.current || document.hidden) return;
      if (!hidden) setRevealed(true);
      else if (protectedByPin) { setNeedsPin(true); dialog.current?.showModal(); }
      else setRevealed(true);
    } catch (e) {
      if (active.current && !document.hidden) {
        setError(e instanceof Error ? e.message : 'Ověření se nepodařilo.');
        dialog.current?.showModal();
      }
    } finally { if (active.current) setBusy(false); }
  };
  useEffect(() => {
    if (needsPin) dialog.current?.querySelector('input')?.focus();
  }, [needsPin]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await profitProtectionRequest(storeId, { action: 'verify', pin });
      if (active.current && dialog.current?.open) {
        setRevealed(true);
        dialog.current.close();
      }
    } catch (e) {
      if (active.current) { setError(e instanceof Error ? e.message : 'Ověření se nepodařilo.'); setPin(''); }
    } finally { if (active.current) setBusy(false); }
  };
  return <Privacy.Provider value={{ revealed, hideProfit, busy, reveal, hide: () => setRevealed(false) }}>
    {children}
    <dialog ref={dialog} onClose={() => { setPin(''); setError(''); }}
      aria-labelledby="profit-pin-title"
      className="w-full max-w-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-gray-900 dark:text-white shadow-xl backdrop:bg-black/50">
      <h3 id="profit-pin-title" className="text-lg font-semibold mb-4">Zobrazení zisku</h3>
      {busy && !needsPin && <p role="status" className="text-sm text-gray-500">Ověřuji ochranu…</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
      {needsPin && <form onSubmit={unlock}>
        <label htmlFor="profit-pin" className="block text-sm mb-2">Čtyřmístný PIN</label>
        <input id="profit-pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4}
          autoComplete="off" autoFocus required value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent px-4 py-3 text-center text-xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-500))] focus:border-[rgb(var(--brand-500))]" />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">Zapomenutý PIN obnovíte v nastavení pomocí hesla účtu.</p>
        <button disabled={busy || pin.length !== 4} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Ověřuji…' : 'Zobrazit zisk'}</button>
      </form>}
      {!needsPin && error && <button onClick={reveal} disabled={busy} className="mt-3 text-sm text-brand-600">Zkusit znovu</button>}
      <button onClick={() => dialog.current?.close()} className="mt-4 w-full rounded-lg bg-gray-100 dark:bg-gray-700 px-4 py-2 text-sm">Zrušit</button>
    </dialog>
  </Privacy.Provider>;
}

export function PrivateProfit({ value }: { value: number }) {
  const { revealed, hideProfit, busy, reveal, hide } = useContext(Privacy);
  const reduceMotion = useReducedMotion();
  if (!hideProfit) return <span>{value.toLocaleString('cs-CZ')} Kč</span>;
  return <button type="button" onClick={revealed ? hide : reveal} disabled={busy} aria-busy={busy}
    aria-label={revealed ? `Zisk ${value.toLocaleString('cs-CZ')} Kč. Kliknutím skrýt.` : 'Zobrazit zisk'} aria-expanded={revealed}
    className="inline-block !min-h-0 !min-w-0 overflow-visible whitespace-nowrap rounded border-0 p-0 text-left align-baseline leading-[inherit] disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    onCopy={event => { if (!revealed) event.preventDefault(); }}>
    <motion.span key={revealed ? 'visible' : 'hidden'} aria-hidden={!revealed}
      initial={revealed ? { filter: 'blur(4px)', opacity: 0.65 } : false}
      animate={{ filter: revealed ? 'blur(0px)' : 'blur(4px)', opacity: revealed ? 1 : 0.65 }}
      transition={{ duration: reduceMotion ? 0 : 0.22 }}
      className={revealed ? 'inline-block' : 'inline-block select-none pointer-events-none'}>
      {revealed ? `${value.toLocaleString('cs-CZ')} Kč` : '88 888 Kč'}
    </motion.span>
  </button>;
}
