import 'server-only';
import { createHash, sign as rsaSign } from 'node:crypto';
import forge from 'node-forge';
import { ALG, NS, PREFIX_LIST_BODY, PREFIX_LIST_SIGNED_INFO } from './constants';
import { escapeText } from './xml';
import type { EetCredentials } from './types';

const OID_CERT_POLICIES = '2.5.29.32';

/** Načte pokladní certifikát `.p12` (PKCS#12, i legacy 3DES) a vybere certifikát k soukromému klíči. */
export function loadP12(p12: Buffer | Uint8Array, password: string): EetCredentials {
  let parsed: forge.pkcs12.Pkcs12Pfx;
  try {
    const der = forge.util.createBuffer(Buffer.from(p12).toString('binary'));
    parsed = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, password);
  } catch (e) {
    throw new Error(`EET: certifikát se nepodařilo otevřít (špatné heslo nebo poškozený soubor): ${(e as Error).message}`);
  }

  const keyBags = [
    ...(parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(parsed.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const key = keyBags.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new Error('EET: v souboru .p12 chybí soukromý klíč');

  const certBags = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const bag = certBags.find((b) => {
    const pub = b.cert?.publicKey as forge.pki.rsa.PublicKey | undefined;
    return pub?.n && pub.n.equals(key.n) && pub.e.equals(key.e);
  });
  if (!bag?.cert) throw new Error('EET: v souboru .p12 chybí certifikát k soukromému klíči');
  const cert = bag.cert;

  const certAsn1 = (bag as { asn1?: forge.asn1.Asn1 }).asn1 ?? forge.pki.certificateToAsn1(cert);
  const certDerB64 = forge.util.encode64(forge.asn1.toDer(certAsn1).getBytes());

  return {
    privateKeyPem: forge.pki.privateKeyToPem(key),
    certDerB64,
    subjectCN: String(cert.subject.getField('CN')?.value ?? ''),
    serial: cert.serialNumber,
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    policyOids: readPolicyOids(cert),
  };
}

function readPolicyOids(cert: forge.pki.Certificate): string[] {
  const ext = cert.extensions.find((e) => e.id === OID_CERT_POLICIES) as { value?: string } | undefined;
  if (!ext?.value) return [];
  try {
    const seq = forge.asn1.fromDer(ext.value);
    return (seq.value as forge.asn1.Asn1[])
      .map((info) => (info.value as forge.asn1.Asn1[])[0])
      .filter((oid) => oid?.type === forge.asn1.Type.OID)
      .map((oid) => forge.asn1.derToOid(oid.value as string));
  } catch {
    return [];
  }
}

export function sha256B64(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('base64');
}

/** Kanonický (exc-c14n, PrefixList "soapenv v4") `<ds:SignedInfo>` s odkazem na Body. */
export function buildSignedInfo(bodyId: string, digestB64: string): string {
  return (
    `<ds:SignedInfo xmlns:ds="${NS.ds}" xmlns:soapenv="${NS.soapenv}" xmlns:v4="${NS.v4}">` +
    `<ds:CanonicalizationMethod Algorithm="${ALG.excC14n}">` +
    `<ec:InclusiveNamespaces xmlns:ec="${NS.ec}" PrefixList="${PREFIX_LIST_SIGNED_INFO}"></ec:InclusiveNamespaces>` +
    `</ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${ALG.rsaSha256}"></ds:SignatureMethod>` +
    `<ds:Reference URI="#${bodyId}">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="${ALG.excC14n}">` +
    `<ec:InclusiveNamespaces xmlns:ec="${NS.ec}" PrefixList="${PREFIX_LIST_BODY}"></ec:InclusiveNamespaces>` +
    `</ds:Transform>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALG.sha256}"></ds:DigestMethod>` +
    `<ds:DigestValue>${escapeText(digestB64)}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`
  );
}

export interface SignedParts {
  /** `<wsse:Security>` do `<soapenv:Header>` */
  securityHeader: string;
  digestB64: string;
  signatureB64: string;
  signedInfoC14n: string;
}

/**
 * Podepíše kanonický Body: SHA-256 digest → SignedInfo → RSA-SHA256 → hlavička WS-Security
 * se strukturou jako v ukázkách FS (BinarySecurityToken + SecurityTokenReference, bez Timestamp).
 * `idSuffix` jen sjednocuje Id ostatních prvků s Id těla.
 */
export function signBody(
  bodyC14n: string,
  bodyId: string,
  privateKeyPem: string,
  certDerB64: string,
  idSuffix: string = bodyId.replace(/^id-/, ''),
): SignedParts {
  const digestB64 = sha256B64(bodyC14n);
  const signedInfoC14n = buildSignedInfo(bodyId, digestB64);
  const signatureB64 = rsaSign('sha256', Buffer.from(signedInfoC14n, 'utf8'), privateKeyPem).toString('base64');

  const tokenId = `X509-${idSuffix}`;
  const securityHeader =
    `<wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}">` +
    `<wsse:BinarySecurityToken EncodingType="${ALG.base64Binary}" ValueType="${ALG.x509v3}" wsu:Id="${tokenId}">${certDerB64}</wsse:BinarySecurityToken>` +
    `<ds:Signature Id="SIG-${idSuffix}" xmlns:ds="${NS.ds}">` +
    signedInfoC14n +
    `<ds:SignatureValue>${signatureB64}</ds:SignatureValue>` +
    `<ds:KeyInfo Id="KI-${idSuffix}">` +
    `<wsse:SecurityTokenReference wsu:Id="STR-${idSuffix}">` +
    `<wsse:Reference URI="#${tokenId}" ValueType="${ALG.x509v3}"/>` +
    `</wsse:SecurityTokenReference>` +
    `</ds:KeyInfo>` +
    `</ds:Signature>` +
    `</wsse:Security>`;

  return { securityHeader, digestB64, signatureB64, signedInfoC14n };
}
