'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BLUEFY_VARIANTS,
  detectBrowser,
  getBluefyVariant,
  setBluefyVariant,
  type BrowserKind,
} from '@/lib/browserReturn';

// Jednorázové nastavení návratu ze SumUp do Bluefy.
// 1) Stránku otevřete v Safari a klepejte na varianty.
// 2) Varianta, která otevře Bluefy a donese parametry (jako SumUp), se v Bluefy uloží.

type Result =
  | { kind: 'ok'; label: string; savedInBluefy: boolean }
  | { kind: 'params-lost'; label: string }
  | null;

function buildTestLink(origin: string, variantId: string): string {
  const variant = BLUEFY_VARIANTS.find((v) => v.id === variantId)!;
  const built = variant.build(new URL(`${origin}/sumup-navrat?v=${variantId}`));
  // Stejně jako SumUp: k callbacku přidá svoje parametry.
  return `${built}${built.includes('?') ? '&' : '?'}smp-status=test`;
}

function SumUpNavratContent() {
  const searchParams = useSearchParams();
  const [browser, setBrowser] = useState<BrowserKind>('other');
  const [origin, setOrigin] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const kind = detectBrowser();
    setBrowser(kind);
    setOrigin(window.location.origin);

    const id = searchParams.get('v');
    const variant = BLUEFY_VARIANTS.find((v) => v.id === id);
    if (variant) {
      if (searchParams.get('smp-status') === 'test') {
        if (kind === 'bluefy') setBluefyVariant(variant.id);
        setResult({ kind: 'ok', label: variant.label, savedInBluefy: kind === 'bluefy' });
      } else {
        setResult({ kind: 'params-lost', label: variant.label });
      }
    }
    setCurrent(getBluefyVariant()?.label ?? null);
  }, [searchParams]);

  const pageUrl = origin ? `${origin}/sumup-navrat` : '';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-xl mx-auto px-4 space-y-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Návrat ze SumUp do Bluefy</h1>

        {result?.kind === 'ok' && (
          <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 text-sm">
            {result.savedInBluefy
              ? <>Funguje ✓ Varianta <b>{result.label}</b> je uložená. Po platbě v SumUp se teď vrátíte sem do Bluefy.</>
              : <>Odkaz <b>{result.label}</b> sice prošel, ale otevřel se v jiném prohlížeči než Bluefy – zkuste další variantu.</>}
          </div>
        )}
        {result?.kind === 'params-lost' && (
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-sm">
            Bluefy se otevřelo, ale varianta <b>{result.label}</b> ztratila parametry platby – pro SumUp nepoužitelná. Vraťte se do Safari a zkuste další.
          </div>
        )}

        {browser === 'bluefy' ? (
          <div className="p-4 rounded-lg bg-white dark:bg-gray-800 shadow text-sm text-gray-800 dark:text-gray-200 space-y-3">
            <p>
              Stav: {current
                ? <>nastaveno (<b>{current}</b>) – SumUp vás vrátí do Bluefy.</>
                : <>zatím nenastaveno – SumUp vás po platbě vrátí do Safari.</>}
            </p>
            {!current && (
              <>
                <p>Zkopírujte odkaz, otevřete ho v <b>Safari</b> a klepejte na varianty, dokud se neobjeví „Funguje ✓“ tady v Bluefy.</p>
                <button
                  type="button"
                  onClick={copyLink}
                  className="bg-brand-600 text-white px-3 py-2 rounded-lg font-medium hover:bg-brand-700"
                >
                  {copied ? 'Zkopírováno' : 'Zkopírovat odkaz'}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-white dark:bg-gray-800 shadow text-sm text-gray-800 dark:text-gray-200 space-y-3">
            <p>
              Klepejte postupně na varianty. Správná otevře Bluefy a ukáže „Funguje ✓“ – pak už nic dalšího nedělejte.
              Když se nic nestane nebo se objeví chyba, vraťte se sem a zkuste další.
            </p>
            <div className="space-y-2">
              {origin && BLUEFY_VARIANTS.map((v, i) => (
                <a
                  key={v.id}
                  href={buildTestLink(origin, v.id)}
                  className="block w-full text-left px-4 py-3 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 font-mono"
                >
                  {i + 1}. {v.label}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SumUpNavratPage() {
  return (
    <Suspense fallback={null}>
      <SumUpNavratContent />
    </Suspense>
  );
}
