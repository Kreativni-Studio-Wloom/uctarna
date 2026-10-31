import { describe, expect, it } from 'vitest';
import { parseResponse } from '@/lib/eet/parse';

const UUID = '123e4567-e89b-42d3-a456-426655440000';
const POK_PG = '987a6be5-6af5-44f3-b4fc-987654321000-ff';
const POK_PROD = '987a6be5-6af5-44f3-b4fc-987654321000-02';

const envelope = (body: string, header = '') =>
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">` +
  `<soapenv:Header>${header}</soapenv:Header><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;

const odpoved = (inner: string, prefix = 'eet') =>
  envelope(`<${prefix}:Odpoved xmlns:${prefix}="http://fs.gov.cz/eet/schema/v4">${inner.replace(/tns:/g, `${prefix}:`)}</${prefix}:Odpoved>`);

describe('parseResponse', () => {
  it('potvrzení z produkce', () => {
    const xml = odpoved(
      `<tns:Hlavicka uuid_zpravy="${UUID}" dat_prij="2027-03-04T18:25:21+01:00"/><tns:Potvrzeni pok="${POK_PROD}"/>`,
    );
    expect(parseResponse(xml, { expectedUuid: UUID, env: 'production' })).toEqual({
      type: 'potvrzeni',
      pok: POK_PROD,
      test: false,
      uuid: UUID,
      receivedAt: '2027-03-04T18:25:21+01:00',
      warnings: [],
    });
  });

  it('potvrzení z playgroundu s varováními (víceřádkové texty, jiný prefix)', () => {
    const xml = odpoved(
      `<tns:Hlavicka uuid_zpravy="${UUID}" dat_prij="2027-03-04T18:25:21+01:00" />
       <tns:Potvrzeni pok="${POK_PG}" test="true" />
       <tns:Varovani kod_varov="1" >
         EIC poplatnika v datove zprave se neshoduje s EIC
         v certifikatu
       </tns:Varovani>
       <tns:Varovani kod_varov="2">Chybny format EIC poverujiciho poplatnika</tns:Varovani>`,
      'ns2',
    );
    const r = parseResponse(xml, { expectedUuid: UUID, env: 'playground' });
    expect(r).toMatchObject({ type: 'potvrzeni', pok: POK_PG, test: true });
    expect(r.type === 'potvrzeni' && r.warnings).toEqual([
      { code: 1, text: 'EIC poplatnika v datove zprave se neshoduje s EIC v certifikatu' },
      { code: 2, text: 'Chybny format EIC poverujiciho poplatnika' },
    ]);
  });

  it('jedno varování je také pole', () => {
    const xml = odpoved(
      `<tns:Hlavicka uuid_zpravy="${UUID}"/><tns:Potvrzeni pok="${POK_PG}" test="1"/><tns:Varovani kod_varov="6">id_jednotky</tns:Varovani>`,
    );
    const r = parseResponse(xml);
    expect(r.type === 'potvrzeni' && r.warnings).toEqual([{ code: 6, text: 'id_jednotky' }]);
    expect(r.type === 'potvrzeni' && r.test).toBe(true);
  });

  it.each([
    [-1, 'Docasna technicka chyba zpracovani – odeslete prosim datovou zpravu pozdeji'],
    [3, 'XML zprava nevyhovela kontrole XML schematu'],
    [7, 'Datova zprava je prilis velka'],
  ])('chyba %i', (code, text) => {
    const xml = odpoved(`<tns:Hlavicka dat_odmit="2027-03-04T18:25:21+01:00"/><tns:Chyba kod="${code}" test="true">\n ${text}\n</tns:Chyba>`);
    expect(parseResponse(xml, { expectedUuid: UUID })).toEqual({
      type: 'chyba',
      code,
      text,
      test: true,
      uuid: undefined,
      rejectedAt: '2027-03-04T18:25:21+01:00',
      warnings: [],
    });
  });

  it('chyba 0 v ověřovacím módu i s varováním', () => {
    const xml = odpoved(
      `<tns:Hlavicka uuid_zpravy="${UUID}" dat_odmit="2027-03-04T18:25:21+01:00"/>` +
        `<tns:Chyba kod="0">Datovou zpravu evidovane trzby v overovacim modu se podarilo zpracovat</tns:Chyba>` +
        `<tns:Varovani kod_varov="4">Datum a cas uskutecneni trzby je novejsi nez datum a cas prijeti zpravy</tns:Varovani>`,
    );
    const r = parseResponse(xml, { expectedUuid: UUID });
    expect(r).toMatchObject({ type: 'chyba', code: 0, test: false, uuid: UUID });
    expect(r.type === 'chyba' && r.warnings[0].code).toBe(4);
  });

  it('SOAP Fault', () => {
    const xml = envelope(
      `<soapenv:Fault><faultcode>soapenv:Server</faultcode><faultstring>Internal error</faultstring></soapenv:Fault>`,
    );
    expect(parseResponse(xml)).toEqual({ type: 'fault', faultcode: 'soapenv:Server', faultstring: 'Internal error' });
  });

  it.each([
    ['', /prázdná/],
    ['   \n', /prázdná/],
    ['<html><body>502 Bad Gateway</body></html>', /SOAP Body/],
    [envelope('<x/>'), /Odpoved/],
    [odpoved('<tns:Hlavicka/>'), /Potvrzeni ani Chyba/],
    [odpoved(`<tns:Hlavicka uuid_zpravy="${UUID}"/><tns:Potvrzeni pok="nesmysl"/>`), /neplatný POK/],
    [odpoved(`<tns:Hlavicka/><tns:Chyba>bez kódu</tns:Chyba>`), /bez kódu/],
  ])('nepoužitelná odpověď %#', (xml, reason) => {
    const r = parseResponse(xml);
    expect(r.type).toBe('invalid');
    expect(r.type === 'invalid' && r.reason).toMatch(reason);
  });

  it('odpověď k jiné zprávě se zahodí', () => {
    const xml = odpoved(`<tns:Hlavicka uuid_zpravy="${UUID}"/><tns:Potvrzeni pok="${POK_PG}" test="true"/>`);
    const r = parseResponse(xml, { expectedUuid: '6f1c0f43-1d2b-4c1e-9d55-6a0f8f4f1a11' });
    expect(r).toMatchObject({ type: 'invalid', reason: expect.stringMatching(/jiné zprávě/) });
  });

  it('UUID se porovnává bez ohledu na velikost písmen', () => {
    const xml = odpoved(`<tns:Hlavicka uuid_zpravy="${UUID.toUpperCase()}"/><tns:Potvrzeni pok="${POK_PG}" test="true"/>`);
    expect(parseResponse(xml, { expectedUuid: UUID }).type).toBe('potvrzeni');
  });

  it('produkce nesmí vrátit testovací POK (-ff) ani test="true"', () => {
    const ff = odpoved(`<tns:Hlavicka uuid_zpravy="${UUID}"/><tns:Potvrzeni pok="${POK_PG}"/>`);
    expect(parseResponse(ff, { env: 'production' })).toMatchObject({ type: 'invalid' });
    const test = odpoved(`<tns:Hlavicka uuid_zpravy="${UUID}"/><tns:Potvrzeni pok="${POK_PROD}" test="true"/>`);
    expect(parseResponse(test, { env: 'production' })).toMatchObject({ type: 'invalid' });
  });

  it('playground musí vrátit POK s -ff', () => {
    const xml = odpoved(`<tns:Hlavicka uuid_zpravy="${UUID}"/><tns:Potvrzeni pok="${POK_PROD}" test="true"/>`);
    expect(parseResponse(xml, { env: 'playground' })).toMatchObject({ type: 'invalid' });
  });

  it('ignoruje podpis v hlavičce odpovědi', () => {
    const xml = envelope(
      `<eet:Odpoved xmlns:eet="http://fs.gov.cz/eet/schema/v4"><eet:Hlavicka uuid_zpravy="${UUID}"/><eet:Potvrzeni pok="${POK_PG}" test="true"/></eet:Odpoved>`,
      `<wsse:Security xmlns:wsse="x"><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo/></ds:Signature></wsse:Security>`,
    );
    expect(parseResponse(xml, { expectedUuid: UUID, env: 'playground' }).type).toBe('potvrzeni');
  });
});
