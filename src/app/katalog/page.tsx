'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { LoginRequiredModal } from '@/components/auth/LoginRequiredModal';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { Product, Store, CartItem } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  BookOpen,
  Package,
  Sparkles,
  Search,
  Pencil,
  Check,
  X,
  Trophy,
  Calendar,
  CalendarDays,
  CalendarRange,
} from 'lucide-react';

type TabType = 'products' | 'extras';

interface SaleForStats {
  items: CartItem[];
  createdAt: Date;
  isRefund?: boolean;
}

interface TopProductEntry {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
}

const formatCZK = (value: number) =>
  `${value.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} Kč`;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const startOfWeekMonday = (d: Date) => {
  const day = startOfDay(d);
  const dow = (day.getDay() + 6) % 7; // pondělí = 0
  day.setDate(day.getDate() - dow);
  return day;
};

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

function aggregateTopProducts(sales: SaleForStats[], since: Date): TopProductEntry[] {
  const map = new Map<string, TopProductEntry>();
  for (const sale of sales) {
    if (sale.isRefund) continue;
    if (sale.createdAt < since) continue;
    for (const item of sale.items || []) {
      // Extras (položky s parentItemId) do žebříčku hlavních produktů nepatří
      if (item.parentItemId) continue;
      const key = item.productId || item.productName;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue += item.price * item.quantity;
      } else {
        map.set(key, {
          productId: key,
          name: item.productName,
          quantity: item.quantity,
          revenue: item.price * item.quantity,
        });
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 5);
}

function MarginCell({ price, cost }: { price: number; cost?: number | null }) {
  if (typeof cost !== 'number') {
    return <span className="text-slate-500">—</span>;
  }
  const margin = price - cost;
  const percent = price > 0 ? (margin / price) * 100 : 0;
  const color =
    margin > 0 ? 'text-emerald-400' : margin < 0 ? 'text-red-400' : 'text-slate-400';
  return (
    <span className={color}>
      {formatCZK(margin)}
      <span className="ml-1 text-xs text-slate-500">({percent.toFixed(0)} %)</span>
    </span>
  );
}

interface LeaderboardCardProps {
  title: string;
  icon: React.ReactNode;
  entries: TopProductEntry[];
  loading: boolean;
}

function LeaderboardCard({ title, icon, entries, loading }: LeaderboardCardProps) {
  const medalColors = ['text-amber-400', 'text-slate-300', 'text-orange-400'];
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-purple-400">{icon}</span>
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 rounded-lg bg-slate-800/60 animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500 py-2">Žádné prodeje v tomto období</p>
      ) : (
        <ol className="space-y-1.5">
          {entries.map((entry, index) => (
            <li
              key={entry.productId}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-800/50 transition-colors"
            >
              <span
                className={`w-5 text-center text-sm font-bold ${
                  index < 3 ? medalColors[index] : 'text-slate-500'
                }`}
              >
                {index + 1}
              </span>
              <span className="flex-1 truncate text-sm text-slate-200">{entry.name}</span>
              <span className="text-sm font-semibold text-purple-400">{entry.quantity}×</span>
              <span className="hidden sm:block w-24 text-right text-xs text-slate-400">
                {formatCZK(entry.revenue)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

interface EditState {
  id: string;
  name: string;
  price: string;
  cost: string;
}

interface CatalogTableProps {
  items: Product[];
  showCategory: boolean;
  editing: EditState | null;
  saving: boolean;
  onStartEdit: (p: Product) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditChange: (patch: Partial<EditState>) => void;
  emptyMessage: string;
}

function CatalogTable({
  items,
  showCategory,
  editing,
  saving,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditChange,
  emptyMessage,
}: CatalogTableProps) {
  const inputClass =
    'w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSaveEdit();
    if (e.key === 'Escape') onCancelEdit();
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900">
              <th className="text-left py-3 px-4 font-semibold text-slate-400">Název</th>
              {showCategory && (
                <th className="text-left py-3 px-4 font-semibold text-slate-400">Kategorie</th>
              )}
              <th className="text-right py-3 px-4 font-semibold text-slate-400">Prodejní cena</th>
              <th className="text-right py-3 px-4 font-semibold text-slate-400">Nákupní cena</th>
              <th className="text-right py-3 px-4 font-semibold text-slate-400">Marže</th>
              <th className="w-24 py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={showCategory ? 6 : 5}
                  className="py-10 text-center text-slate-500"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              items.map((product) => {
                const isEditing = editing?.id === product.id;
                return (
                  <tr
                    key={product.id}
                    className="border-b border-slate-800/60 last:border-b-0 hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 text-slate-100 font-medium">
                      {isEditing ? (
                        <input
                          value={editing.name}
                          onChange={(e) => onEditChange({ name: e.target.value })}
                          onKeyDown={handleKeyDown}
                          className={inputClass}
                          autoFocus
                        />
                      ) : (
                        product.name
                      )}
                    </td>
                    {showCategory && (
                      <td className="py-2.5 px-4">
                        {product.category ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-slate-800 border border-slate-700 text-slate-300">
                            {product.category}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    )}
                    <td className="py-2.5 px-4 text-right text-slate-100">
                      {isEditing ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={editing.price}
                          onChange={(e) => onEditChange({ price: e.target.value })}
                          onKeyDown={handleKeyDown}
                          className={`${inputClass} max-w-[7rem] ml-auto text-right`}
                        />
                      ) : (
                        formatCZK(product.price)
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right text-slate-300">
                      {isEditing ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={editing.cost}
                          onChange={(e) => onEditChange({ cost: e.target.value })}
                          onKeyDown={handleKeyDown}
                          placeholder="—"
                          className={`${inputClass} max-w-[7rem] ml-auto text-right`}
                        />
                      ) : typeof product.cost === 'number' ? (
                        formatCZK(product.cost)
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <MarginCell price={product.price} cost={product.cost} />
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={onSaveEdit}
                              disabled={saving || !editing.name.trim()}
                              className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors"
                              title="Uložit"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={onCancelEdit}
                              disabled={saving}
                              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-700/60 transition-colors"
                              title="Zrušit"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => onStartEdit(product)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
                            title="Upravit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function KatalogPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [stores, setStores] = useState<Store[]>([]);
  const [storesLoading, setStoresLoading] = useState(true);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');

  const [activeTab, setActiveTab] = useState<TabType>('products');

  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

  const [sales, setSales] = useState<SaleForStats[]>([]);
  const [salesLoading, setSalesLoading] = useState(true);

  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [extrasSearch, setExtrasSearch] = useState('');

  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  // Provozovny uživatele
  useEffect(() => {
    if (!user) return;
    const storesQuery = query(
      collection(db, 'users', user.uid, 'stores'),
      where('isActive', '==', true)
    );
    const unsubscribe = onSnapshot(storesQuery, (snapshot) => {
      const data: Store[] = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as Store))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
      setStores(data);
      setSelectedStoreId((prev) => (prev && data.some((s) => s.id === prev) ? prev : data[0]?.id || ''));
      setStoresLoading(false);
    });
    return unsubscribe;
  }, [user]);

  // Kompletní katalog (produkty i extras v jedné kolekci, extras mají isExtra: true)
  useEffect(() => {
    if (!user || !selectedStoreId) return;
    setProductsLoading(true);
    const productsQuery = query(
      collection(db, 'users', user.uid, 'stores', selectedStoreId, 'products')
    );
    const unsubscribe = onSnapshot(productsQuery, (snapshot) => {
      const data: Product[] = snapshot.docs.map((d) => {
        const v = d.data() as Record<string, any>;
        return {
          id: d.id,
          name: v.name || '',
          price: v.price || 0,
          cost: typeof v.cost === 'number' ? v.cost : undefined,
          category: v.category || undefined,
          isPopular: v.isPopular || false,
          soldCount: v.soldCount || 0,
          createdAt: v.createdAt?.toDate?.() || new Date(),
          updatedAt: v.updatedAt?.toDate?.() || new Date(),
          isExtra: v.isExtra === true,
        };
      });
      setAllProducts(data.sort((a, b) => a.name.localeCompare(b.name, 'cs')));
      setProductsLoading(false);
    });
    return unsubscribe;
  }, [user, selectedStoreId]);

  // Prodeje pro žebříčky – od začátku měsíce nebo týdne (co nastalo dřív)
  useEffect(() => {
    if (!user || !selectedStoreId) return;
    setSalesLoading(true);
    const now = new Date();
    const since = new Date(
      Math.min(startOfMonth(now).getTime(), startOfWeekMonday(now).getTime())
    );
    const salesQuery = query(
      collection(db, 'users', user.uid, 'stores', selectedStoreId, 'sales'),
      where('createdAt', '>=', Timestamp.fromDate(since))
    );
    const unsubscribe = onSnapshot(salesQuery, (snapshot) => {
      const data: SaleForStats[] = snapshot.docs.map((d) => {
        const v = d.data() as Record<string, any>;
        return {
          items: (v.items || []) as CartItem[],
          createdAt: v.createdAt?.toDate?.() || new Date(),
          isRefund: v.isRefund === true,
        };
      });
      setSales(data);
      setSalesLoading(false);
    });
    return unsubscribe;
  }, [user, selectedStoreId]);

  const mainProducts = useMemo(() => allProducts.filter((p) => !p.isExtra), [allProducts]);
  const extras = useMemo(() => allProducts.filter((p) => p.isExtra), [allProducts]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    mainProducts.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'cs'));
  }, [mainProducts]);

  const filteredProducts = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    return mainProducts.filter((p) => {
      if (term && !p.name.toLowerCase().includes(term)) return false;
      if (categoryFilter && p.category !== categoryFilter) return false;
      return true;
    });
  }, [mainProducts, productSearch, categoryFilter]);

  const filteredExtras = useMemo(() => {
    const term = extrasSearch.trim().toLowerCase();
    if (!term) return extras;
    return extras.filter((p) => p.name.toLowerCase().includes(term));
  }, [extras, extrasSearch]);

  const leaderboards = useMemo(() => {
    const now = new Date();
    return {
      day: aggregateTopProducts(sales, startOfDay(now)),
      week: aggregateTopProducts(sales, startOfWeekMonday(now)),
      month: aggregateTopProducts(sales, startOfMonth(now)),
    };
  }, [sales]);

  const startEdit = (p: Product) => {
    setEditing({
      id: p.id,
      name: p.name,
      price: String(p.price),
      cost: typeof p.cost === 'number' ? String(p.cost) : '',
    });
  };

  const saveEdit = async () => {
    if (!user || !selectedStoreId || !editing || !editing.name.trim()) return;
    setSaving(true);
    try {
      const parsedCost = editing.cost.trim() === '' ? null : Number(editing.cost);
      await updateDoc(
        doc(db, 'users', user.uid, 'stores', selectedStoreId, 'products', editing.id),
        {
          name: editing.name.trim(),
          price: Number(editing.price) || 0,
          cost: parsedCost !== null && Number.isFinite(parsedCost) ? parsedCost : null,
          updatedAt: serverTimestamp(),
        }
      );
      setEditing(null);
    } catch (e) {
      console.error('Nepodařilo se uložit změny produktu', e);
    } finally {
      setSaving(false);
    }
  };

  const searchInputClass =
    'w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-shadow';

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#131722] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500" />
      </div>
    );
  }

  if (!user) {
    return <LoginRequiredModal redirectPath="/katalog" />;
  }

  return (
    <div className="min-h-screen bg-[#131722]">
      {/* Hlavička */}
      <header className="sticky top-0 z-50 bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            <div className="flex items-center min-w-0">
              <button
                onClick={() => router.push('/')}
                className="mr-3 w-10 h-10 rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center flex-shrink-0"
                title="Zpět na přehled"
              >
                <ArrowLeft className="h-5 w-5 text-slate-300" />
              </button>
              <BookOpen className="h-7 w-7 text-purple-500 mr-3 flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-white truncate">Katalog</h1>
                <p className="text-xs text-slate-400">Produkty a extras</p>
              </div>
            </div>
            {stores.length > 0 && (
              <select
                value={selectedStoreId}
                onChange={(e) => {
                  setSelectedStoreId(e.target.value);
                  setEditing(null);
                }}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500 max-w-[14rem]"
              >
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </header>

      {/* Taby Produkty / Extras */}
      <nav className="sticky top-16 z-40 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex">
            {(
              [
                { id: 'products' as TabType, label: 'Produkty', icon: <Package className="h-5 w-5" /> },
                { id: 'extras' as TabType, label: 'Extras', icon: <Sparkles className="h-5 w-5" /> },
              ]
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setEditing(null);
                }}
                className={`flex items-center gap-2 px-5 py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {storesLoading || !selectedStoreId ? (
          storesLoading ? (
            <div className="flex items-center justify-center py-24">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500" />
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-slate-400">
              Nemáte žádnou aktivní provozovnu. Nejprve ji vytvořte na hlavním přehledu.
            </div>
          )
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === 'products' ? (
                <div className="space-y-6">
                  {/* Žebříčky */}
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <Trophy className="h-5 w-5 text-purple-400" />
                      <h2 className="text-base font-semibold text-slate-100">
                        Nejprodávanější produkty
                      </h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <LeaderboardCard
                        title="Top Dnes"
                        icon={<Calendar className="h-4 w-4" />}
                        entries={leaderboards.day}
                        loading={salesLoading}
                      />
                      <LeaderboardCard
                        title="Top Tento Týden"
                        icon={<CalendarDays className="h-4 w-4" />}
                        entries={leaderboards.week}
                        loading={salesLoading}
                      />
                      <LeaderboardCard
                        title="Top Tento Měsíc"
                        icon={<CalendarRange className="h-4 w-4" />}
                        entries={leaderboards.month}
                        loading={salesLoading}
                      />
                    </div>
                  </section>

                  {/* Ovládání */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <input
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder="Hledat produkt…"
                        className={searchInputClass}
                      />
                    </div>
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500 sm:w-56"
                    >
                      <option value="">Všechny kategorie</option>
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Tabulka produktů */}
                  {productsLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500" />
                    </div>
                  ) : (
                    <>
                      <CatalogTable
                        items={filteredProducts}
                        showCategory
                        editing={editing}
                        saving={saving}
                        onStartEdit={startEdit}
                        onCancelEdit={() => setEditing(null)}
                        onSaveEdit={saveEdit}
                        onEditChange={(patch) =>
                          setEditing((prev) => (prev ? { ...prev, ...patch } : prev))
                        }
                        emptyMessage={
                          mainProducts.length === 0
                            ? 'Katalog je prázdný. Produkty přidáte v prodejním systému.'
                            : 'Hledání nevrátilo žádné produkty.'
                        }
                      />
                      <p className="text-xs text-slate-500">
                        {filteredProducts.length} z {mainProducts.length} produktů
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Ovládání extras */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <input
                      value={extrasSearch}
                      onChange={(e) => setExtrasSearch(e.target.value)}
                      placeholder="Hledat extra…"
                      className={searchInputClass}
                    />
                  </div>

                  {/* Tabulka extras */}
                  {productsLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-500" />
                    </div>
                  ) : (
                    <>
                      <CatalogTable
                        items={filteredExtras}
                        showCategory={false}
                        editing={editing}
                        saving={saving}
                        onStartEdit={startEdit}
                        onCancelEdit={() => setEditing(null)}
                        onSaveEdit={saveEdit}
                        onEditChange={(patch) =>
                          setEditing((prev) => (prev ? { ...prev, ...patch } : prev))
                        }
                        emptyMessage={
                          extras.length === 0
                            ? 'Zatím žádná extras. Přidáte je v prodejním systému přes správu extras.'
                            : 'Hledání nevrátilo žádná extras.'
                        }
                      />
                      <p className="text-xs text-slate-500">
                        {filteredExtras.length} z {extras.length} extras
                      </p>
                    </>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}
