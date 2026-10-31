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

const enqueue = (job: () => Promise<void>) => {
  const run = printQueue.then(job, job);
  printQueue = run.catch(() => undefined);
  return run;
};

/** Vytiskne doklad. allowPicker = true jen při volání z kliknutí (např. „Vytisknout znovu“). */
export const printReceipt = (sale: Sale, store: ReceiptStoreData, options: { allowPicker?: boolean } = {}) =>
  enqueue(async () => {
    await ensureConnected(Boolean(options.allowPicker));
    await writeBytes(buildReceiptEscPos(sale, store, getPaperWidth()));
  });

/**
 * Automatický tisk po zaplacení – neblokuje pokladnu. Chybu ohlásí událostí,
 * na kterou POS zobrazí lištu s možností tisk zopakovat.
 */
export const autoPrintReceipt = (sale: Sale, store: ReceiptStoreData | null | undefined) => {
  if (typeof window === 'undefined' || !isAutoPrintEnabled()) return;
  const storeData = store ?? {};
  printReceipt(sale, storeData).catch((error: unknown) => {
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
        { productId: 'test-1', productName: 'Zkusebni polozka', price: 100, quantity: 1 },
        { productId: 'test-2', productName: 'Dlouhy nazev polozky pro test zalamovani', price: 45, quantity: 2 },
      ],
      totalAmount: 190,
      paymentMethod: 'cash',
      currency: 'CZK',
      createdAt: new Date(),
      storeId: '',
      userId: '',
    },
    store,
    { allowPicker: true }
  );
