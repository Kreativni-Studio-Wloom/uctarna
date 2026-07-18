'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { Product, CartItem } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package,
  Sparkles,
  Search,
  Pencil,
  Check,
  X,
  Plus,
  Trash2,
  AlertTriangle,
  Trophy,
  Calendar,
  CalendarDays,
  CalendarRange,
} from 'lucide-react';
import { AddProductModal } from './AddProductModal';

interface CatalogViewProps {
  storeId: string;
}

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

/** Posledních N kalendářních dní včetně dneška (N=7 → dnes + 6 předchozích dní). */
const startOfLastNDays = (d: Date, days: number) => {
  const day = startOfDay(d);
  day.setDate(day.getDate() - (days - 1));
  return day;
};

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
    return <span className="text-gray-400 dark:text-gray-500">—</span>;
  }
  const margin = price - cost;
  const percent = price > 0 ? (margin / price) * 100 : 0;
  const color =
    margin > 0
      ? 'text-green-600 dark:text-green-400'
      : margin < 0
      ? 'text-red-600 dark:text-red-400'
      : 'text-gray-500 dark:text-gray-400';
  return (
    <span className={`whitespace-nowrap ${color}`}>
      {formatCZK(margin)}
      <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">
        ({percent.toFixed(0)} %)
      </span>
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
  const medalColors = ['text-amber-500', 'text-gray-400', 'text-orange-500'];
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-brand-600 dark:text-brand-400">{icon}</span>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
          Žádné prodeje v tomto období
        </p>
      ) : (
        <ol className="space-y-1.5">
          {entries.map((entry, index) => (
            <li
              key={entry.productId}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <span
                className={`w-5 text-center text-sm font-bold ${
                  index < 3 ? medalColors[index] : 'text-gray-400 dark:text-gray-500'
                }`}
              >
                {index + 1}
              </span>
              <span className="flex-1 truncate text-sm text-gray-900 dark:text-white">
                {entry.name}
              </span>
              <span className="text-sm font-semibold text-brand-600 dark:text-brand-400">
                {entry.quantity}×
              </span>
              <span className="hidden sm:block w-24 text-right text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
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
  onDelete: (p: Product) => void;
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
  onDelete,
  emptyMessage,
}: CatalogTableProps) {
  const inputClass =
    'w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSaveEdit();
    if (e.key === 'Escape') onCancelEdit();
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-gray-300">
                Název
              </th>
              {showCategory && (
                <th className="text-left py-3 px-4 font-semibold text-gray-600 dark:text-gray-300">
                  Kategorie
                </th>
              )}
              <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap min-w-[8.5rem]">
                Prodejní cena
              </th>
              <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap min-w-[8.5rem]">
                Nákupní cena
              </th>
              <th className="text-right py-3 px-4 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap min-w-[10rem]">
                Marže
              </th>
              <th className="w-24 py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={showCategory ? 6 : 5}
                  className="py-10 text-center text-gray-500 dark:text-gray-400"
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
                    className="border-b border-gray-100 dark:border-gray-700/60 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                  >
                    <td className="py-2.5 px-4 text-gray-900 dark:text-white font-medium">
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
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300">
                            {product.category}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                    )}
                    <td className="py-2.5 px-4 text-right text-gray-900 dark:text-white whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={editing.price}
                          onChange={(e) => onEditChange({ price: e.target.value })}
                          onKeyDown={handleKeyDown}
                          className={`${inputClass} w-28 ml-auto text-right`}
                        />
                      ) : (
                        formatCZK(product.price)
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={editing.cost}
                          onChange={(e) => onEditChange({ cost: e.target.value })}
                          onKeyDown={handleKeyDown}
                          placeholder="—"
                          className={`${inputClass} w-28 ml-auto text-right`}
                        />
                      ) : typeof product.cost === 'number' ? (
                        formatCZK(product.cost)
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <MarginCell price={product.price} cost={product.cost} />
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {isEditing ? (
                          <>
                            <button
                              onClick={onSaveEdit}
                              disabled={saving || !editing.name.trim()}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-40 transition-colors"
                              title="Uložit"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={onCancelEdit}
                              disabled={saving}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                              title="Zrušit"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => onStartEdit(product)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
                              title="Upravit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => onDelete(product)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="Smazat"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
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

export const CatalogView: React.FC<CatalogViewProps> = ({ storeId }) => {
  const { user } = useAuth();

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
  const [addModal, setAddModal] = useState<'product' | 'extra' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Kompletní katalog (produkty i extras v jedné kolekci, extras mají isExtra: true)
  useEffect(() => {
    if (!user || !storeId) return;
    setProductsLoading(true);
    const productsQuery = query(
      collection(db, 'users', user.uid, 'stores', storeId, 'products')
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
  }, [user, storeId]);

  // Prodeje pro žebříčky – posledních 30 dní (pokrývá i 7denní okno)
  useEffect(() => {
    if (!user || !storeId) return;
    setSalesLoading(true);
    const now = new Date();
    const since = startOfLastNDays(now, 30);
    const salesQuery = query(
      collection(db, 'users', user.uid, 'stores', storeId, 'sales'),
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
  }, [user, storeId]);

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
      last7Days: aggregateTopProducts(sales, startOfLastNDays(now, 7)),
      last30Days: aggregateTopProducts(sales, startOfLastNDays(now, 30)),
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
    if (!user || !storeId || !editing || !editing.name.trim()) return;
    setSaving(true);
    try {
      const parsedCost = editing.cost.trim() === '' ? null : Number(editing.cost);
      await updateDoc(
        doc(db, 'users', user.uid, 'stores', storeId, 'products', editing.id),
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

  const confirmDelete = async () => {
    if (!user || !storeId || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'stores', storeId, 'products', deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      console.error('Nepodařilo se smazat položku katalogu', e);
    } finally {
      setDeleting(false);
    }
  };

  const handleAdd = async (name: string, price: number, cost?: number) => {
    if (!user || !storeId || !addModal) return;
    try {
      await addDoc(collection(db, 'users', user.uid, 'stores', storeId, 'products'), {
        name,
        price,
        cost: typeof cost === 'number' ? cost : addModal === 'extra' ? null : 0,
        ...(addModal === 'extra' ? { isExtra: true } : {}),
        isPopular: false,
        soldCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setAddModal(null);
    } catch (e) {
      console.error('Nepodařilo se přidat položku do katalogu', e);
    }
  };

  const searchInputClass =
    'w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500';

  const selectClass =
    'px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white';

  return (
    <div className="space-y-6">
      {/* Taby Produkty / Extras */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
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
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-brand-500 text-brand-600 dark:text-brand-400 bg-brand-50/50 dark:bg-brand-900/10'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

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
                  <Trophy className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                  <h2 className="text-base font-semibold text-gray-900 dark:text-white">
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
                    title="Top Posledních 7 dní"
                    icon={<CalendarDays className="h-4 w-4" />}
                    entries={leaderboards.last7Days}
                    loading={salesLoading}
                  />
                  <LeaderboardCard
                    title="Top Posledních 30 dní"
                    icon={<CalendarRange className="h-4 w-4" />}
                    entries={leaderboards.last30Days}
                    loading={salesLoading}
                  />
                </div>
              </section>

              {/* Ovládání */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
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
                  className={`${selectClass} sm:w-56`}
                >
                  <option value="">Všechny kategorie</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setAddModal('product')}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  <Plus className="h-4 w-4" />
                  Nový produkt
                </button>
              </div>

              {/* Tabulka produktů */}
              {productsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
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
                        onDelete={setDeleteTarget}
                        emptyMessage={
                          mainProducts.length === 0
                            ? 'Katalog je prázdný. Přidejte první produkt tlačítkem výše.'
                            : 'Hledání nevrátilo žádné produkty.'
                        }
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {filteredProducts.length} z {mainProducts.length} produktů
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Ovládání extras */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                  <input
                    value={extrasSearch}
                    onChange={(e) => setExtrasSearch(e.target.value)}
                    placeholder="Hledat extra…"
                    className={searchInputClass}
                  />
                </div>
                <button
                  onClick={() => setAddModal('extra')}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  <Plus className="h-4 w-4" />
                  Nové extra
                </button>
              </div>

              {/* Tabulka extras */}
              {productsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
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
                    onDelete={setDeleteTarget}
                    emptyMessage={
                      extras.length === 0
                        ? 'Zatím žádná extras. Přidejte první tlačítkem výše.'
                        : 'Hledání nevrátilo žádná extras.'
                    }
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {filteredExtras.length} z {extras.length} extras
                  </p>
                </>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {addModal && (
          <AddProductModal
            onClose={() => setAddModal(null)}
            onAdd={handleAdd}
            title={addModal === 'extra' ? 'Nové extra' : 'Nový produkt'}
            submitLabel={addModal === 'extra' ? 'Vytvořit extra' : 'Vytvořit produkt'}
            costRequired={addModal === 'product'}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => !deleting && setDeleteTarget(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {deleteTarget.isExtra ? 'Smazat extra?' : 'Smazat produkt?'}
                </h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
                Opravdu chcete trvale smazat{' '}
                <span className="font-semibold text-gray-900 dark:text-white">
                  {deleteTarget.name}
                </span>
                ? Tuto akci nelze vrátit zpět. Vystavené doklady zůstanou beze změny.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  Zrušit
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Smazat
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
