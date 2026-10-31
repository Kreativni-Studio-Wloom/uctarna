import type { EetEnvironment } from './types';

export const EET_ENDPOINTS: Record<EetEnvironment, string> = {
  playground: 'https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4',
  production: 'https://trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4',
};

export const SOAP_ACTION = 'http://fs.gov.cz/eet/OdeslaniTrzby';
export const SOAP_CONTENT_TYPE = 'text/xml; charset=utf-8';

export const NS = {
  soapenv: 'http://schemas.xmlsoap.org/soap/envelope/',
  v4: 'http://fs.gov.cz/eet/schema/v4',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  ec: 'http://www.w3.org/2001/10/xml-exc-c14n#',
} as const;

export const ALG = {
  excC14n: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  rsaSha256: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  sha256: 'http://www.w3.org/2001/04/xmlenc#sha256',
  base64Binary:
    'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
  x509v3: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3',
} as const;

/** InclusiveNamespaces PrefixList podle ukázek FS. */
export const PREFIX_LIST_BODY = 'v4';
export const PREFIX_LIST_SIGNED_INFO = 'soapenv v4';

/** Max. velikost zprávy včetně obálky (jinak chyba 7). */
export const MAX_MESSAGE_BYTES = 12_288;

/** Mezní doba odezvy: zákon vyžaduje nejméně 2 s. */
export const MIN_TIMEOUT_MS = 2_000;
export const DEFAULT_TIMEOUT_MS = 4_000;

/** Lhůta pro dodatečné zaslání (§ 20 ZoET). Povinnost po ní trvá dál. */
export const RETRY_DEADLINE_MS = 48 * 60 * 60 * 1000;

/** Prodlevy před dalším pokusem (min): 1, 2, 5, 10, 20, 30, pak stále 30. */
export const RETRY_BACKOFF_MINUTES = [1, 2, 5, 10, 20, 30] as const;

/** Chyba 8 (technická chyba / chyba dat) se zkusí nejvýš 3× znovu, pak je trvalá. */
export const MAX_CODE_8_RETRIES = 3;

/** Texty chybových kódů pro obsluhu. */
export const EET_ERROR_TEXTS: Record<number, string> = {
  [-1]: 'Dočasná technická chyba EET, zpráva se odešle znovu',
  0: 'Ověřovací mód: zprávu se podařilo zpracovat',
  2: 'Neplatné kódování XML',
  3: 'Zpráva nevyhověla XML schématu',
  4: 'Neplatný podpis zprávy (zkontrolujte certifikát)',
  6: 'Chybná struktura DIČ poplatníka',
  7: 'Datová zpráva je příliš velká',
  8: 'Zpráva nebyla zpracována kvůli technické chybě nebo chybě dat',
};

/** Texty kódů varování (tržba je přijata). */
export const EET_WARNING_TEXTS: Record<number, string> = {
  1: 'DIČ v dokladu neodpovídá DIČ v certifikátu',
  2: 'Chybný formát DIČ pověřujícího poplatníka',
  4: 'Datum tržby je v budoucnosti',
  5: 'Datum tržby je výrazně v minulosti',
  6: 'Číslo evidenční jednotky má špatný formát',
  7: 'DIČ pověřujícího je stejné jako DIČ poplatníka',
};
