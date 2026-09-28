import { auth } from '@/lib/firebase';

export async function profitProtectionRequest(body?: { action: 'verify' | 'enable' | 'disable'; pin?: string }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Přihlaste se znovu.');
  const token = await user.getIdToken();
  const response = await fetch('/api/profit-protection', {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ověření se nepodařilo.');
  if (auth.currentUser?.uid !== user.uid) throw new Error('Účet byl změněn.');
  return data as { enabled?: boolean; ok?: boolean };
}
