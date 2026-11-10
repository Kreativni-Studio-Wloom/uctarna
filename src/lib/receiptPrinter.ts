'use client';

import { Sale } from '@/types';

// ----------------------------------------------------------------------------
// Tisk účtenek na Bluetooth (BLE) termotiskárnu přes Web Bluetooth + ESC/POS.
// Funguje v Chrome na Androidu a v prohlížeči Bluefy na iOS (Safari Web
// Bluetooth neumí). Nastavení je per zařízení (localStorage), protože tiskárna
// je spárovaná s konkrétním telefonem.
// ----------------------------------------------------------------------------

type ReceiptStoreData = {
  companyName?: string;
  ico?: string;
  companyAddress?: string;
};

export type PaperWidth = 58 | 80;

export type PrinterStatus = {
  supported: boolean;
  connected: boolean;
  deviceName: string | null;
};

const AUTO_PRINT_KEY = 'uctarna_auto_print';
const PAPER_WIDTH_KEY = 'uctarna_printer_paper_width';
const DEVICE_ID_KEY = 'uctarna_printer_device_id';
const DEVICE_NAME_KEY = 'uctarna_printer_device_name';
const STAFF_TICKET_KEY = 'uctarna_staff_ticket';
const STAFF_TICKET_COPIES_KEY = 'uctarna_staff_ticket_copies';

export const STAFF_TICKET_MAX_COPIES = 5;

export const PRINT_ERROR_EVENT = 'uctarna:print-error';
export const PRINTER_STATUS_EVENT = 'uctarna:printer-status';

// Služby, které používají běžné levné čínské BLE tiskárny (Xprinter, GOOJPRT,
// MTP, PeriPage, "BlueTooth Printer" …) + Star/Epson BLE varianty.
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '0000ffb0-0000-1000-8000-00805f9b34fb',
  '0000ff12-0000-1000-8000-00805f9b34fb',
];

const CHUNK_SIZE = 100;
const CHUNK_DELAY_MS = 20;

// Minimální typy Web Bluetooth (v projektu nejsou @types/web-bluetooth).
type BleCharacteristic = {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue: (data: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
};
type BleService = { uuid: string; getCharacteristics: () => Promise<BleCharacteristic[]> };
type BleServer = { connected: boolean; getPrimaryServices: () => Promise<BleService[]> };
type BleDevice = EventTarget & {
  id: string;
  name?: string;
  gatt?: { connected: boolean; connect: () => Promise<BleServer>; disconnect: () => void };
};
type BleApi = {
  requestDevice: (options: unknown) => Promise<BleDevice>;
  getDevices?: () => Promise<BleDevice[]>;
};

const getBluetooth = (): BleApi | null => {
  if (typeof navigator === 'undefined') return null;
  return ((navigator as unknown as { bluetooth?: BleApi }).bluetooth) ?? null;
};

let device: BleDevice | null = null;
let characteristic: BleCharacteristic | null = null;
let printQueue: Promise<void> = Promise.resolve();

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* localStorage nemusí být dostupné */
  }
};

const emitStatus = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PRINTER_STATUS_EVENT, { detail: getPrinterStatus() }));
};

export const isBluetoothSupported = () => getBluetooth() !== null;

export const isAutoPrintEnabled = () => safeGet(AUTO_PRINT_KEY) === '1';
export const setAutoPrintEnabled = (enabled: boolean) => safeSet(AUTO_PRINT_KEY, enabled ? '1' : '0');

export const getPaperWidth = (): PaperWidth => (safeGet(PAPER_WIDTH_KEY) === '80' ? 80 : 58);
export const setPaperWidth = (width: PaperWidth) => safeSet(PAPER_WIDTH_KEY, String(width));

/** Lístek pro obsluhu (co připravit) – tiskne se automaticky spolu s dokladem. */
export const isStaffTicketEnabled = () => safeGet(STAFF_TICKET_KEY) === '1';
export const setStaffTicketEnabled = (enabled: boolean) => safeSet(STAFF_TICKET_KEY, enabled ? '1' : '0');

const clampCopies = (value: number) =>
  Math.min(STAFF_TICKET_MAX_COPIES, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));

export const getStaffTicketCopies = () => clampCopies(Number(safeGet(STAFF_TICKET_COPIES_KEY) ?? '1'));
export const setStaffTicketCopies = (copies: number) => safeSet(STAFF_TICKET_COPIES_KEY, String(clampCopies(copies)));

/** Automatický tisk po zaplacení dělá cokoli – doklad, lístek pro obsluhu, nebo obojí. */
const isAnyAutoPrintEnabled = () => isAutoPrintEnabled() || isStaffTicketEnabled();

export const getPrinterStatus = (): PrinterStatus => ({
  supported: isBluetoothSupported(),
  connected: Boolean(characteristic && device?.gatt?.connected),
  deviceName: device?.name || safeGet(DEVICE_NAME_KEY),
});

export const hasSavedPrinter = () => Boolean(safeGet(DEVICE_ID_KEY));

const findWritableCharacteristic = async (server: BleServer): Promise<BleCharacteristic> => {
  const services = await server.getPrimaryServices();
  for (const service of services) {
    let chars: BleCharacteristic[] = [];
    try {
      chars = await service.getCharacteristics();
    } catch {
      continue;
    }
    const writable = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write);
    if (writable) return writable;
  }
  throw new Error('Tiskárna nemá zapisovatelnou BLE charakteristiku (není to ESC/POS tiskárna?)');
};

const attachDevice = async (next: BleDevice) => {
  if (!next.gatt) throw new Error('Zařízení nepodporuje GATT');
  if (device !== next) {
    device?.removeEventListener('gattserverdisconnected', onDisconnected);
    next.addEventListener('gattserverdisconnected', onDisconnected);
  }
  device = next;
  const server = await next.gatt.connect();
  characteristic = await findWritableCharacteristic(server);
  safeSet(DEVICE_ID_KEY, next.id);
  safeSet(DEVICE_NAME_KEY, next.name || 'Tiskárna');
  emitStatus();
};

function onDisconnected() {
  characteristic = null;
  emitStatus();
}

/** Otevře výběr Bluetooth zařízení. Musí být voláno z kliknutí uživatele. */
export const pairPrinter = async () => {
  const bluetooth = getBluetooth();
  if (!bluetooth) {
    throw new Error('Tento prohlížeč neumí Bluetooth. Na iPhonu použijte Bluefy, na Androidu Chrome.');
  }
  const picked = await bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES,
  });
  await attachDevice(picked);
};

export const forgetPrinter = () => {
  try {
    device?.gatt?.disconnect();
  } catch {
    /* ignore */
  }
  device = null;
  characteristic = null;
  safeSet(DEVICE_ID_KEY, null);
  safeSet(DEVICE_NAME_KEY, null);
  emitStatus();
};

/**
 * Zajistí spojení s tiskárnou. Nejdřív zkusí znovu připojit známé zařízení
 * (bez dialogu); dialog výběru otevře jen s allowPicker (vyžaduje gesto).
 */
const ensureConnected = async (allowPicker: boolean) => {
  if (characteristic && device?.gatt?.connected) return;

  if (device) {
    try {
      await attachDevice(device);
      return;
    } catch {
      /* zkusíme další cesty */
    }
  }

  const bluetooth = getBluetooth();
  const savedId = safeGet(DEVICE_ID_KEY);
  if (bluetooth?.getDevices && savedId) {
    try {
      const known = (await bluetooth.getDevices()).find((d) => d.id === savedId);
      if (known) {
        await attachDevice(known);
        return;
      }
    } catch {
      /* getDevices nemusí být povolené */
    }
  }

  if (allowPicker) {
    await pairPrinter();
    return;
  }
  throw new Error('Tiskárna není připojená');
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const writeBytes = async (data: Uint8Array) => {
  const target = characteristic;
  if (!target) throw new Error('Tiskárna není připojená');
  const withoutResponse = target.properties.writeWithoutResponse && target.writeValueWithoutResponse;
  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const chunk = data.slice(offset, offset + CHUNK_SIZE);
    if (withoutResponse) {
      await target.writeValueWithoutResponse!(chunk);
      // Levné tiskárny mají malý buffer – bez pauzy zahazují data.
      await sleep(CHUNK_DELAY_MS);
    } else {
      await target.writeValue(chunk);
    }
  }
};

// ----------------------------------------------------------------------------
// Sestavení účtenky v ESC/POS (obsah odpovídá PDF dokladu z pdfGenerator.ts)
// ----------------------------------------------------------------------------

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

type FirestoreLikeTimestamp = { toDate: () => Date };

const toDate = (value: unknown): Date => {
  if (value instanceof Date) return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as FirestoreLikeTimestamp).toDate === 'function'
  ) {
    return (value as FirestoreLikeTimestamp).toDate();
  }
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return new Date();
};

/** Levné tiskárny neumí spolehlivě CP852 – tiskneme bez diakritiky, čisté ASCII. */
const toAscii = (text?: string | null): string => {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[  ]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?');
};

const formatCZK = (amount: number) => `${amount.toLocaleString('cs-CZ')} Kc`;

const formatAmount = (amount: number, currency: Sale['currency']) =>
  currency === 'EUR' ? `${amount.toFixed(2)} EUR` : formatCZK(amount);

const paymentMethodLabel = (method: Sale['paymentMethod']) => {
  if (method === 'cash') return 'Hotovost';
  if (method === 'card') return 'Karta';
  if (method === 'qr') return 'QR platba';
  return 'Nezname';
};

const wrap = (text: string, width: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    let rest = word;
    while (rest.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (!current) current = rest;
    else if (current.length + 1 + rest.length <= width) current += ` ${rest}`;
    else {
      lines.push(current);
      current = rest;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
};

class EscPosBuilder {
  private bytes: number[] = [];

  constructor() {
    this.raw(ESC, 0x40); // init
  }

  raw(...values: number[]) {
    this.bytes.push(...values);
    return this;
  }

  text(value: string) {
    for (const ch of toAscii(value)) this.bytes.push(ch.charCodeAt(0));
    return this;
  }

  line(value = '') {
    return this.text(value).raw(LF);
  }

  align(mode: 'left' | 'center' | 'right') {
    return this.raw(ESC, 0x61, mode === 'left' ? 0 : mode === 'center' ? 1 : 2);
  }

  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  size(double: boolean) {
    return this.raw(GS, 0x21, double ? 0x11 : 0x00);
  }

  feed(lines: number) {
    return this.raw(ESC, 0x64, lines);
  }

  cut() {
    return this.raw(GS, 0x56, 0x42, 0x00);
  }

  build() {
    return new Uint8Array(this.bytes);
  }
}

export const buildReceiptEscPos = (sale: Sale, store: ReceiptStoreData, paperWidth: PaperWidth = 58) => {
  const width = paperWidth === 80 ? 48 : 32;
  const qtyWidth = 4;
  const priceWidth = 12;
  const nameWidth = width - qtyWidth - priceWidth;
  const divider = '-'.repeat(width);

  const labelValue = (label: string, value: string) => {
    const l = toAscii(label);
    const v = toAscii(value);
    const gap = Math.max(1, width - l.length - v.length);
    return `${l}${' '.repeat(gap)}${v}`;
  };

  const b = new EscPosBuilder();
  const companyName = store.companyName?.trim();
  const companyAddress = store.companyAddress?.trim();
  const ico = store.ico?.trim();

  b.align('center');
  if (companyName) b.bold(true).line(companyName).bold(false);
  if (companyAddress) wrap(toAscii(companyAddress), width).forEach((l) => b.line(l));
  if (ico) b.line(`IC: ${ico}`);
  b.bold(true).line('Neplatce DPH').bold(false);

  b.align('left').line(divider);
  b.line(labelValue('Cislo dokladu', sale.documentId || sale.id || ''));
  b.line(
    labelValue(
      'Datum',
      new Intl.DateTimeFormat('cs-CZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(toDate(sale.createdAt))
    )
  );
  b.line(divider);

  b.bold(true)
    .line(`${'Polozka'.padEnd(nameWidth)}${'Ks'.padStart(qtyWidth)}${'Cena'.padStart(priceWidth)}`)
    .bold(false);
  b.line(divider);

  sale.items.forEach((item) => {
    const nameLines = wrap(toAscii(item.productName || 'Polozka'), nameWidth - 1);
    const price = toAscii(formatCZK(item.price * item.quantity));
    nameLines.forEach((nameLine, index) => {
      if (index === 0) {
        b.line(`${nameLine.padEnd(nameWidth)}${String(item.quantity).padStart(qtyWidth)}${price.padStart(priceWidth)}`);
      } else {
        b.line(nameLine);
      }
    });
  });
  b.line(divider);

  const discountAmount = sale.discountAmount ?? 0;
  if (discountAmount > 0) {
    const subtotal = sale.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discountLabel = sale.discount?.type === 'percentage' ? `Sleva ${sale.discount.value}%` : 'Sleva';
    b.line(labelValue('Mezisoucet', formatCZK(subtotal)));
    b.line(labelValue(discountLabel, `-${formatCZK(discountAmount)}`));
  }

  b.line(labelValue('Zpusob uhrady', paymentMethodLabel(sale.paymentMethod)));
  if (sale.currency === 'EUR' && sale.eurRate) {
    const amountInCZK = sale.originalAmountCZK ?? sale.totalAmount * sale.eurRate;
    b.line(labelValue('Kurz', `${sale.eurRate.toFixed(2)} Kc/EUR`));
    b.line(labelValue('Castka v Kc', formatCZK(amountInCZK)));
    b.line(labelValue('Castka v EUR', `${sale.totalAmount.toFixed(2)} EUR`));
  }

  const tip = sale.tipAmount ?? 0;
  const totalWithoutTip = Math.max(0, sale.totalAmount - tip);
  // Dvojitá velikost = poloviční počet znaků na řádek.
  const half = Math.floor(width / 2);
  const totalLabel = 'CELKEM';
  const totalValue = toAscii(formatAmount(totalWithoutTip, sale.currency));
  const totalGap = Math.max(1, half - totalLabel.length - totalValue.length);
  b.raw(LF).bold(true).size(true);
  if (totalLabel.length + totalValue.length + 1 <= half) {
    b.line(`${totalLabel}${' '.repeat(totalGap)}${totalValue}`);
  } else {
    b.line(totalLabel).align('right').line(totalValue).align('left');
  }
  b.size(false).bold(false);

  b.raw(LF).align('center').bold(true).line('Dekujeme za vas nakup').bold(false);
  b.feed(4).cut();

  return b.build();
};

type StaffTicketLine = { name: string; quantity: number; extras: { name: string; quantity: number }[] };

/**
 * Položky pro přípravu: hlavní položky v pořadí z košíku a pod každou její extra.
 * Vratky (záporné množství) se nepřipravují, takže se vynechají. Extra bez
 * nalezené hlavní položky se vytiskne samostatně, aby se neztratila.
 */
export const staffTicketLines = (items: Sale['items']): StaffTicketLine[] => {
  const positive = items.filter((item) => item.quantity > 0);
  const parentIds = new Set(positive.filter((i) => !i.parentItemId && i.itemId).map((i) => i.itemId));
  const extrasOf = (parentId?: string) =>
    parentId
      ? positive
          .filter((c) => c.parentItemId === parentId)
          .map((c) => ({ name: c.productName || 'Extra', quantity: c.quantity }))
      : [];
  return positive
    .filter((item) => !item.parentItemId || !parentIds.has(item.parentItemId))
    .map((item) => ({
      name: item.parentItemId ? `+ ${item.productName || 'Extra'}` : item.productName || 'Polozka',
      quantity: item.quantity,
      extras: item.parentItemId ? [] : extrasOf(item.itemId),
    }));
};

/**
 * Lístek pro obsluhu: jen co připravit – čas, jméno, položky s extra a počty.
 * Bez hlavičky firmy, cen a patičky, s minimálním posuvem, ať šetří papír.
 */
export const buildStaffTicketEscPos = (sale: Sale, paperWidth: PaperWidth = 58, copies = 1) => {
  const lines = staffTicketLines(sale.items);
  if (lines.length === 0) return new Uint8Array();

  const width = paperWidth === 80 ? 48 : 32;
  const half = Math.floor(width / 2);
  const time = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' }).format(toDate(sale.createdAt));
  const orderNo = toAscii(sale.documentId || sale.id || '');
  const name = toAscii(sale.customerName?.trim());

  const b = new EscPosBuilder();
  for (let copy = 0; copy < clampCopies(copies); copy++) {
    // Čas tučně a dvojitě vysoký (šířka řádku zůstává), vpravo číslo objednávky jako na Výdeji.
    const head = toAscii(time);
    const ref = orderNo ? `#${orderNo}` : '';
    b.align('left').bold(true).raw(GS, 0x21, 0x01);
    b.line(ref && head.length + ref.length + 1 <= width ? `${head}${' '.repeat(width - head.length - ref.length)}${ref}` : head);
    b.raw(GS, 0x21, 0x00);
    if (name) {
      // Jméno dvojitou velikostí, ať se dá snadno vyvolat.
      b.size(true);
      wrap(name, half).forEach((l) => b.line(l));
      b.size(false);
    }
    b.bold(false).line('-'.repeat(width));

    lines.forEach((item) => {
      const qty = `${item.quantity}x `;
      b.bold(true);
      wrap(item.name, width - qty.length).forEach((l, i) => b.line(i === 0 ? `${qty}${l}` : `${' '.repeat(qty.length)}${l}`));
      b.bold(false);
      item.extras.forEach((extra) => {
        const prefix = `   + ${extra.quantity}x `;
        wrap(toAscii(extra.name), width - prefix.length).forEach((l, i) =>
          b.line(i === 0 ? `${prefix}${l}` : `${' '.repeat(prefix.length)}${l}`)
        );
      });
    });
    b.feed(3).cut();
  }
  return b.build();
};

const concatBytes = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  parts.forEach((p) => {
    out.set(p, offset);
    offset += p.length;
  });
  return out;
};

const enqueue = (job: () => Promise<void>) => {
  const run = printQueue.then(job, job);
  printQueue = run.catch(() => undefined);
  return run;
};

type PrintOptions = {
  allowPicker?: boolean;
  /** Tisknout zákaznický doklad (výchozí ano). */
  receipt?: boolean;
  /** Přidat lístky pro obsluhu podle nastavení zařízení (výchozí ne). */
  staffTickets?: boolean;
};

/** Vytiskne doklad (a případně lístky pro obsluhu) jednou úlohou. allowPicker = true jen při volání z kliknutí. */
export const printReceipt = (sale: Sale, store: ReceiptStoreData, options: PrintOptions = {}) =>
  enqueue(async () => {
    const paperWidth = getPaperWidth();
    const parts: Uint8Array[] = [];
    if (options.receipt !== false) parts.push(buildReceiptEscPos(sale, store, paperWidth));
    if (options.staffTickets && isStaffTicketEnabled() && !sale.isRefund) {
      parts.push(buildStaffTicketEscPos(sale, paperWidth, getStaffTicketCopies()));
    }
    const data = concatBytes(...parts);
    if (data.length === 0) return;
    await ensureConnected(Boolean(options.allowPicker));
    await writeBytes(data);
  });

/** Volby pro automatický tisk po zaplacení podle nastavení tohoto zařízení. */
export const autoPrintOptions = (): PrintOptions => ({ receipt: isAutoPrintEnabled(), staffTickets: true });

/**
 * Automatický tisk po zaplacení – neblokuje pokladnu. Podle nastavení vytiskne
 * doklad, lístky pro obsluhu, nebo obojí. Chybu ohlásí událostí, na kterou POS
 * zobrazí lištu s možností tisk zopakovat.
 */
export const autoPrintReceipt = (sale: Sale, store: ReceiptStoreData | null | undefined) => {
  if (typeof window === 'undefined' || !isAnyAutoPrintEnabled()) return;
  const storeData = store ?? {};
  printReceipt(sale, storeData, autoPrintOptions()).catch((error: unknown) => {
    console.error('❌ Automatický tisk dokladu selhal:', error);
    window.dispatchEvent(
      new CustomEvent(PRINT_ERROR_EVENT, {
        detail: {
          sale,
          store: storeData,
          message: error instanceof Error ? error.message : 'Tisk se nezdařil',
        },
      })
    );
  });
};

export const printTestReceipt = (store: ReceiptStoreData) =>
  printReceipt(
    {
      id: 'test',
      documentId: 'TEST',
      items: [
        { itemId: 't1', productId: 'test-1', productName: 'Zkusebni polozka', price: 100, quantity: 1 },
        { itemId: 't1x', productId: 'test-x', productName: 'Extra navic', price: 20, quantity: 1, parentItemId: 't1' },
        { itemId: 't2', productId: 'test-2', productName: 'Dlouhy nazev polozky pro test zalamovani', price: 35, quantity: 2 },
      ],
      totalAmount: 190,
      paymentMethod: 'cash',
      currency: 'CZK',
      customerName: 'Zkouska',
      createdAt: new Date(),
      storeId: '',
      userId: '',
    },
    store,
    { allowPicker: true, staffTickets: true }
  );
