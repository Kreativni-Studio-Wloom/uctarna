'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { handOffToPos, shouldHandOffToPos } from '@/lib/browserReturn';

// Návrat ze SumUp může v některých prohlížečích (Bluefy) dorazit na jinou cestu,
// než jakou jsme poslali (např. /payment/failed nebo s upravenou cestou). Pokud
// adresa nese výsledek platby (smp-status), dokončíme ho jako běžný návrat.
function findSumUpParams(href: string): URLSearchParams | null {
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // ponecháme původní adresu
  }
  const idx = decoded.search(/[?&]smp-status=/);
  if (idx === -1) return null;
  return new URLSearchParams(decoded.slice(idx + 1));
}

export default function NotFound() {
  const [redirecting, setRedirecting] = useState(true);

  useEffect(() => {
    const params = findSumUpParams(window.location.href);
    if (!params) {
      setRedirecting(false);
      return;
    }
    const status = params.get('smp-status');
    const txCode = params.get('smp-tx-code');
    const foreignTxId = params.get('foreign-tx-id');

    if (shouldHandOffToPos()) {
      const handled =
        status === 'success'
          ? handOffToPos({ status: 'success', txCode, foreignTxId })
          : handOffToPos({ status: 'fail' });
      if (handled) return;
    }
    const target = status === 'success' ? '/payment/success' : '/payment/fail';
    window.location.replace(`${target}?${params.toString()}`);
  }, []);

  if (redirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-900 px-4 text-center">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Stránka nenalezena</h1>
      <Link href="/" className="bg-brand-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-brand-700">
        Zpět na hlavní stránku
      </Link>
    </div>
  );
}
