'use client';

import React, { useEffect, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { useAuth } from '@/contexts/AuthContext';
import { profitProtectionRequest } from '@/lib/profit-protection-client';
import { Lock } from 'lucide-react';

export function ProfitProtectionSettings() {
  const { firebaseUser } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [action, setAction] = useState<'enable' | 'disable' | null>(null);
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
    profitProtectionRequest().then(data => { if (active) setEnabled(data.enabled === true); })
      .catch(() => { if (active) setError('Nastavení ochrany se nepodařilo načíst.'); });
    return () => { active = false; };
  }, [firebaseUser?.uid, retry]);
  const clear = () => { setPassword(''); setPin(''); setConfirmPin(''); setAction(null); };
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
      const result = await profitProtectionRequest({ action, ...(action === 'enable' ? { pin } : {}) });
      setEnabled(result.enabled === true);
      setMessage(action === 'enable' ? 'PIN byl uložen. Zisk je chráněný.' : 'Ochrana PINem je vypnutá. Zisk zůstává skrytý do kliknutí.');
      clear();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code?.startsWith('auth/') ? 'Heslo se nepodařilo ověřit. Zkontrolujte ho a zkuste to znovu.' : e instanceof Error ? e.message : 'Uložení se nepodařilo.');
      setPassword('');
    } finally { setBusy(false); }
  };
  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500';
  return <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-lg">
    <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white"><Lock className="h-5 w-5 text-brand-600" /> Soukromí zisku</h3>
    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Zisk v přehledu je rozmazaný do kliknutí. Volitelný PIN platí pro všechny prodejny tohoto účtu.</p>
    <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">{enabled === null ? 'Načítám nastavení…' : enabled ? 'Ochrana PINem je zapnutá' : 'Ochrana PINem je vypnutá'}</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-green-600 dark:text-green-400">{message}</p>}
    {enabled === null && error && <button onClick={() => setRetry(v => v + 1)} className="mt-3 text-sm text-brand-600">Zkusit znovu</button>}
    {enabled !== null && !action && <div className="mt-4 flex flex-wrap gap-3">
      <button onClick={() => { setAction('enable'); setMessage(''); setError(''); }} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white">{enabled ? 'Změnit / resetovat PIN' : 'Zapnout ochranu PINem'}</button>
      {enabled && <button onClick={() => { setAction('disable'); setMessage(''); setError(''); }} className="rounded-lg bg-gray-100 dark:bg-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-200">Vypnout ochranu</button>}
    </div>}
    {action && <form onSubmit={save} className="mt-4 max-w-sm space-y-3">
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
        <button disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Ukládám…' : action === 'enable' ? 'Uložit PIN' : 'Vypnout ochranu'}</button>
        <button type="button" disabled={busy} onClick={clear} className="rounded-lg bg-gray-100 dark:bg-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-200">Zrušit</button>
      </div>
    </form>}
  </section>;
}
