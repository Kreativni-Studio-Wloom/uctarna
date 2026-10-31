import 'server-only';
import { NS } from './constants';
import { validateTrzbaData, validateDateTime, validateUuid } from './format';
import type { EetHeader, EetTrzbaData } from './types';

/*
 * Deterministická šablona v kanonickém tvaru Exclusive XML C14N
 * (http://www.w3.org/2001/10/xml-exc-c14n#). Řetězec, který vrátí `buildBody`, je přesně to,
 * co z obálky vyrobí exc-c14n s PrefixList="v4", takže se nad ním počítá digest a stejný
 * řetězec se vloží do obálky. Pravidla:
 *  - prázdné elementy jako dvojice tagů (`<a></a>`), žádné XML deklarace ani bílé znaky;
 *  - nejdřív deklarace jmenných prostorů seřazené podle prefixu, pak atributy:
 *    bez jmenného prostoru podle jména, s jmenným prostorem podle URI a jména;
 *  - hodnoty atributů: `&` `<` `"` a TAB/LF/CR jako entity (`>` se v atributech NEescapuje),
 *    text: `&` `<` `>` a CR.
 */

export function escapeAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

export function escapeText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

/** Atributy bez jmenného prostoru seřazené podle jména (pořadí kódových bodů). */
function sortedAttrs(attrs: Record<string, string | undefined>): string {
  return Object.keys(attrs)
    .filter((k) => attrs[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((k) => ` ${k}="${escapeAttr(attrs[k] as string)}"`)
    .join('');
}

const RE_XML_ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Kanonický `<soapenv:Body>` se zprávou `<v4:Trzba>`. Data neprojdou-li XSD, vyhodí chybu. */
export function buildBody(header: EetHeader, data: EetTrzbaData, bodyId: string): string {
  if (!RE_XML_ID.test(bodyId)) throw new Error(`EET: neplatné wsu:Id "${bodyId}"`);
  if (!validateUuid(header.uuid)) throw new Error(`EET: neplatné uuid_zpravy "${header.uuid}"`);
  if (!validateDateTime(header.sentAt)) throw new Error(`EET: neplatné dat_odesl "${header.sentAt}"`);
  const errs = validateTrzbaData(data);
  if (errs.length) throw new Error(`EET: neplatná data tržby: ${errs.join('; ')}`);

  const hlavicka = sortedAttrs({
    uuid_zpravy: header.uuid,
    dat_odesl: header.sentAt,
    prvni_zaslani: String(header.firstAttempt),
    overeni: header.verify === undefined ? undefined : String(header.verify),
  });
  const dataAttrs = sortedAttrs({
    eic_popl: data.eic,
    eic_poverujiciho: data.eic_poverujiciho,
    povereni_vice_popl: data.povereni_vice_popl === undefined ? undefined : String(data.povereni_vice_popl),
    id_jednotky: String(data.unitId),
    id_pokl: data.registerId,
    porad_cis: data.porad_cis,
    dat_trzby: data.dat_trzby,
    celk_trzba: data.celk_trzba,
    urceno_cerp_zuct: data.urceno_cerp_zuct,
    cerp_zuct: data.cerp_zuct,
  });

  return (
    `<soapenv:Body xmlns:soapenv="${NS.soapenv}" xmlns:v4="${NS.v4}" xmlns:wsu="${NS.wsu}" wsu:Id="${bodyId}">` +
    `<v4:Trzba>` +
    `<v4:Hlavicka${hlavicka}></v4:Hlavicka>` +
    `<v4:Data${dataAttrs}></v4:Data>` +
    `</v4:Trzba>` +
    `</soapenv:Body>`
  );
}

/** Celá SOAP obálka. `securityHeader` je `<wsse:Security>` ze `sign.ts`, `bodyC14n` z `buildBody`. */
export function buildEnvelope(securityHeader: string, bodyC14n: string): string {
  return (
    `<soapenv:Envelope xmlns:soapenv="${NS.soapenv}" xmlns:v4="${NS.v4}">` +
    `<soapenv:Header>${securityHeader}</soapenv:Header>` +
    bodyC14n +
    `</soapenv:Envelope>`
  );
}

export function byteLength(xml: string): number {
  return Buffer.byteLength(xml, 'utf8');
}
