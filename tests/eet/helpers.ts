import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { ExclusiveCanonicalization, findAncestorNs } from 'xml-crypto';
import xpath from 'xpath';

export const FIXTURES = path.resolve(__dirname, '../fixtures/eet');
export const PLAYGROUND_EICS = ['CZ00000019', 'CZ683555118', 'CZ8551015704'] as const;

export const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name));
export const fixtureText = (name: string) => fixture(name).toString('utf8');
export const playgroundPassword = () => fixtureText('password_pokladni_cert_playground.txt').trim();
export const playgroundP12 = (eic: string) => fixture(`CA_EET-Playground-${eic}.p12`);

export function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
}

export function select1(doc: Node, expr: string): Element {
  const n = xpath.select1(expr, doc as never);
  if (!n) throw new Error(`nenalezeno: ${expr}`);
  return n as unknown as Element;
}

/** Nezávislá exc-c14n (xml-crypto) prvku nalezeného XPathem, včetně PrefixList z předků. */
export function c14n(xml: string, expr: string, prefixList: string[]): string {
  const doc = parseXml(xml);
  const node = select1(doc, expr);
  return new ExclusiveCanonicalization().process(node as never, {
    inclusiveNamespacesPrefixList: prefixList,
    ancestorNamespaces: findAncestorNs(doc as never, expr),
  });
}

export const BODY_XPATH = "//*[local-name(.)='Body']";
export const SIGNED_INFO_XPATH = "//*[local-name(.)='SignedInfo']";

export function toPemCert(derB64: string): string {
  return `-----BEGIN CERTIFICATE-----\n${derB64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
}
