/*
 * In-memory náhrada Firestore Admin SDK pro testy EET (emulator potřebuje Javu, která tu není).
 * Umí jen to, co používá src/lib/eet: doc/collection/collectionGroup, where (==, in, <, <=, >, >=),
 * limit, get/set (merge)/update (tečkové cesty)/delete, runTransaction s optimistickou kontrolou
 * verzí (souběh se opakuje jako ve Firestore), FieldValue increment/serverTimestamp/delete/arrayUnion.
 * Hlídá pravidla, která by produkce vynutila: `undefined` v datech, update neexistujícího dokumentu,
 * čtení v transakci po zápisu.
 */
import { Timestamp } from 'firebase-admin/firestore';

type Data = Record<string, unknown>;

const isPlain = (v: unknown): v is Data => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as T;
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) as T;
  return v;
}

function assertNoUndefined(v: unknown, path = ''): void {
  if (v === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}")`);
  if (Array.isArray(v)) v.forEach((x, i) => assertNoUndefined(x, `${path}[${i}]`));
  else if (isPlain(v)) for (const [k, x] of Object.entries(v)) assertNoUndefined(x, path ? `${path}.${k}` : k);
}

const methodName = (v: unknown): string | undefined =>
  v && typeof v === 'object' ? ((v as { methodName?: string }).methodName ?? undefined) : undefined;

function resolveTransform(current: unknown, v: unknown, now: () => Date): { del?: true; value?: unknown } {
  switch (methodName(v)) {
    case 'FieldValue.serverTimestamp':
      return { value: Timestamp.fromDate(now()) };
    case 'FieldValue.increment':
      return { value: (typeof current === 'number' ? current : 0) + (v as { operand: number }).operand };
    case 'FieldValue.delete':
      return { del: true };
    case 'FieldValue.arrayUnion': {
      const arr = Array.isArray(current) ? [...current] : [];
      for (const e of (v as { elements: unknown[] }).elements) if (!arr.includes(e)) arr.push(e);
      return { value: arr };
    }
    default:
      return { value: v };
  }
}

/** Zapíše `value` do `target` (merge = rekurzivně pro mapy). */
function writeFields(target: Data, src: Data, merge: boolean, now: () => Date) {
  for (const [k, v] of Object.entries(src)) {
    if (merge && isPlain(v) && isPlain(target[k])) {
      writeFields(target[k] as Data, v, true, now);
      continue;
    }
    const r = resolveTransform(target[k], v, now);
    if (r.del) delete target[k];
    else target[k] = isPlain(r.value) ? resolveDeep(r.value as Data, now) : clone(r.value);
  }
}

function resolveDeep(d: Data, now: () => Date): Data {
  const out: Data = {};
  writeFields(out, d, false, now);
  return out;
}

function setPath(target: Data, dotted: string, v: unknown, now: () => Date) {
  const parts = dotted.split('.');
  let cur = target;
  for (const p of parts.slice(0, -1)) {
    if (!isPlain(cur[p])) cur[p] = {};
    cur = cur[p] as Data;
  }
  writeFields(cur, { [parts[parts.length - 1]]: v }, false, now);
}

export function getPath(d: Data | undefined, dotted: string): unknown {
  let cur: unknown = d;
  for (const p of dotted.split('.')) {
    if (!isPlain(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

const cmpVal = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : v instanceof Date ? v.getTime() : v);

class Snap {
  constructor(
    public ref: DocRef,
    private _data: Data | undefined
  ) {}
  get exists() {
    return this._data !== undefined;
  }
  get id() {
    return this.ref.id;
  }
  data() {
    return this._data === undefined ? undefined : clone(this._data);
  }
}

export class DocRef {
  constructor(
    public db: MockFirestore,
    public path: string
  ) {
    if (path.split('/').length % 2 !== 0) throw new Error(`neplatná cesta dokumentu: ${path}`);
  }
  get id() {
    return this.path.split('/').pop()!;
  }
  async get() {
    await Promise.resolve();
    return this.db._snap(this);
  }
  async set(data: Data, opts?: { merge?: boolean }) {
    await Promise.resolve();
    this.db._applyWrites([{ kind: 'set', ref: this, data, merge: !!opts?.merge }]);
  }
  async update(data: Data) {
    await Promise.resolve();
    this.db._applyWrites([{ kind: 'update', ref: this, data }]);
  }
  async delete() {
    await Promise.resolve();
    this.db._applyWrites([{ kind: 'delete', ref: this }]);
  }
}

type Filter = { field: string; op: string; value: unknown };

class Query {
  constructor(
    protected db: MockFirestore,
    protected match: (path: string) => boolean,
    protected filters: Filter[] = [],
    protected max?: number
  ) {}
  where(field: string, op: string, value: unknown) {
    return new Query(this.db, this.match, [...this.filters, { field, op, value }], this.max);
  }
  limit(n: number) {
    return new Query(this.db, this.match, this.filters, n);
  }
  async get() {
    await Promise.resolve();
    this.db.queries.push(this.filters);
    let docs = [...this.db.docs.entries()]
      .filter(([p]) => this.match(p))
      .filter(([, d]) =>
        this.filters.every((f) => {
          const v = cmpVal(getPath(d, f.field));
          const w = cmpVal(f.value);
          switch (f.op) {
            case '==':
              return v === w;
            case 'in':
              return (f.value as unknown[]).includes(v);
            case '<':
              return v !== undefined && v !== null && (v as number) < (w as number);
            case '<=':
              return v !== undefined && v !== null && (v as number) <= (w as number);
            case '>':
              return v !== undefined && v !== null && (v as number) > (w as number);
            case '>=':
              return v !== undefined && v !== null && (v as number) >= (w as number);
            default:
              throw new Error(`mock: nepodporovaný operátor ${f.op}`);
          }
        })
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, d]) => new Snap(new DocRef(this.db, p), d));
    if (this.max !== undefined) docs = docs.slice(0, this.max);
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

class CollRef extends Query {
  constructor(
    db: MockFirestore,
    public path: string
  ) {
    super(db, (p) => p.startsWith(`${path}/`) && p.split('/').length === path.split('/').length + 1);
  }
  doc(id?: string) {
    return new DocRef(this.db, `${this.path}/${id ?? Math.random().toString(36).slice(2, 12)}`);
  }
}

type Write =
  | { kind: 'set'; ref: DocRef; data: Data; merge: boolean }
  | { kind: 'update'; ref: DocRef; data: Data }
  | { kind: 'delete'; ref: DocRef };

class Tx {
  reads = new Map<string, number>();
  writes: Write[] = [];
  constructor(private db: MockFirestore) {}
  async get(ref: DocRef) {
    if (this.writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
    await Promise.resolve();
    this.reads.set(ref.path, this.db._version(ref.path));
    await this.db.hooks.afterTxRead?.(ref.path);
    return this.db._snap(ref);
  }
  set(ref: DocRef, data: Data, opts?: { merge?: boolean }) {
    this.writes.push({ kind: 'set', ref, data, merge: !!opts?.merge });
    return this;
  }
  update(ref: DocRef, data: Data) {
    this.writes.push({ kind: 'update', ref, data });
    return this;
  }
  create(ref: DocRef, data: Data) {
    if (this.db.docs.has(ref.path)) throw new Error('ALREADY_EXISTS');
    return this.set(ref, data);
  }
  delete(ref: DocRef) {
    this.writes.push({ kind: 'delete', ref });
    return this;
  }
}

export class MockFirestore {
  docs = new Map<string, Data>();
  versions = new Map<string, number>();
  /** Statistika: kolik transakcí se kvůli souběhu opakovalo. */
  txRetries = 0;
  queries: Filter[][] = [];
  hooks: { afterTxRead?: (path: string) => Promise<void> | void } = {};
  constructor(public now: () => Date = () => new Date()) {}

  doc(path: string) {
    return new DocRef(this, path);
  }
  collection(path: string) {
    return new CollRef(this, path);
  }
  collectionGroup(id: string) {
    return new Query(this, (p) => {
      const parts = p.split('/');
      return parts.length >= 2 && parts[parts.length - 2] === id;
    });
  }

  async runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const tx = new Tx(this);
      const result = await fn(tx);
      // Commit je synchronní, takže kontrola verzí + zápis jsou atomické.
      const stale = [...tx.reads].some(([p, v]) => this._version(p) !== v);
      if (stale) {
        this.txRetries++;
        continue;
      }
      this._applyWrites(tx.writes);
      return result;
    }
    throw new Error('ABORTED: příliš mnoho souběžných transakcí');
  }

  // ——— interní ———
  _version(path: string) {
    return this.versions.get(path) ?? 0;
  }
  _snap(ref: DocRef) {
    return new Snap(ref, this.docs.get(ref.path));
  }
  _applyWrites(writes: Write[]) {
    // validace předem, aby se dávka zapsala buď celá, nebo vůbec
    for (const w of writes) {
      if (w.kind !== 'delete') assertNoUndefined(w.data);
      if (w.kind === 'update' && !this.docs.has(w.ref.path)) throw new Error(`NOT_FOUND: No document to update: ${w.ref.path}`);
    }
    for (const w of writes) {
      const p = w.ref.path;
      if (w.kind === 'delete') this.docs.delete(p);
      else if (w.kind === 'set') {
        const target = w.merge && this.docs.has(p) ? clone(this.docs.get(p)!) : {};
        writeFields(target, w.data, w.merge, this.now);
        this.docs.set(p, target);
      } else {
        const target = clone(this.docs.get(p)!);
        for (const [k, v] of Object.entries(w.data)) setPath(target, k, v, this.now);
        this.docs.set(p, target);
      }
      this.versions.set(p, this._version(p) + 1);
    }
  }

  /** Pomůcka pro testy: přímý zápis bez transformací. */
  seed(path: string, data: Data) {
    this.docs.set(path, clone(data));
    this.versions.set(path, this._version(path) + 1);
  }
  read(path: string): Data | undefined {
    const d = this.docs.get(path);
    return d && clone(d);
  }
}

/** Typ pro funkce, které čekají Admin Firestore. */
export const asDb = (m: MockFirestore) => m as unknown as import('firebase-admin/firestore').Firestore;
