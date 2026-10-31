import 'server-only';
import type { EetCredentials, EetEnvironment } from './types';

/*
 * Kontrola nahraného pokladního certifikátu (POST /api/eet/certificate). Čistá funkce.
 * Prostředí podle OID certifikační politiky:
 *  - playground: 1.2.203.19122063.10.2.102.0.1 (ověřeno na testovacích .p12 z balíku FS)
 *  - produkce: podle plánu 1.2.203.19122063.10.1.102.*; NEOVĚŘENO, potvrdit na 1. produkčním certifikátu
 * Neznámé OID se odmítne, aby se do produkce neposílalo s certifikátem neznámého původu.
 */

export const POLICY_OID_PREFIXES: Record<EetEnvironment, string[]> = {
  playground: ['1.2.203.19122063.10.2.102.'],
  production: ['1.2.203.19122063.10.1.102.'],
};

export function environmentFromPolicyOids(oids: string[]): EetEnvironment | undefined {
  for (const env of ['playground', 'production'] as const) {
    if (oids.some((oid) => POLICY_OID_PREFIXES[env].some((p) => oid.startsWith(p)))) return env;
  }
  return undefined;
}

export interface CertificateCheckInput {
  creds: Pick<EetCredentials, 'subjectCN' | 'notBefore' | 'notAfter' | 'policyOids'>;
  /** EIČ prodejny (nastavení nebo formulář) */
  eic: string;
  /** Prostředí, pro které se certifikát nahrává */
  environment: EetEnvironment;
  now: Date;
}

/** Vrátí seznam problémů (prázdný = certifikát je v pořádku) a zjištěné prostředí. */
export function checkCertificate({ creds, eic, environment, now }: CertificateCheckInput): { problems: string[]; env?: EetEnvironment } {
  const problems: string[] = [];
  const cn = creds.subjectCN.trim().toUpperCase();
  const want = eic.trim().toUpperCase();
  if (!want) problems.push('Nejdřív vyplňte DIČ (EIČ) prodejny');
  else if (cn !== want) problems.push(`Certifikát je vydaný pro ${cn || '(bez CN)'}, prodejna má DIČ ${want}`);
  if (now.getTime() < creds.notBefore.getTime()) problems.push(`Certifikát platí až od ${creds.notBefore.toISOString()}`);
  if (now.getTime() > creds.notAfter.getTime()) problems.push(`Platnost certifikátu skončila ${creds.notAfter.toISOString()}`);
  const env = environmentFromPolicyOids(creds.policyOids);
  if (!env) problems.push(`Neznámá certifikační politika (${creds.policyOids.join(', ') || 'žádná'}), nejde určit prostředí`);
  else if (env !== environment) {
    problems.push(`Certifikát je pro prostředí ${env === 'playground' ? 'Playground' : 'Produkce'}, prodejna má nastaveno ${environment === 'playground' ? 'Playground' : 'Produkce'}`);
  }
  return { problems, env };
}
