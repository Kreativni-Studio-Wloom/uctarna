import { auth } from '@/lib/firebase';

export async function profitProtectionRequest(body?: { action: 'verify' | 'enable' | 'disable' | 'hide-enable' | 'hide-disable'; pin?: string }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Přihlaste se znovu.');
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch('/api/profit-protection', {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Ochranu zisku se nepodařilo ověřit. Zkontrolujte připojení a zkuste to znovu.');
  }
  // Hosting může při selhání funkce vrátit HTML místo JSON. Nikdy to neznamená vypnutý PIN.
  const unavailable = 'Ochrana zisku je dočasně nedostupná. Zkuste to prosím znovu.';
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== 'object') throw new Error(unavailable);
  const result = data as { error?: unknown; enabled?: unknown; hideProfit?: unknown; ok?: unknown };
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : unavailable);
  if (auth.currentUser?.uid !== user.uid) throw new Error('Účet byl změněn.');
  if (body?.action === 'verify') {
    if (result.ok !== true) throw new Error(unavailable);
    return { ok: true };
  }
  if (typeof result.enabled !== 'boolean' && typeof result.hideProfit !== 'boolean') throw new Error(unavailable);
  return { enabled: result.enabled, hideProfit: result.hideProfit };
}
