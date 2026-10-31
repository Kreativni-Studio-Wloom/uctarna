// Typy jádra EET 2.0 (datová zpráva v4.1). Bez závislostí, lze importovat i z testů.

export type EetEnvironment = 'playground' | 'production';

/** Sekce <Data>. Při 1. pokusu se zmrazí a při opakování se už nemění. */
export interface EetTrzbaData {
  /** eic_popl, `CZ` + 8–10 číslic */
  eic: string;
  /** id_jednotky, 1–999999999 */
  unitId: number;
  /** id_pokl */
  registerId: string;
  /** porad_cis */
  porad_cis: string;
  /** dat_trzby, např. `2027-01-09T16:45:36+01:00` */
  dat_trzby: string;
  /** celk_trzba, výstup `formatAmount` */
  celk_trzba: string;
  /** Nepovinné položky; Účtárna je nepoužívá, xml.ts je ale umí (kvůli shodě s ukázkami FS). */
  eic_poverujiciho?: string;
  povereni_vice_popl?: boolean;
  urceno_cerp_zuct?: string;
  cerp_zuct?: string;
}

/** Sekce <Hlavicka>. Nová pro každý pokus. */
export interface EetHeader {
  /** uuid_zpravy, UUID v4 */
  uuid: string;
  /** dat_odesl */
  sentAt: string;
  /** prvni_zaslani */
  firstAttempt: boolean;
  /** overeni; `undefined` = atribut vynechat */
  verify?: boolean;
}

export interface EetWarning {
  code: number;
  text: string;
}

/** Načtený pokladní certifikát (.p12). */
export interface EetCredentials {
  privateKeyPem: string;
  /** DER certifikátu v Base64 (obsah wsse:BinarySecurityToken) */
  certDerB64: string;
  subjectCN: string;
  serial: string;
  notBefore: Date;
  notAfter: Date;
  /** OID certifikačních politik; playground certifikát má 1.2.203.19122063.10.2.102.0.1 */
  policyOids: string[];
}

interface EetResultBase {
  uuid: string;
  /** dat_odesl tohoto pokusu */
  sentAt: string;
  firstAttempt: boolean;
  /** doba odezvy v ms */
  ms: number;
  xGlobalTransactionId?: string;
  httpStatus?: number;
}

/** Tržba přijata, máme POK. */
export interface EetResultOk extends EetResultBase {
  kind: 'ok';
  pok: string;
  /** atribut test="true" (neprodukční prostředí) */
  test: boolean;
  receivedAt?: string;
  warnings: EetWarning[];
}

/** Server vrátil <Chyba>. Kód 0 = ověřovací mód proběhl v pořádku. */
export interface EetResultError extends EetResultBase {
  kind: 'error';
  code: number;
  text: string;
  test: boolean;
  rejectedAt?: string;
  warnings: EetWarning[];
}

/** Bez odpovědi v časovém limitu (server při podezření na útok neodpoví vůbec). */
export interface EetResultTimeout extends EetResultBase {
  kind: 'timeout';
}

/** Síťová chyba, HTTP 5xx, SOAP Fault nebo nepoužitelná odpověď. */
export interface EetResultNetwork extends EetResultBase {
  kind: 'network';
  message: string;
}

export type EetResult = EetResultOk | EetResultError | EetResultTimeout | EetResultNetwork;

/**
 * ok        – evidováno (POK), případně úspěšné ověření (kód 0 v ověřovacím módu)
 * retryable – poslat znovu (nové UUID, prvni_zaslani=false, stejná Data)
 * permanent – opakování nepomůže, je potřeba zásah (certifikát, data, nastavení)
 */
export type EetClassification = 'ok' | 'retryable' | 'permanent';
