'use client';

import React, { useEffect, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { useAuth } from '@/contexts/AuthContext';
import { profitProtectionRequest } from '@/lib/profit-protection-client';
import { Lock } from 'lucide-react';

export function ProfitProtectionSettings({ storeId }: { storeId: string }) {
  const { firebaseUser } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [hideProfit, setHideProfit] = useState<boolean | null>(null);
  const [action, setAction] = useState<'enable' | 'disable' | 'hide-enable' | 'hide-disable' | null>(null);
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    setEnabled(null);
    setHideProfit(null);
    profitProtectionRequest(storeId).then(data => { if (active) { setEnabled(data.enabled === true); setHideProfit(data.hideProfit === true); } })
      .catch(() => { if (active) setError('Nastavení ochrany se nepodařilo načíst.'); });
    return () => { active = false; };
  }, [firebaseUser?.uid, retry, storeId]);
  const clear = () => { setPassword(''); setPin(''); setConfirmPin(''); setAction(null); };
  const toggleHiding = async (next: boolean) => {
    if (!firebaseUser?.email || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await reauthenticateWithCredential(firebaseUser, EmailAuthProvider.credential(firebaseUser.email, password));
      const result = await profitProtectionRequest(storeId, { action: next ? 'hide-enable' : 'hide-disable' });
      setHideProfit(result.hideProfit === true);
      setMessage(next ? 'Skrývání zisku je zapnuté.' : 'Skrývání zisku je vypnuté.');
      clear();
    } catch (e) { setError(e instanceof Error ? e.message : 'Uložení se nepodařilo.'); setPassword(''); }
    finally { setBusy(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!firebaseUser?.email || !action || busy) return;
    setError(''); setMessage('');
    if (action === 'enable' && (!/^\d{4}$/.test(pin) || pin !== confirmPin)) {
      setError('Zadejte shodný čtyřmístný PIN do obou polí.'); return;
    }
    setBusy(true);
    try {
      await reauthenticateWithCredential(firebaseUser, EmailAuthProvider.credential(firebaseUser.email, password));
      const result = await profitProtectionRequest(storeId, { action, ...(action === 'enable' ? { pin } : {}) });
      setEnabled(result.enabled === true);
      setMessage(action === 'enable' ? (hideProfit ? 'PIN byl uložen. Zisk je chráněný.' : 'PIN byl uložen. Pro ochranu zisku zapněte také jeho skrývání.') : (hideProfit ? 'Ochrana PINem je vypnutá. Zisk zůstává skrytý do kliknutí.' : 'Ochrana PINem je vypnutá.'));
      clear();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code?.startsWith('auth/') ? 'Heslo se nepodařilo ověřit. Zkontrolujte ho a zkuste to znovu.' : e instanceof Error ? e.message : 'Uložení se nepodařilo.');
      setPassword('');
    } finally { setBusy(false); }
  };
  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[rgb(var(--brand-500))] focus:border-[rgb(var(--brand-500))]';
  return <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-lg">
    <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white"><Lock className="h-5 w-5 text-brand-600" /> Soukromí zisku</h3>
    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Nejdříve zvolte, zda se má zisk skrývat. PIN pak může chránit jeho odkrytí.</p>
    {hideProfit !== null && <div className="mt-4 rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
      <div className="flex items-center justify-between gap-4"><div><p className="font-medium text-gray-900 dark:text-white">Skrývat zisk</p><p className="text-xs text-gray-500 dark:text-gray-400">Zisk bude rozmazaný do kliknutí.</p></div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
          <input type="checkbox" checked={hideProfit} disabled={busy} onChange={() => { setPassword(''); setAction(hideProfit ? 'hide-disable' : 'hide-enable'); }} aria-label="Skrývat zisk" className="sr-only peer" />
          <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-brand-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-brand-500 peer-focus:ring-offset-2 peer-focus:ring-offset-white dark:peer-focus:ring-offset-gray-700 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
        </label>
      </div>
    </div>}
    <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">{enabled === null ? (error ? 'Ochrana zisku není dostupná' : 'Načítám nastavení…') : enabled ? 'Ochrana PINem je zapnutá' : 'Ochrana PINem je vypnutá'}</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-green-600 dark:text-green-400">{message}</p>}
    {enabled === null && error && <button onClick={() => setRetry(v => v + 1)} className="mt-3 text-sm text-brand-600">Zkusit znovu</button>}
    {enabled !== null && !action && <div className="mt-4 flex flex-wrap gap-3">
      <button onClick={() => { setAction('enable'); setMessage(''); setError(''); }} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white">{enabled ? 'Změnit / resetovat PIN' : 'Zapnout ochranu PINem'}</button>
      {enabled && <button onClick={() => { setAction('disable'); setMessage(''); setError(''); }} className="rounded-lg bg-gray-100 dark:bg-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-200">Vypnout ochranu</button>}
    </div>}
    {action && <form onSubmit={action.startsWith('hide-') ? (e) => { e.preventDefault(); void toggleHiding(action === 'hide-enable'); } : save} className="mt-4 max-w-sm space-y-3">
      <label className="block text-sm text-gray-700 dark:text-gray-300">Heslo účtu
        <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
      </label>
      {action === 'enable' && <>
        <label className="block text-sm text-gray-700 dark:text-gray-300">Nový čtyřmístný PIN
          <input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} required value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} className={inputClass} />
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-300">Potvrzení PINu
          <input type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{4}" maxLength={4} required value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ''))} className={inputClass} />
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400">Původní PIN nepotřebujete. Změnu potvrdíte heslem účtu.</p>
      </>}
      <div className="flex gap-3">
        <button disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Ukládám…' : action.startsWith('hide-') ? 'Potvrdit heslem' : action === 'enable' ? 'Uložit PIN' : 'Vypnout ochranu'}</button>
        <button type="button" disabled={busy} onClick={clear} className="rounded-lg bg-gray-100 dark:bg-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-200">Zrušit</button>
      </div>
    </form>}
  </section>;
}
