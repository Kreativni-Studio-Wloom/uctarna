import { describe, expect, it } from 'vitest';
import { buildStaffTicketEscPos, staffTicketLines } from '@/lib/receiptPrinter';
import type { Sale } from '@/types';

/** Převede ESC/POS bajty na čitelné řádky (řídicí sekvence zahodí). */
const toText = (bytes: Uint8Array) => {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1b) {
      const cmd = bytes[i + 1];
      i += cmd === 0x40 ? 1 : 2;
    } else if (b === 0x1d) {
      const cmd = bytes[i + 1];
      i += cmd === 0x56 ? 3 : 2;
      if (cmd === 0x56) out += '<CUT>\n';
    } else if (b === 0x0a) out += '\n';
    else out += String.fromCharCode(b);
  }
  return out;
};

const sale = (overrides: Partial<Sale> = {}): Sale => ({
  id: 'abc',
  documentId: '1234567890',
  items: [
    { itemId: 'a', productId: 'p1', productName: 'Matcha latte', price: 120, quantity: 2 },
    { itemId: 'a1', productId: 'x1', productName: 'Ovesné mléko', price: 15, quantity: 2, parentItemId: 'a' },
    { itemId: 'a2', productId: 'x2', productName: 'Vanilkový sirup', price: 10, quantity: 1, parentItemId: 'a' },
    { itemId: 'b', productId: 'p2', productName: 'Croissant', price: 60, quantity: 1 },
  ],
  totalAmount: 350,
  paymentMethod: 'card',
  currency: 'CZK',
  createdAt: new Date(2026, 10, 10, 14, 32),
  storeId: 's',
  userId: 'u',
  customerName: 'Petra',
  ...overrides,
});

describe('lístek pro obsluhu', () => {
  it('drží extra pod hlavní položkou s jejich počty', () => {
    expect(staffTicketLines(sale().items)).toEqual([
      {
        name: 'Matcha latte',
        quantity: 2,
        extras: [
          { name: 'Ovesné mléko', quantity: 2 },
          { name: 'Vanilkový sirup', quantity: 1 },
        ],
      },
      { name: 'Croissant', quantity: 1, extras: [] },
    ]);
  });

  it('vytiskne čas, číslo, jméno a položky bez cen', () => {
    const text = toText(buildStaffTicketEscPos(sale(), 58, 1));
    expect(text).toContain('14:32');
    expect(text).toContain('#1234567890');
    expect(text).toContain('Petra');
    expect(text).toContain('2x Matcha latte');
    expect(text).toContain('   + 2x Ovesne mleko');
    expect(text).toContain('   + 1x Vanilkovy sirup');
    expect(text).toContain('1x Croissant');
    expect(text).not.toMatch(/Kc/);
    expect(text.match(/<CUT>/g)).toHaveLength(1);
  });

  it('počet kopií = počet odstřižených lístků', () => {
    expect(toText(buildStaffTicketEscPos(sale(), 58, 3)).match(/<CUT>/g)).toHaveLength(3);
  });

  it('bez jména jméno nevynechá nic dalšího a vratky přeskočí', () => {
    const text = toText(
      buildStaffTicketEscPos(
        sale({
          customerName: undefined,
          items: [
            { itemId: 'r', productId: 'p9', productName: 'Vraceny', price: 50, quantity: -1 },
            { itemId: 'c', productId: 'p3', productName: 'Espresso', price: 50, quantity: 1 },
          ],
        })
      )
    );
    expect(text).not.toContain('Vraceny');
    expect(text).toContain('1x Espresso');
  });

  it('jen vratka = žádný lístek', () => {
    expect(
      buildStaffTicketEscPos(
        sale({ items: [{ itemId: 'r', productId: 'p9', productName: 'X', price: 50, quantity: -1 }] })
      ).length
    ).toBe(0);
  });

  it('extra bez hlavní položky se neztratí', () => {
    const lines = staffTicketLines([
      { itemId: 'z', productId: 'x', productName: 'Sirup', price: 10, quantity: 1, parentItemId: 'missing' },
    ]);
    expect(lines).toEqual([{ name: '+ Sirup', quantity: 1, extras: [] }]);
  });
});
