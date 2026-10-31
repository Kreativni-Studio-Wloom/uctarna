'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, Loader2, PlugZap, Receipt, Save, XCircle } from 'lucide-react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/contexts/StoreContext';
import { isEetEnabled } from '@/lib/eet/flags';
import { verifyEetConnection } from '@/lib/eetClient';
import { checkEetSettings, eetFormToUpdate, eetSettingsToForm, type EetSettingsForm } from '@/lib/eetUi';
import { EetCertificateUpload } from './EetCertificateUpload';
import { ReceiptSeriesEditor } from './ReceiptSeriesEditor';
import { Switch } from './Switch';

interface EetSettingsProps {
  storeId: string;
}

const inputCls =
  'w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent';

const Field: React.FC<{ label: string; hint?: string; error?: string; htmlFor: string; children: React.ReactNode }> = ({ label, hint, error, htmlFor, children }) => (
  <div>
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      {label}
    </label>
    {children}
    {error ? (
      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
    ) : hint ? (
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
    ) : null}
  </div>
);

/**
 * Nastavení → EET 2.0 (kap. 6.1). Jediná část EET viditelná i při vypnutém EET.
 * Ukládá se samostatně tečkovými cestami `eet.*`, takže prodejna bez EET dostane pole `eet`
 * až tehdy, když tu uživatel něco uloží (a `enabled` zůstane vypnuté).
 */
export const EetSettings: React.FC<EetSettingsProps> = ({ storeId }) => {
  const { user } = useAuth();
  const storeDoc = useStore();
  const enabled = isEetEnabled(storeDoc);
  const saved = useMemo(() => eetSettingsToForm(storeDoc?.eet, storeDoc?.dic), [storeDoc?.eet, storeDoc?.dic]);
  const [form, setForm] = useState<EetSettingsForm>(saved);
  const [saving, setSaving] = useState<'form' | 'toggle' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [verify, setVerify] = useState<{ state: 'idle' | 'running' | 'ok' | 'fail'; message?: string }>({ state: 'idle' });

  // Po uložení / změně z jiného zařízení převezmi uložené hodnoty (porovnání obsahu, ne identity:
  // jiné zápisy do prodejny, např. nahrání certifikátu, rozepsaný formulář nepřepíšou).
  const savedKey = JSON.stringify(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(saved), [savedKey]);

  const certificate = storeDoc?.eet?.certificate ?? null;
  const check = checkEetSettings(form, certificate);
  const savedCheck = checkEetSettings(saved, certificate);
  const dirty = JSON.stringify(form) !== savedKey;
  // Prázdné pole nesvítí červeně (chybějící údaj je vidět v textu u vypínače), jen špatně vyplněné.
  const shownError = (key: 'eic' | 'unitId' | 'registerId') => (form[key].trim() ? check.fieldErrors[key] : undefined);
  const set = <K extends keyof EetSettingsForm>(key: K, value: EetSettingsForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const storeRef = () => doc(db, 'users', user!.uid, 'stores', storeId);

  const setEnvironment = (env: EetSettingsForm['environment']) => {
    if (env === 'production' && form.environment !== 'production') {
      const ok = window.confirm(
        'Přepnout na PRODUKČNÍ prostředí EET? Tržby se pak budou skutečně evidovat u finanční správy. Potřebujete produkční certifikát z DIS+.'
      );
      if (!ok) return;
    }
    set('environment', env);
  };

  const saveForm = async () => {
    if (!user) return;
    // Zapnuté EET nesmí dostat nastavení, se kterým by evidence selhávala.
    if (enabled && check.blockers.length) {
      setError('Při zapnutém EET nejde uložit neplatné nastavení: ' + check.blockers.join(' '));
      return;
    }
    if (Object.keys(check.fieldErrors).length) {
      setError('Opravte zvýrazněná pole.');
      return;
    }
    setSaving('form');
    setError(null);
    try {
      await updateDoc(storeRef(), { ...eetFormToUpdate(form), updatedAt: serverTimestamp() });
      setSavedAt(Date.now());
    } catch (e) {
      console.error('Nastavení EET se nepodařilo uložit', e);
      setError('Nastavení se nepodařilo uložit. Zkuste to znovu.');
    } finally {
      setSaving(null);
    }
  };

  const setEnabled = async (value: boolean) => {
    if (!user) return;
    if (value && (dirty || savedCheck.blockers.length)) return;
    if (!value && !window.confirm('Vypnout EET? Nové prodeje se přestanou evidovat a fronta se zastaví, dokud EET znovu nezapnete.')) return;
    if (value && saved.environment === 'production' && !window.confirm('Zapnout evidenci tržeb v PRODUKČNÍM prostředí?')) return;
    setSaving('toggle');
    setError(null);
    try {
      await updateDoc(storeRef(), { 'eet.enabled': value, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error('EET se nepodařilo přepnout', e);
      setError('Změnu se nepodařilo uložit. Zkuste to znovu.');
    } finally {
      setSaving(null);
    }
  };

  const runVerify = async () => {
    setVerify({ state: 'running' });
    try {
      const r = await verifyEetConnection(storeId);
      setVerify({ state: r.ok ? 'ok' : 'fail', message: `${r.message} (${(r.ms / 1000).toFixed(1)} s${r.region ? `, server ${r.region}` : ''})` });
    } catch (e) {
      setVerify({ state: 'fail', message: (e as Error).message });
    }
  };

  const canEnable = !dirty && savedCheck.blockers.length === 0;
  const enableHint = enabled
    ? `Tržby se evidují (${saved.environment === 'production' ? 'produkce' : 'Playground – jen test'}).`
    : dirty
      ? 'Nejdřív uložte nastavení.'
      : savedCheck.blockers.length
        ? 'Pro zapnutí: ' + savedCheck.blockers.join(' ')
        : 'Vše připraveno, EET lze zapnout.';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.16 }}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
    >
      <div className="flex items-start mb-4">
        <div className="w-12 h-12 shrink-0 bg-brand-100 dark:bg-brand-900/20 rounded-lg flex items-center justify-center mr-4">
          <Receipt className="h-6 w-6 text-brand-600" />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">EET 2.0</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Elektronická evidence tržeb. Ve výchozím stavu vypnuto; bez zapnutí se pokladna chová jako dosud.</p>
        </div>
      </div>

      <div className="space-y-4">
        <div
          className={`flex items-center justify-between gap-4 p-4 rounded-lg border ${
            enabled ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700' : 'bg-gray-50 dark:bg-gray-700 border-transparent'
          }`}
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">EET zapnuto</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{enableHint}</div>
          </div>
          {saving === 'toggle' ? (
            <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
          ) : (
            <Switch checked={enabled} disabled={saving !== null || (!enabled && !canEnable)} onChange={(v) => void setEnabled(v)} label="Zapnout EET" />
          )}
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-800 dark:text-blue-200">
          <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Do EET se odesílají všechny kontaktní platby (hotovost, karta, QR u pultu). Neodesílají se jen doklady označené jako testovací a platby s
            uvedenou zákonnou výjimkou.
          </span>
        </div>

        <fieldset>
          <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Prostředí</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {(
              [
                ['playground', 'Playground', 'Testovací, nic se neeviduje'],
                ['production', 'Produkce', 'Skutečná evidence tržeb'],
              ] as const
            ).map(([value, title, sub]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={form.environment === value}
                onClick={() => setEnvironment(value)}
                className={`text-left p-3 rounded-lg border-2 transition-colors ${
                  form.environment === value
                    ? value === 'production'
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                      : 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                }`}
              >
                <div className="text-sm font-semibold text-gray-900 dark:text-white">{title}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{sub}</div>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="DIČ (EIČ)" htmlFor="eet-eic" error={shownError('eic')}>
            <input
              id="eet-eic"
              value={form.eic}
              onChange={(e) => set('eic', e.target.value.toUpperCase())}
              placeholder="CZ12345678"
              className={`${inputCls} ${shownError('eic') ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'}`}
            />
          </Field>
          <Field label="Číslo evidenční jednotky" htmlFor="eet-unit" hint="Provozovna z portálu DIS+" error={shownError('unitId')}>
            <input
              id="eet-unit"
              inputMode="numeric"
              value={form.unitId}
              onChange={(e) => set('unitId', e.target.value.replace(/\D/g, ''))}
              className={`${inputCls} ${shownError('unitId') ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'}`}
            />
          </Field>
          <Field label="Označení pokladny" htmlFor="eet-register" error={shownError('registerId')}>
            <input
              id="eet-register"
              value={form.registerId}
              onChange={(e) => set('registerId', e.target.value)}
              className={`${inputCls} ${shownError('registerId') ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'}`}
            />
          </Field>
        </div>

        <EetCertificateUpload storeId={storeId} certificate={certificate} environment={form.environment} eic={form.eic} eetEnabled={enabled} />

        <ReceiptSeriesEditor
          prefix={form.receiptPrefix}
          resetYearly={form.resetYearly}
          error={check.fieldErrors.receiptPrefix}
          onChange={({ prefix, resetYearly }) => setForm((f) => ({ ...f, receiptPrefix: prefix, resetYearly }))}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Mezní doba odezvy (s)" htmlFor="eet-timeout" hint="Zákon vyžaduje nejméně 2 s, doporučeno 4 s" error={check.fieldErrors.sendTimeoutMs}>
            <input
              id="eet-timeout"
              type="number"
              min={2}
              max={30}
              step={0.5}
              value={form.sendTimeoutMs / 1000}
              onChange={(e) => set('sendTimeoutMs', Math.round(Number(e.target.value) * 1000))}
              className={`${inputCls} border-gray-300 dark:border-gray-600`}
            />
          </Field>
        </div>

        <div className="space-y-3">
          {(
            [
              ['tipsAreBusinessIncome', 'Spropitné je příjem podniku', 'Spropitné se zahrne do evidované tržby.'],
            ] as const
          ).map(([key, title, sub]) => (
            <div key={key} className="flex items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">{title}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{sub}</div>
              </div>
              <Switch checked={form[key]} onChange={(v) => set(key, v)} label={title} />
            </div>
          ))}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div>
              <div className="text-sm font-medium text-gray-900 dark:text-white mb-1">Okno s výsledkem evidence</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">Úspěšné okno se samo zavře po zadaném počtu sekund.</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                aria-label="Kdy ukázat okno s výsledkem"
                value={form.showResultModal}
                onChange={(e) => set('showResultModal', e.target.value as EetSettingsForm['showResultModal'])}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
              >
                <option value="always">Vždy</option>
                <option value="errorsOnly">Jen při chybě</option>
              </select>
              <input
                aria-label="Zavřít po sekundách"
                type="number"
                min={1}
                max={30}
                value={form.autoCloseSuccessSec}
                onChange={(e) => set('autoCloseSuccessSec', Number(e.target.value))}
                className="w-16 px-2 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white"
              />
              <span className="text-xs text-gray-500">s</span>
            </div>
          </div>
        </div>

        {check.warnings.length > 0 && (
          <ul className="space-y-1 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-200">
            {check.warnings.map((w) => (
              <li key={w} className="flex gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                {w}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveForm}
            disabled={!dirty || saving !== null}
            className="inline-flex items-center px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving === 'form' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" aria-hidden="true" />}
            Uložit nastavení EET
          </button>
          <button
            type="button"
            onClick={runVerify}
            disabled={!certificate || dirty || verify.state === 'running'}
            title={!certificate ? 'Nejdřív nahrajte certifikát' : dirty ? 'Nejdřív uložte nastavení' : undefined}
            className="inline-flex items-center px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {verify.state === 'running' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" aria-hidden="true" />}
            Ověřit spojení
          </button>
          {savedAt && !dirty && <span className="text-sm text-green-700 dark:text-green-400">Uloženo</span>}
        </div>

        {(verify.state === 'ok' || verify.state === 'fail') && (
          <div
            role="status"
            className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
              verify.state === 'ok' ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
            }`}
          >
            {verify.state === 'ok' ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <span>{verify.message}</span>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </motion.div>
  );
};
