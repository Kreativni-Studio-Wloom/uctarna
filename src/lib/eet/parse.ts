import 'server-only';
import { XMLParser } from 'fast-xml-parser';
import { validatePok } from './format';
import type { EetEnvironment, EetWarning } from './types';

export type ParsedResponse =
  | {
      type: 'potvrzeni';
      pok: string;
      test: boolean;
      uuid?: string;
      receivedAt?: string;
      warnings: EetWarning[];
    }
  | {
      type: 'chyba';
      code: number;
      text: string;
      test: boolean;
      uuid?: string;
      rejectedAt?: string;
      warnings: EetWarning[];
    }
  | { type: 'fault'; faultcode: string; faultstring: string }
  | { type: 'invalid'; reason: string };

export interface ParseOptions {
  /** uuid_zpravy odeslané zprávy; odpověď s jiným UUID se zahodí */
  expectedUuid?: string;
  env?: EetEnvironment;
}

// Bez jmenných prostorů (prefix serveru se může lišit), atributy i hodnoty jako řetězce.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  textNodeName: '#text',
  isArray: (name) => name === 'Varovani',
  processEntities: true,
});

type Node = Record<string, unknown>;

const asNode = (v: unknown): Node | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : undefined;

const attr = (n: Node | undefined, name: string): string | undefined => {
  const v = n?.[`@_${name}`];
  return typeof v === 'string' ? v : undefined;
};

const text = (v: unknown): string => {
  const raw = typeof v === 'string' ? v : typeof asNode(v)?.['#text'] === 'string' ? (asNode(v)!['#text'] as string) : '';
  return raw.replace(/\s+/g, ' ').trim();
};

const bool = (v: string | undefined) => v === 'true' || v === '1';

function warnings(odpoved: Node): EetWarning[] {
  const list = Array.isArray(odpoved.Varovani) ? odpoved.Varovani : [];
  return list.map((w) => ({ code: Number(attr(asNode(w), 'kod_varov')), text: text(w) }));
}

/** Rozebere odpověď `OdeslaniTrzby` (namespace-agnostic). Nikdy nevyhazuje. */
export function parseResponse(xml: string, opts: ParseOptions = {}): ParsedResponse {
  if (!xml || !xml.trim()) return { type: 'invalid', reason: 'prázdná odpověď' };

  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch (e) {
    return { type: 'invalid', reason: `odpověď není platné XML: ${(e as Error).message}` };
  }

  const body = asNode(asNode(doc.Envelope)?.Body);
  if (!body) return { type: 'invalid', reason: 'odpověď nemá SOAP Body' };

  const fault = asNode(body.Fault);
  if (fault) {
    return { type: 'fault', faultcode: text(fault.faultcode), faultstring: text(fault.faultstring) };
  }

  const odpoved = asNode(body.Odpoved);
  if (!odpoved) return { type: 'invalid', reason: 'odpověď neobsahuje element Odpoved' };
  const hlavicka = asNode(odpoved.Hlavicka);
  const uuid = attr(hlavicka, 'uuid_zpravy');

  if (opts.expectedUuid && uuid && uuid.toLowerCase() !== opts.expectedUuid.toLowerCase()) {
    return { type: 'invalid', reason: `odpověď patří k jiné zprávě (uuid ${uuid})` };
  }

  const potvrzeni = asNode(odpoved.Potvrzeni);
  if (potvrzeni) {
    const pok = attr(potvrzeni, 'pok');
    if (!pok || !validatePok(pok)) return { type: 'invalid', reason: `neplatný POK "${pok ?? ''}"` };
    if (opts.expectedUuid && !uuid) return { type: 'invalid', reason: 'potvrzení bez uuid_zpravy' };
    const test = bool(attr(potvrzeni, 'test'));
    const fictive = pok.toLowerCase().endsWith('-ff');
    if (opts.env === 'production' && (fictive || test)) {
      return { type: 'invalid', reason: `produkce vrátila testovací POK ${pok}` };
    }
    if (opts.env === 'playground' && !fictive) {
      return { type: 'invalid', reason: `playground vrátil POK bez přípony -ff (${pok})` };
    }
    return {
      type: 'potvrzeni',
      pok,
      test,
      uuid,
      receivedAt: attr(hlavicka, 'dat_prij'),
      warnings: warnings(odpoved),
    };
  }

  const chyba = odpoved.Chyba;
  if (chyba !== undefined) {
    const kod = attr(asNode(chyba), 'kod');
    const code = Number(kod);
    if (kod === undefined || !Number.isInteger(code)) return { type: 'invalid', reason: 'chyba bez kódu' };
    return {
      type: 'chyba',
      code,
      text: text(chyba),
      test: bool(attr(asNode(chyba), 'test')),
      uuid,
      rejectedAt: attr(hlavicka, 'dat_odmit'),
      warnings: warnings(odpoved),
    };
  }

  return { type: 'invalid', reason: 'odpověď neobsahuje Potvrzeni ani Chyba' };
}
