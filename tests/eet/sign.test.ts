import { createHash, createPublicKey, verify as rsaVerify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import xpath from 'xpath';
import { ALG, NS } from '@/lib/eet/constants';
import { formatDateTimePrague } from '@/lib/eet/format';
import { buildSignedInfo, loadP12, sha256B64, signBody } from '@/lib/eet/sign';
import { buildBody, buildEnvelope } from '@/lib/eet/xml';
import type { EetHeader, EetTrzbaData } from '@/lib/eet/types';
import {
  BODY_XPATH,
  FIXTURES,
  PLAYGROUND_EICS,
  SIGNED_INFO_XPATH,
  c14n,
  fixtureText,
  parseXml,
  playgroundP12,
  playgroundPassword,
  select1,
  toPemCert,
} from './helpers';

const SAMPLE = fixtureText('CZ00000019.eet.v4.req.xml');
const SAMPLE_BODY_ID = 'id-73E2DBECC9F62C5AB8177998819768224';
const SAMPLE_DIGEST = '+m1BdhR4W4TJ2UkS29raUpFO4l1NGyfK/usoHmH9Pqw=';
const sampleSigValue = () => /<ds:SignatureValue>([^<]+)</.exec(SAMPLE)![1];
const sampleCert = () => /<wsse:BinarySecurityToken[^>]*>([^<]+)</.exec(SAMPLE)![1];

// Hodnoty z ukázky FS CZ00000019.eet.v4.req.xml.
const sampleHeader: EetHeader = {
  uuid: '03965780-6457-4842-bd80-5f9195c0b8c8',
  sentAt: '2026-07-01T09:02:18Z',
  firstAttempt: true,
  verify: false,
};
const sampleData: EetTrzbaData = {
  eic: 'CZ00000019',
  unitId: 303,
  registerId: '/5604/MA65',
  porad_cis: '00/2224/SO57',
  dat_trzby: '2026-07-01T09:02:18Z',
  celk_trzba: '188580.00',
  urceno_cerp_zuct: '25.00',
  cerp_zuct: '302.00',
};

const ourData: EetTrzbaData = {
  eic: 'CZ00000019',
  unitId: 1,
  registerId: 'WEB1',
  porad_cis: '2026-000001',
  dat_trzby: '2026-10-17T21:00:00+02:00',
  celk_trzba: '81.60',
};

function signedEnvelope(eic = 'CZ00000019', data: EetTrzbaData = ourData) {
  const creds = loadP12(playgroundP12(eic), playgroundPassword());
  const header: EetHeader = {
    uuid: '6f1c0f43-1d2b-4c1e-9d55-6a0f8f4f1a11',
    sentAt: formatDateTimePrague(new Date('2026-10-17T19:00:05Z')),
    firstAttempt: true,
  };
  const bodyId = 'id-0123456789ABCDEF0123456789ABCDEF';
  const body = buildBody(header, { ...data, eic }, bodyId);
  const signed = signBody(body, bodyId, creds.privateKeyPem, creds.certDerB64);
  return { creds, body, bodyId, signed, xml: buildEnvelope(signed.securityHeader, body) };
}

describe('loadP12', () => {
  it.each(PLAYGROUND_EICS)('načte playground certifikát %s', (eic) => {
    const c = loadP12(playgroundP12(eic), playgroundPassword());
    expect(c.subjectCN).toBe(eic);
    expect(c.privateKeyPem).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
    expect(c.notAfter.getTime()).toBeGreaterThan(c.notBefore.getTime());
    expect(c.policyOids).toContain('1.2.203.19122063.10.2.102.0.1');
    // klíč patří k certifikátu
    const pub = createPublicKey(toPemCert(c.certDerB64)).export({ format: 'der', type: 'spki' });
    const fromPriv = createPublicKey(c.privateKeyPem).export({ format: 'der', type: 'spki' });
    expect(Buffer.compare(pub, fromPriv)).toBe(0);
  });

  it('DER certifikátu je bajt po bajtu stejný jako z OpenSSL', () => {
    const c = loadP12(playgroundP12('CZ00000019'), playgroundPassword());
    let pem: string;
    try {
      pem = execFileSync('sh', [
        '-c',
        `openssl pkcs12 -in "${FIXTURES}/CA_EET-Playground-CZ00000019.p12" -passin pass:${playgroundPassword()} -nokeys -clcerts -legacy 2>/dev/null || openssl pkcs12 -in "${FIXTURES}/CA_EET-Playground-CZ00000019.p12" -passin pass:${playgroundPassword()} -nokeys -clcerts`,
      ]).toString();
    } catch {
      return; // bez OpenSSL test přeskočíme
    }
    const b64 = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem)![1].replace(/\s+/g, '');
    expect(c.certDerB64).toBe(b64);
    // a odpovídá i certifikátu v ukázce FS
    expect(c.certDerB64).toBe(sampleCert());
  });

  it('špatné heslo vyhodí srozumitelnou chybu', () => {
    expect(() => loadP12(playgroundP12('CZ00000019'), 'spatne')).toThrow(/certifikát se nepodařilo otevřít/);
  });
});

describe('kanonizace proti ukázce FS (CZ00000019.eet.v4.req.xml)', () => {
  it('xml-crypto exc-c14n Body z ukázky dá DigestValue z ukázky', () => {
    const canon = c14n(SAMPLE, BODY_XPATH, ['v4']);
    expect(sha256B64(canon)).toBe(SAMPLE_DIGEST);
  });

  it('naše šablona Body je bajt po bajtu shodná s exc-c14n ukázky', () => {
    const ours = buildBody(sampleHeader, sampleData, SAMPLE_BODY_ID);
    expect(ours).toBe(c14n(SAMPLE, BODY_XPATH, ['v4']));
    expect(sha256B64(ours)).toBe(SAMPLE_DIGEST);
  });

  it('naše šablona SignedInfo je bajt po bajtu shodná s exc-c14n ukázky a podpis z ukázky na ní sedí', () => {
    const ours = buildSignedInfo(SAMPLE_BODY_ID, SAMPLE_DIGEST);
    expect(ours).toBe(c14n(SAMPLE, SIGNED_INFO_XPATH, ['soapenv', 'v4']));
    const ok = rsaVerify('sha256', Buffer.from(ours), toPemCert(sampleCert()), Buffer.from(sampleSigValue(), 'base64'));
    expect(ok).toBe(true);
  });

  it('podpis stejného SignedInfo playground klíčem CZ00000019 je identický s ukázkou (RSA PKCS#1 v1.5 je deterministický)', () => {
    const c = loadP12(playgroundP12('CZ00000019'), playgroundPassword());
    const body = buildBody(sampleHeader, sampleData, SAMPLE_BODY_ID);
    const signed = signBody(body, SAMPLE_BODY_ID, c.privateKeyPem, c.certDerB64);
    expect(signed.digestB64).toBe(SAMPLE_DIGEST);
    expect(signed.signatureB64).toBe(sampleSigValue());
  });
});

describe('signBody: naše zpráva', () => {
  it.each(PLAYGROUND_EICS)('podpis %s nezávisle ověří xml-crypto', (eic) => {
    const { xml, creds } = signedEnvelope(eic);
    const doc = parseXml(xml);
    const sig = new SignedXml({ publicCert: toPemCert(creds.certDerB64) });
    sig.loadSignature(select1(doc, "//*[local-name(.)='Signature']") as never);
    expect(sig.checkSignature(xml)).toBe(true);
  });

  it('kanonický Body a SignedInfo z obálky se rovnají řetězcům, které jsme podepsali', () => {
    const { xml, body, signed } = signedEnvelope();
    expect(c14n(xml, BODY_XPATH, ['v4'])).toBe(body);
    expect(c14n(xml, SIGNED_INFO_XPATH, ['soapenv', 'v4'])).toBe(signed.signedInfoC14n);
    expect(createHash('sha256').update(body).digest('base64')).toBe(signed.digestB64);
  });

  it('změna dat po podpisu se při ověření pozná', () => {
    const { xml, creds } = signedEnvelope();
    const tampered = xml.replace('celk_trzba="81.60"', 'celk_trzba="81.61"');
    expect(tampered).not.toBe(xml);
    const sig = new SignedXml({ publicCert: toPemCert(creds.certDerB64) });
    sig.loadSignature(select1(parseXml(tampered), "//*[local-name(.)='Signature']") as never);
    let ok: boolean;
    try {
      ok = sig.checkSignature(tampered);
    } catch {
      ok = false;
    }
    expect(ok).toBe(false);
  });

  it('struktura hlavičky odpovídá ukázce FS (algoritmy, PrefixList, token, bez Timestamp)', () => {
    const { xml, bodyId } = signedEnvelope();
    const shape = (s: string) => {
      const d = parseXml(s);
      const attr = (expr: string) => (select1(d, expr) as unknown as Attr).value;
      return {
        c14nAlg: attr("//*[local-name(.)='SignedInfo']/*[local-name(.)='CanonicalizationMethod']/@Algorithm"),
        c14nPrefixes: attr("//*[local-name(.)='CanonicalizationMethod']/*[local-name(.)='InclusiveNamespaces']/@PrefixList"),
        sigAlg: attr("//*[local-name(.)='SignatureMethod']/@Algorithm"),
        transformAlg: attr("//*[local-name(.)='Transform']/@Algorithm"),
        transformPrefixes: attr("//*[local-name(.)='Transform']/*[local-name(.)='InclusiveNamespaces']/@PrefixList"),
        digestAlg: attr("//*[local-name(.)='DigestMethod']/@Algorithm"),
        tokenEncoding: attr("//*[local-name(.)='BinarySecurityToken']/@EncodingType"),
        tokenValueType: attr("//*[local-name(.)='BinarySecurityToken']/@ValueType"),
        strValueType: attr("//*[local-name(.)='SecurityTokenReference']/*[local-name(.)='Reference']/@ValueType"),
        refCount: (xpathCount(d, "//*[local-name(.)='Reference' and namespace-uri(.)='" + NS.ds + "']")),
        timestamp: xpathCount(d, "//*[local-name(.)='Timestamp']"),
        addressing: xpathCount(d, "//*[namespace-uri(.)='http://www.w3.org/2005/08/addressing']"),
      };
    };
    expect(shape(xml)).toEqual(shape(SAMPLE));
    expect(shape(xml)).toMatchObject({
      c14nAlg: ALG.excC14n,
      c14nPrefixes: 'soapenv v4',
      transformPrefixes: 'v4',
      sigAlg: ALG.rsaSha256,
      digestAlg: ALG.sha256,
      refCount: 1,
      timestamp: 0,
    });
    // Reference míří na Body, STR na BinarySecurityToken
    const d = parseXml(xml);
    expect((select1(d, "//*[local-name(.)='SignedInfo']//*[local-name(.)='Reference']/@URI") as unknown as Attr).value).toBe(`#${bodyId}`);
    const tokenId = (select1(d, "//*[local-name(.)='BinarySecurityToken']/@*[local-name(.)='Id']") as unknown as Attr).value;
    expect((select1(d, "//*[local-name(.)='SecurityTokenReference']/*[local-name(.)='Reference']/@URI") as unknown as Attr).value).toBe(`#${tokenId}`);
  });
});

function xpathCount(doc: Document, expr: string): number {
  return (xpath.select(expr, doc as never) as unknown[]).length;
}
