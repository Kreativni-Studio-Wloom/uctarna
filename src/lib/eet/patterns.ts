// Regexy podle EETXMLSchema.xsd v4.1. Bez 'server-only': používá je server (format.ts) i klient (nastavení EET).

// XSD pattern je implicitně ukotvený.
export const RE_EIC = /^CZ[0-9]{8,10}$/;
export const RE_ID_POKL = /^[0-9a-zA-Z.,:;/#\-_ ]{1,20}$/;
export const RE_PORAD_CIS = /^[0-9a-zA-Z.,:;/#\-_ ]{1,25}$/;
export const RE_ID_JEDNOTKY = /^[1-9][0-9]{0,8}$/;
export const RE_DATETIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$/;
export const RE_CASTKA = /^((0|-?[1-9]\d{0,7})\.\d\d|-0\.(0[1-9]|[1-9]\d))$/;
export const RE_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
export const RE_POK = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}-[0-9a-fA-F]{2}$/;

