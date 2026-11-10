'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  BLUEFY_SAME_WINDOW_VARIANTS,
  BLUEFY_VARIANTS,
  detectBrowser,
  getBluefySameWindow,
  getBluefyVariant,
  setBluefySameWindow,
  setBluefyVariant,
  type BrowserKind,
} from '@/lib/browserReturn';

// Nastavení návratu ze SumUp do Bluefy.
// A) „Stejné okno“ (doporučeno): SumUp jen přepne zpět do Bluefy, pokladna si
//    výsledek ověří u SumUp. Testuje se z Bluefy → Safari → zpět do Bluefy.
// B) „Nová záložka“ (záloha): SumUp otevře stránku v Bluefy. Testuje se ze Safari.

const SW_TEST_KEY = 'uctarna_bluefy_sw_test';

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

const box = 'p-4 rounded-lg bg-white dark:bg-gray-800 shadow text-sm text-gray-800 dark:text-gray-200 space-y-3';
const optionBtn =
  'block w-full text-left px-4 py-3 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 font-mono';
const primaryBtn = 'bg-brand-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-brand-700';

function SumUpNavratContent() {
  const searchParams = useSearchParams();
  const [browser, setBrowser] = useState<BrowserKind>('other');
  const [origin, setOrigin] = useState('');
  const [pageVariant, setPageVariant] = useState<string | null>(null);
  const [sameWindow, setSameWindow] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [swAsk, setSwAsk] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Jen Bluefy schémata – stránka nesmí sloužit jako přesměrování kamkoli jinam.
  const jumpRaw = searchParams.get('jump');
  const jump = jumpRaw && /^bluefy[a-z-]*:\/\//i.test(jumpRaw) ? jumpRaw : null;

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
    setPageVariant(getBluefyVariant()?.label ?? null);
    setSameWindow(getBluefySameWindow()?.url ?? null);
  }, [searchParams]);

  // Test stejného okna: po návratu ze Safari se zeptáme, jestli jsme opravdu v tomto okně.
  useEffect(() => {
    if (browser !== 'bluefy') return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const raw = sessionStorage.getItem(SW_TEST_KEY);
        if (!raw) return;
        const test = JSON.parse(raw);
        const variant = BLUEFY_SAME_WINDOW_VARIANTS.find((v) => v.id === test?.id);
        if (variant && Date.now() - (test.at ?? 0) < 5 * 60 * 1000) setSwAsk(variant);
      } catch {
        // ignorujeme
      }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', check);
    };
  }, [browser]);

  const startSameWindowTest = (variant: { id: string; url: string }) => {
    try {
      sessionStorage.setItem(SW_TEST_KEY, JSON.stringify({ id: variant.id, at: Date.now() }));
    } catch {
      // ignorujeme
    }
    setSwAsk(null);
    // SumUp přidá k callbacku parametry – test je simuluje.
    const target = `${variant.url}?smp-status=test`;
    const safariUrl = `${origin}/sumup-navrat?jump=${encodeURIComponent(target)}`;
    window.location.href = safariUrl.replace(/^https:/, 'x-safari-https:');
  };

  const answerSameWindow = (ok: boolean) => {
    if (swAsk && ok) {
      setBluefySameWindow(swAsk.id);
      setSameWindow(swAsk.url);
      setJustSaved(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    try {
      sessionStorage.removeItem(SW_TEST_KEY);
    } catch {
      // ignorujeme
    }
    setSwAsk(null);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/sumup-navrat`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  // Safari: krok testu stejného okna – tlačítko, které udělá totéž co SumUp po platbě.
  if (jump && browser !== 'bluefy') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
        <div className="max-w-xl mx-auto px-4 space-y-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Test návratu do Bluefy</h1>
          <div className={box}>
            <p>Klepněte na tlačítko (a případně potvrďte „Otevřít“). Tím se simuluje návrat ze SumUp.</p>
            <a href={jump} className={`${primaryBtn} block text-center`}>
              Vrátit do Bluefy
            </a>
            <p className="text-gray-500 dark:text-gray-400">
              Když se nic nestane, vraťte se do Bluefy ručně a zkuste další variantu.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-xl mx-auto px-4 space-y-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Návrat ze SumUp do Bluefy</h1>

        {result?.kind === 'ok' && (
          <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 text-sm">
            {result.savedInBluefy
              ? <>Funguje ✓ Varianta <b>{result.label}</b> je uložená jako záloha.</>
              : <>Odkaz <b>{result.label}</b> se otevřel v jiném prohlížeči než Bluefy – zkuste další variantu.</>}
          </div>
        )}
        {result?.kind === 'params-lost' && (
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 text-sm">
            Bluefy se otevřelo, ale varianta <b>{result.label}</b> ztratila parametry platby – nepoužitelná. Zkuste další.
          </div>
        )}

        {browser === 'bluefy' ? (
          <>
            {sameWindow && (
              <div
                className={`p-4 rounded-lg text-sm flex items-start gap-3 ${
                  justSaved
                    ? 'bg-green-600 text-white'
                    : 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                }`}
              >
                <span className="text-2xl leading-none">✓</span>
                <div>
                  <div className="font-semibold text-base">
                    {justSaved ? 'Uloženo – nastaveno správně' : 'Nastaveno správně'}
                  </div>
                  <div>Po platbě kartou se vrátíte do stejného okna Bluefy. Nic dalšího není potřeba.</div>
                </div>
              </div>
            )}

            {swAsk && (
              <div className="p-4 rounded-lg bg-sky-50 dark:bg-sky-900/20 text-sky-900 dark:text-sky-200 text-sm space-y-3">
                <p>
                  Vrátilo vás to <b>do tohoto okna</b> (bez nové záložky)? Varianta <b className="font-mono">{swAsk.url}</b>
                </p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => answerSameWindow(true)} className={`${primaryBtn} flex-1`}>
                    Ano, uložit
                  </button>
                  <button
                    type="button"
                    onClick={() => answerSameWindow(false)}
                    className="flex-1 px-4 py-2.5 rounded-lg font-medium border border-gray-300 dark:border-gray-600"
                  >
                    Ne
                  </button>
                </div>
              </div>
            )}

            <div className={box}>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">1. Stejné okno (doporučeno)</h2>
              <p>
                Stav: {sameWindow
                  ? <>nastaveno (<b className="font-mono">{sameWindow}</b>) – po platbě se vrátíte do stejného okna a pokladna platbu sama ověří.</>
                  : <>nenastaveno.</>}
              </p>
              <p>
                Klepněte na variantu → otevře se Safari → tam klepněte „Vrátit do Bluefy“. Pokud se vrátíte sem do
                tohoto okna, potvrďte „Ano, uložit“. Pokud se otevře nová záložka nebo nic, zkuste další.
              </p>
              <div className="space-y-2">
                {origin && BLUEFY_SAME_WINDOW_VARIANTS.map((v, i) => (
                  <button key={v.id} type="button" onClick={() => startSameWindowTest(v)} className={optionBtn}>
                    {i + 1}. {v.url}
                  </button>
                ))}
              </div>
              {sameWindow && (
                <button
                  type="button"
                  onClick={() => {
                    setBluefySameWindow(null);
                    setSameWindow(null);
                  }}
                  className="text-sm underline text-gray-500 dark:text-gray-400"
                >
                  Vypnout návrat do stejného okna
                </button>
              )}
            </div>

            <div className={box}>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">2. Nová záložka (záloha)</h2>
              <p>
                Stav: {pageVariant
                  ? <>nastaveno (<b>{pageVariant}</b>).</>
                  : <>nenastaveno – bez stejného okna vás SumUp vrátí do Safari.</>}
              </p>
              {!pageVariant && (
                <>
                  <p>Zkopírujte odkaz, otevřete ho v <b>Safari</b> a klepejte na varianty, dokud se tady v Bluefy neobjeví „Funguje ✓“.</p>
                  <button type="button" onClick={copyLink} className={primaryBtn}>
                    {copied ? 'Zkopírováno' : 'Zkopírovat odkaz'}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <div className={box}>
            <p>
              Klepejte postupně na varianty. Správná otevře Bluefy a ukáže „Funguje ✓“.
              Když se nic nestane nebo se objeví chyba, vraťte se sem a zkuste další.
            </p>
            <div className="space-y-2">
              {origin && BLUEFY_VARIANTS.map((v, i) => (
                <a key={v.id} href={buildTestLink(origin, v.id)} className={optionBtn}>
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
