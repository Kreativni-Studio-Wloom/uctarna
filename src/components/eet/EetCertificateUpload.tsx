'use client';

import React, { useRef, useState } from 'react';
import { FileKey2, Loader2, Trash2, Upload } from 'lucide-react';
import { deleteEetCertificate, uploadEetCertificate } from '@/lib/eetClient';
import { envLabel, toDateLoose, type CertificateMeta } from '@/lib/eetUi';
import type { EetEnvironmentId } from '@/types';

interface EetCertificateUploadProps {
  storeId: string;
  certificate: CertificateMeta | null | undefined;
  environment: EetEnvironmentId;
  eic: string;
  /** Při zapnutém EET nejde certifikát odstranit (nejdřív vypnout). */
  eetEnabled: boolean;
}

const fmtDate = (v: unknown) => {
  const d = toDateLoose(v);
  return d ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(d) : '—';
};

/** Nahrání certifikátu .p12 (POST /api/eet/certificate). Metadata pak přijdou přes StoreContext. */
export const EetCertificateUpload: React.FC<EetCertificateUploadProps> = ({ storeId, certificate, environment, eic, eetEnabled }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'upload' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!certificate);

  const upload = async () => {
    if (!file) return;
    setBusy('upload');
    setError(null);
    setInfo(null);
    try {
      const r = await uploadEetCertificate({ storeId, file, password, environment, eic: eic.trim().toUpperCase() || undefined });
      setInfo(`Certifikát pro ${r.certificate.subjectEic} uložen (platný do ${fmtDate(r.certificate.validTo)}).`);
      setFile(null);
      setPassword('');
      if (fileRef.current) fileRef.current.value = '';
      setShowForm(false);
    } catch (e) {
      setError((e as Error).message || 'Certifikát se nepodařilo nahrát.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm('Opravdu odstranit certifikát EET? Bez něj nejde EET používat.')) return;
    setBusy('delete');
    setError(null);
    setInfo(null);
    try {
      await deleteEetCertificate(storeId);
      setShowForm(true);
    } catch (e) {
      setError((e as Error).message || 'Certifikát se nepodařilo odstranit.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
        <FileKey2 className="h-4 w-4 text-brand-600" aria-hidden="true" />
        Certifikát pro evidenci
      </div>

      {certificate && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-gray-500 dark:text-gray-400">DIČ</dt>
          <dd className="font-medium text-gray-900 dark:text-white">{certificate.subjectEic}</dd>
          <dt className="text-gray-500 dark:text-gray-400">Prostředí</dt>
          <dd className="font-medium text-gray-900 dark:text-white">{certificate.env === 'production' ? 'Produkce' : 'Playground (test)'}</dd>
          <dt className="text-gray-500 dark:text-gray-400">Platnost</dt>
          <dd className="font-medium text-gray-900 dark:text-white">
            {fmtDate(certificate.validFrom)} – {fmtDate(certificate.validTo)}
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">Sériové číslo</dt>
          <dd className="font-mono text-xs text-gray-900 dark:text-white break-all">{certificate.serial}</dd>
        </dl>
      )}

      {certificate && !showForm && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600"
          >
            <Upload className="h-4 w-4 mr-2" aria-hidden="true" />
            Nahrát nový
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy !== null || eetEnabled}
            title={eetEnabled ? 'Nejdřív EET vypněte' : undefined}
            className="inline-flex items-center px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === 'delete' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />}
            Odstranit
          </button>
        </div>
      )}

      {showForm && (
        <div className="space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Soubor .p12 z portálu DIS+ a heslo k němu. Nahrává se pro prostředí {envLabel(environment)}; DIČ v certifikátu musí odpovídat DIČ níže.
            Certifikát se ukládá šifrovaně a do prohlížeče se už nevrací.
          </p>
          <label className="block">
            <span className="sr-only">Soubor certifikátu</span>
            <input
              ref={fileRef}
              type="file"
              accept=".p12,.pfx,application/x-pkcs12"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-700 dark:text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 dark:file:bg-brand-900/30 dark:file:text-brand-300 file:font-medium"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Heslo k certifikátu</span>
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={upload}
              disabled={!file || busy !== null}
              className="inline-flex items-center px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'upload' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" aria-hidden="true" />}
              {busy === 'upload' ? 'Ověřuji certifikát…' : 'Nahrát certifikát'}
            </button>
            {certificate && (
              <button
                type="button"
                onClick={() => setShowForm(false)}
                disabled={busy !== null}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
              >
                Zrušit
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {info && <p className="text-sm text-green-700 dark:text-green-400">{info}</p>}
    </div>
  );
};
