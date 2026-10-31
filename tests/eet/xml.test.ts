import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES, NS } from '@/lib/eet/constants';
import {
  RE_CASTKA,
  RE_DATETIME,
  RE_EIC,
  RE_ID_JEDNOTKY,
  RE_ID_POKL,
  RE_PORAD_CIS,
  RE_UUID,
} from '@/lib/eet/format';
import { loadP12, signBody } from '@/lib/eet/sign';
import { buildBody, buildEnvelope, byteLength, escapeAttr } from '@/lib/eet/xml';
import type { EetHeader, EetTrzbaData } from '@/lib/eet/types';
import { BODY_XPATH, c14n, fixtureText, parseXml, playgroundP12, playgroundPassword, select1 } from './helpers';

const header: EetHeader = {
  uuid: '6f1c0f43-1d2b-4c1e-9d55-6a0f8f4f1a11',
  sentAt: '2026-10-17T21:00:05+02:00',
  firstAttempt: true,
};
const data: EetTrzbaData = {
  eic: 'CZ00000019',
  unitId: 303,
  registerId: 'WEB1',
  porad_cis: '2026-000001',
  dat_trzby: '2026-10-17T21:00:00+02:00',
  celk_trzba: '81.60',
};
const ID = 'id-0123456789ABCDEF0123456789ABCDEF';

function attrsOf(xml: string, local: string): Record<string, string> {
  const el = select1(parseXml(xml), `//*[local-name(.)='${local}']`);
  const out: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.prefix !== 'xmlns' && a.name !== 'xmlns') out[a.name] = a.value;
  }
  return out;
}

describe('buildBody', () => {
  it('všechny hodnoty projdou regexy z XSD', () => {
    const body = buildBody(header, data, ID);
    const h = attrsOf(body, 'Hlavicka');
    const d = attrsOf(body, 'Data');
    expect(h.uuid_zpravy).toMatch(RE_UUID);
    expect(h.dat_odesl).toMatch(RE_DATETIME);
    expect(h.prvni_zaslani).toMatch(/^(true|false)$/);
    expect(d.eic_popl).toMatch(RE_EIC);
    expect(d.id_jednotky).toMatch(RE_ID_JEDNOTKY);
    expect(d.id_pokl).toMatch(RE_ID_POKL);
    expect(d.porad_cis).toMatch(RE_PORAD_CIS);
    expect(d.dat_trzby).toMatch(RE_DATETIME);
    expect(d.celk_trzba).toMatch(RE_CASTKA);
  });

  it('prázdné nepovinné atributy chybí úplně', () => {
    const body = buildBody(header, data, ID);
    expect(Object.keys(attrsOf(body, 'Hlavicka')).sort()).toEqual(['dat_odesl', 'prvni_zaslani', 'uuid_zpravy']);
    expect(Object.keys(attrsOf(body, 'Data')).sort()).toEqual([
      'celk_trzba', 'dat_trzby', 'eic_popl', 'id_jednotky', 'id_pokl', 'porad_cis',
    ]);
    expect(body).not.toMatch(/=""/);
    for (const opt of ['overeni', 'eic_poverujiciho', 'povereni_vice_popl', 'urceno_cerp_zuct', 'cerp_zuct'])
      expect(body).not.toContain(opt);
  });

  it('ověřovací mód a opakované zaslání', () => {
    const body = buildBody({ ...header, verify: true, firstAttempt: false }, data, ID);
    expect(attrsOf(body, 'Hlavicka')).toMatchObject({ overeni: 'true', prvni_zaslani: 'false' });
  });

  it('elementy a jmenné prostory odpovídají XSD (Trzba → Hlavicka, Data)', () => {
    const doc = parseXml(buildBody(header, data, ID));
    const trzba = select1(doc, "//*[local-name(.)='Trzba']");
    expect(trzba.namespaceURI).toBe(NS.v4);
    const kids = Array.from(trzba.childNodes as unknown as Element[]).map((n) => n.localName);
    expect(kids).toEqual(['Hlavicka', 'Data']);
    expect(select1(doc, BODY_XPATH).namespaceURI).toBe(NS.soapenv);
  });

  it('výstup je už kanonický (exc-c14n ho nezmění) i samostatně, i v obálce', () => {
    const body = buildBody(header, data, ID);
    expect(c14n(body, BODY_XPATH, ['v4'])).toBe(body);
    expect(c14n(buildEnvelope('', body), BODY_XPATH, ['v4'])).toBe(body);
  });

  it('atributy jsou seřazené podle jména', () => {
    const body = buildBody(header, { ...data, cerp_zuct: '1.00', urceno_cerp_zuct: '2.00', eic_poverujiciho: 'CZ683555118', povereni_vice_popl: true }, ID);
    const names = [...body.matchAll(/<v4:Data([^>]*)>/g)][0][1].match(/[a-z_]+(?==)/g)!;
    expect(names).toEqual([...names].sort());
  });

  it.each([
    [{ celk_trzba: '-0.00' }],
    [{ eic: 'CZ123' }],
    [{ registerId: 'Pokladna&1' }],
    [{ dat_trzby: '2026-10-17T21:00:00' }],
    [{ unitId: 0 }],
  ])('odmítne neplatná data %j', (patch) => {
    expect(() => buildBody(header, { ...data, ...patch } as EetTrzbaData, ID)).toThrow(/neplatná data/);
  });

  it('odmítne neplatné UUID, dat_odesl a Id', () => {
    expect(() => buildBody({ ...header, uuid: 'x' }, data, ID)).toThrow(/uuid/);
    expect(() => buildBody({ ...header, sentAt: 'dnes' }, data, ID)).toThrow(/dat_odesl/);
    expect(() => buildBody(header, data, '1bad id')).toThrow(/wsu:Id/);
  });

  it('escapování podle C14N (> se v atributech neescapuje)', () => {
    expect(escapeAttr(`a&b<c"d>e\tf\ng\rh`)).toBe('a&amp;b&lt;c&quot;d>e&#x9;f&#xA;g&#xD;h');
  });
});

describe('buildEnvelope', () => {
  it('podepsaná zpráva s nejdelšími hodnotami je pod 12 kB', () => {
    const creds = loadP12(playgroundP12('CZ8551015704'), playgroundPassword());
    const max: EetTrzbaData = {
      eic: 'CZ8551015704',
      unitId: 999_999_999,
      registerId: 'X'.repeat(20),
      porad_cis: 'Y'.repeat(25),
      dat_trzby: '2026-10-17T21:00:00+02:00',
      celk_trzba: '-99999999.99',
    };
    const body = buildBody({ ...header, verify: false }, max, ID);
    const { securityHeader } = signBody(body, ID, creds.privateKeyPem, creds.certDerB64);
    const xml = buildEnvelope(securityHeader, body);
    expect(byteLength(xml)).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(byteLength(xml)).toBeLessThan(6000);
  });

  it('obálka má stejnou kostru jako ukázka FS', () => {
    const sample = fixtureText('CZ00000019.eet.v4.req.xml');
    const skeleton = (xml: string) => {
      const env = parseXml(xml).documentElement;
      return [env.localName, env.namespaceURI, ...Array.from(env.childNodes as unknown as Element[]).map((n) => n.localName)];
    };
    expect(skeleton(buildEnvelope('<x/>', buildBody(header, data, ID)))).toEqual(skeleton(sample));
  });
});
