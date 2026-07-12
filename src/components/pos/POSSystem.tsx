'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/contexts/AuthContext';
import { useStore } from '@/contexts/StoreContext';
import { collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Product, CartItem, PendingPurchase } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ShoppingCart, CreditCard, DollarSign, AlertCircle, Package, Pin, CheckCircle } from 'lucide-react';
import { DiscountModal } from './DiscountModal';

const CheckoutModal = dynamic(
  () => import('./CheckoutModal').then((m) => ({ default: m.CheckoutModal })),
  { ssr: false }
);
const ProductEditor = dynamic(
  () => import('./ProductEditor').then((m) => ({ default: m.ProductEditor })),
  { ssr: false }
);
const PinnedProductsGrid = dynamic(
  () => import('./PinnedProductsGrid').then((m) => ({ default: m.PinnedProductsGrid })),
  { ssr: false }
);
const SelectExtrasModal = dynamic(
  () => import('./SelectExtrasModal').then((m) => ({ default: m.SelectExtrasModal })),
  { ssr: false }
);

const CART_SAVE_DEBOUNCE_MS = 400;
/** Mezera mezi přidáními stejného produktu – po delší pauze začíná badge znovu od 1× */
const CART_ADD_BURST_GAP_MS = 900;
const CART_ADD_HIGHLIGHT_MS = 500;

/** Stabilní obrys bez ring-offset — na mobilu neposouvá layout při highlightu */
const productPickButtonClass = (isHighlighted: boolean) =>
  `relative overflow-visible ring-2 ring-inset touch-target transition-colors duration-200 ${
    isHighlighted
      ? 'ring-purple-500 bg-purple-50 dark:bg-purple-900/10'
      : 'ring-transparent'
  }`;

type AddedProductHighlight = { productId: string; count: number };

const ProductAddedBadge: React.FC<{ count: number; positionClassName?: string }> = ({
  count,
  positionClassName = 'top-1.5 right-1.5',
}) => (
  <motion.span
    key={count}
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.15, ease: 'easeOut' }}
    className={`pointer-events-none absolute z-10 rounded-md bg-purple-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-tight text-white shadow-sm ring-1 ring-purple-400/30 dark:bg-purple-500 dark:ring-purple-300/20 ${positionClassName}`}
    aria-hidden
  >
    {count}×
  </motion.span>
);

interface POSSystemProps {
  storeId: string;
  storeName: string;
}

export const POSSystem: React.FC<POSSystemProps> = ({ storeId, storeName }) => {
  const PENDING_PURCHASES_LIMIT = 20;
  const { user } = useAuth();
  const storeDoc = useStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showProductEditor, setShowProductEditor] = useState(false);
  const [isReturnMode, setIsReturnMode] = useState(false);
  const [discount, setDiscount] = useState<{ type: 'percentage' | 'amount'; value: number } | null>(null);
  const [pendingPurchases, setPendingPurchases] = useState<PendingPurchase[]>([]);
  const [showPinnedManager, setShowPinnedManager] = useState(false);
  const pinnedProductIds = storeDoc?.pinnedProductIds ?? [];
  const [pinnedSearchTerm, setPinnedSearchTerm] = useState('');
  const [showSelectExtras, setShowSelectExtras] = useState(false);
  const [extrasParentItemId, setExtrasParentItemId] = useState<string | null>(null);
  const [addedHighlight, setAddedHighlight] = useState<AddedProductHighlight | null>(null);
  /** Odpočet popupu úspěšné platby; null = popup skrytý */
  const [successPopupCountdown, setSuccessPopupCountdown] = useState<number | null>(null);
  /** Čas posledního zpracovaného PAYMENT_SUCCESS – deduplikace zpráv z více kanálů */
  const paymentSuccessHandledAtRef = useRef(0);
  const highlightTimerRef = useRef<number | null>(null);
  const pendingHighlightRef = useRef<AddedProductHighlight | null>(null);
  const addBurstRef = useRef<Map<string, { count: number; lastAt: number }>>(new Map());
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuDropdownRef = useRef<HTMLDivElement | null>(null);
  const cartColumnRef = useRef<HTMLDivElement | null>(null);
  const cartColumnHeightRef = useRef<number | null>(null);

  /** Na mobilu dorovná scroll, když košík nahoře změní výšku — produkty zůstanou na místě */
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 1023px)').matches) return;

    const column = cartColumnRef.current;
    if (!column) return;

    const newHeight = column.offsetHeight;
    const prevHeight = cartColumnHeightRef.current;
    cartColumnHeightRef.current = newHeight;
    if (prevHeight === null) return;

    const delta = newHeight - prevHeight;
    if (delta === 0) return;

    const scrollRoot =
      document.getElementById('__next') ?? document.documentElement;
    if (scrollRoot.scrollTop <= 0) return;

    scrollRoot.scrollTop += delta;
  }, [cart, discount, isReturnMode]);

  // Funkce pro normalizaci diakritiky
  const normalizeText = (text: string): string => {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Odstraní diakritiku
      .toLowerCase();
  };

  // Firestore perzistence košíku (per uživatel a prodejna)
  const suppressNextSaveRef = useRef(false);
  const hasLoadedCartRef = useRef(false);
  const cartPersistGenerationRef = useRef(0);
  const cartSaveTimerRef = useRef<number | null>(null);
  const skipCartSnapshotRef = useRef(false);
  /** Každá lokální změna košíku; snapshot z Firestore nesmí přepsat novější stav. */
  const cartRevisionRef = useRef(0);
  const lastSavedRevisionRef = useRef(0);

  const bumpCartRevision = () => {
    cartRevisionRef.current += 1;
  };

  const persistCartToFirestore = useCallback(
    async (items: CartItem[], generationAtCall?: number) => {
      if (!user?.uid || !storeId) return;
      if (
        generationAtCall !== undefined &&
        generationAtCall !== cartPersistGenerationRef.current
      ) {
        return;
      }

      const cartDocRef = doc(db, 'users', user.uid, 'stores', storeId, 'state', 'cart');
      if (items.length === 0) {
        await deleteDoc(cartDocRef);
        return;
      }
      await setDoc(
        cartDocRef,
        {
          items,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    },
    [user, storeId]
  );

  const clearCartState = useCallback(async () => {
    const generationAtClear = ++cartPersistGenerationRef.current;
    const revisionAtClear = ++cartRevisionRef.current;
    if (cartSaveTimerRef.current !== null) {
      window.clearTimeout(cartSaveTimerRef.current);
      cartSaveTimerRef.current = null;
    }
    suppressNextSaveRef.current = true;
    setCart([]);

    if (!user?.uid || !storeId) return;

    try {
      await persistCartToFirestore([], generationAtClear);
      if (revisionAtClear === cartRevisionRef.current) {
        lastSavedRevisionRef.current = revisionAtClear;
      }
    } catch (error) {
      console.error('❌ Chyba při mazání košíku ve Firestore:', error);
    }
  }, [user, storeId, persistCartToFirestore]);

  // Odběr košíku z Firestore
  useEffect(() => {
    if (!user || !user.uid || !storeId) return;

    const cartDocRef = doc(db, 'users', user.uid, 'stores', storeId, 'state', 'cart');
    const unsubscribe = onSnapshot(cartDocRef, (snapshot) => {
      if (skipCartSnapshotRef.current) return;

      const data = snapshot.data();
      const items: CartItem[] =
        snapshot.exists() && data && Array.isArray(data.items) ? data.items : [];

      if (!hasLoadedCartRef.current) {
        suppressNextSaveRef.current = true;
        setCart(items);
        hasLoadedCartRef.current = true;
        lastSavedRevisionRef.current = cartRevisionRef.current;
        return;
      }

      if (cartRevisionRef.current > lastSavedRevisionRef.current) {
        return;
      }

      suppressNextSaveRef.current = true;
      setCart(items);
    }, (error) => {
      console.error('Error loading cart:', error);
      hasLoadedCartRef.current = true;
    });

    return unsubscribe;
  }, [user, storeId]);

  // Dokončení checkoutu v původním okně: uloží prodej přes API z dat v localStorage.
  // Volá se, když návratová stránka SumUp poslala PAYMENT_SUCCESS s pendingSave
  // (duplicitní tab se zavřel dřív, než stihl prodej uložit sám).
  const finishSumUpCheckout = useCallback(async (txCode: string | null, foreignTxId: string | null) => {
    try {
      const raw = localStorage.getItem('uctarna_payment_data');
      if (!raw) return;
      const {
        storeId: paymentStoreId,
        userId,
        cartItems,
        totalAmount,
        documentId,
        foreignTxId: storedForeign,
        discount: storedDiscount,
        discountAmount,
        finalAmount,
        customerName,
        tipAmount: storedTip
      } = JSON.parse(raw);

      if (!paymentStoreId || !userId || !Array.isArray(cartItems) || cartItems.length === 0) {
        console.error('❌ Chybí data pro dokončení prodeje v localStorage');
        return;
      }

      // „Zámek": okamžitě odstraníme payment data, aby prodej neuložila
      // i návratová stránka (její fallback kontroluje přítomnost tohoto klíče).
      localStorage.removeItem('uctarna_payment_data');

      const tipAmount = typeof storedTip === 'number' && storedTip > 0 ? storedTip : null;

      const response = await fetch('/api/sumup-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'success',
          txCode,
          foreignTxId: foreignTxId || storedForeign,
          documentId: documentId || foreignTxId || storedForeign,
          amount: totalAmount,
          currency: 'CZK',
          storeId: paymentStoreId,
          userId,
          cartItems,
          discount: storedDiscount || null,
          discountAmount: discountAmount || 0,
          finalAmount: finalAmount || totalAmount,
          customerName: customerName || null,
          tipAmount
        }),
      });

      if (response.ok) {
        console.log('✅ Prodej uložen z původního okna (SumUp návrat)');
      } else {
        console.error('❌ Chyba při ukládání prodeje:', response.status, await response.text());
      }
    } catch (error) {
      console.error('❌ Chyba při dokončování SumUp platby:', error);
    }
  }, []);

  // Automatické zavření popupu úspěšné platby po odpočtu
  useEffect(() => {
    if (successPopupCountdown === null) return;
    if (successPopupCountdown <= 0) {
      setSuccessPopupCountdown(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setSuccessPopupCountdown((current) => (current === null ? null : current - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [successPopupCountdown]);

  // Posluchač úspěšné platby (SumUp návrat – stejné kanály jako CheckoutModal)
  useEffect(() => {
    const handlePaymentSuccess = () => {
      // Stejná platba dorazí více kanály (BroadcastChannel, storage event,
      // postMessage) – zpracujeme jen první signál, aby opožděný duplikát
      // znovu neotevřel popup, který už uživatel zavřel.
      const now = Date.now();
      if (now - paymentSuccessHandledAtRef.current < 5000) return;
      paymentSuccessHandledAtRef.current = now;

      void clearCartState();
      setShowCheckout(false);
      setDiscount(null);
      setSuccessPopupCountdown(3);
      console.log('✅ Úspěšná platba – košík vyčištěn');
    };

    // pendingSave: prodej ještě není uložen a duplicitní tab se zavírá –
    // uložení převezme toto (původní) okno.
    const handleSuccessData = (data: { type?: string; pendingSave?: boolean; txCode?: string | null; foreignTxId?: string | null } | undefined) => {
      if (data?.type !== 'PAYMENT_SUCCESS') return;
      if (data.pendingSave) {
        void finishSumUpCheckout(data.txCode ?? null, data.foreignTxId ?? null).then(
          handlePaymentSuccess
        );
        return;
      }
      handlePaymentSuccess();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'PAYMENT_SUCCESS') return;
      if (event.data.pendingSave && event.origin !== window.location.origin) return;
      handleSuccessData(event.data);
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('uctarna_payments');
      bc.onmessage = (ev) => handleSuccessData(ev?.data);
    } catch {
      /* BroadcastChannel nemusí být k dispozici */
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'uctarna_payment_result' || !e.newValue) return;
      try {
        handleSuccessData(JSON.parse(e.newValue));
      } catch {
        /* ignore */
      }
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
      try {
        bc?.close();
      } catch {
        /* ignore */
      }
    };
  }, [clearCartState, finishSumUpCheckout]);

  // Funkce pro aktivaci režimu vratky
  const activateReturnMode = () => {
    setIsReturnMode(true);
    setShowMenu(false);
  };

  // Funkce pro odložení nákupu
  const savePendingPurchase = async () => {
    if (!user || !storeId || cart.length === 0) return;

    try {
      const pendingPurchase: Omit<PendingPurchase, 'id'> = {
        items: cart,
        totalAmount,
        discount,
        finalAmount,
        createdAt: new Date(),
        storeId,
        userId: user.uid,
      };

      await addDoc(collection(db, 'users', user.uid, 'stores', storeId, 'pendingPurchases'), pendingPurchase);
      
      await clearCartState();
      setDiscount(null);
      setShowMenu(false);
      
      console.log('✅ Nákup odložen:', pendingPurchase);
    } catch (error) {
      console.error('❌ Chyba při odkládání nákupu:', error);
    }
  };

  // Funkce pro obnovení odloženého nákupu
  const restorePendingPurchase = async (pendingPurchase: PendingPurchase) => {
    const items = Array.isArray(pendingPurchase.items) ? pendingPurchase.items : [];
    if (items.length === 0) {
      console.warn('⚠️ Odložený nákup nemá položky, obnovení přeskočeno');
      return;
    }

    cartPersistGenerationRef.current += 1;
    if (cartSaveTimerRef.current !== null) {
      window.clearTimeout(cartSaveTimerRef.current);
      cartSaveTimerRef.current = null;
    }

    skipCartSnapshotRef.current = true;
    bumpCartRevision();
    const revisionAtRestore = cartRevisionRef.current;
    setCart(items);
    setDiscount(pendingPurchase.discount || null);

    try {
      await persistCartToFirestore(items);
      await deletePendingPurchase(pendingPurchase.id);
      // Druhý zápis – starý deleteDoc z clearCartState mohl proběhnout až po prvním setDoc
      await persistCartToFirestore(items);
      if (revisionAtRestore === cartRevisionRef.current) {
        lastSavedRevisionRef.current = revisionAtRestore;
      }
      suppressNextSaveRef.current = true;
    } catch (error) {
      console.error('❌ Chyba při obnovení odloženého nákupu:', error);
    } finally {
      skipCartSnapshotRef.current = false;
    }

    console.log('✅ Nákup obnoven a smazán z uložených:', pendingPurchase);
  };

  // Funkce pro smazání odloženého nákupu
  const deletePendingPurchase = async (pendingPurchaseId: string) => {
    if (!user || !storeId) return;

    try {
      await deleteDoc(doc(db, 'users', user.uid, 'stores', storeId, 'pendingPurchases', pendingPurchaseId));
      setPendingPurchases(prev => prev.filter(p => p.id !== pendingPurchaseId));
      console.log('✅ Odložený nákup smazán:', pendingPurchaseId);
    } catch (error) {
      console.error('❌ Chyba při mazání odloženého nákupu:', error);
    }
  };

  // Ukládání košíku do Firestore s debounce – méně zápisů při rychlém přidávání položek.
  useEffect(() => {
    if (!user || !storeId) return;
    if (!hasLoadedCartRef.current) return;
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      return;
    }

    if (cartSaveTimerRef.current !== null) {
      window.clearTimeout(cartSaveTimerRef.current);
      cartSaveTimerRef.current = null;
    }

    const itemsToSave = cart;
    const generationAtSchedule = cartPersistGenerationRef.current;
    const revisionAtSchedule = cartRevisionRef.current;

    cartSaveTimerRef.current = window.setTimeout(async () => {
      cartSaveTimerRef.current = null;
      if (generationAtSchedule !== cartPersistGenerationRef.current) return;

      try {
        await persistCartToFirestore(itemsToSave, generationAtSchedule);
        if (revisionAtSchedule === cartRevisionRef.current) {
          lastSavedRevisionRef.current = revisionAtSchedule;
        }
      } catch (error) {
        console.error('❌ Chyba při ukládání košíku do Firestore:', error);
      }
    }, CART_SAVE_DEBOUNCE_MS);

    return () => {
      if (cartSaveTimerRef.current !== null) {
        window.clearTimeout(cartSaveTimerRef.current);
        cartSaveTimerRef.current = null;
      }
    };
  }, [cart, user, storeId, persistCartToFirestore]);

  // --- konec perzistence košíku ---

  /** Zachová focus vyhledávacího pole — na mobilu se nezavře klávesnice při výběru produktu */
  const keepSearchKeyboardOpen = (e: React.PointerEvent) => {
    e.preventDefault();
  };

  // Zavřít vyhledávač po kliknutí mimo oblast vyhledávání/popupu
  useEffect(() => {
    if (!showAllProducts) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowAllProducts(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showAllProducts]);

  // Zavřít menu po kliknutí mimo
  useEffect(() => {
    if (!showMenu) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (menuButtonRef.current?.contains(target)) return;
      if (menuDropdownRef.current?.contains(target)) return;
      setShowMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [showMenu]);

  useEffect(() => {
    if (!user || !user.uid || !storeId) return;

    const productsQuery = query(
      collection(db, 'users', user.uid, 'stores', storeId, 'products')
    );

    const unsubscribe = onSnapshot(productsQuery, (snapshot) => {
      const productsData: Product[] = [];

      snapshot.forEach((doc) => {
        const data = doc.data();

        const product: Product = {
          id: doc.id,
          name: data.name || 'Neznámý produkt',
          price: data.price || 0,
          category: data.category,
          isPopular: data.isPopular || false,
          soldCount: data.soldCount || 0,
          createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
          updatedAt: data.updatedAt ? data.updatedAt.toDate() : new Date(),
        };
        
        productsData.push(product);
      });

      setProducts(productsData);
      setLoading(false);
      setError(null);
    }, (error) => {
      console.error('❌ Error loading products:', error);
      setError('Chyba při načítání produktů: ' + error.message);
      setLoading(false);
    });

    return unsubscribe;
  }, [user, storeId]);

  // Načítání odložených nákupů
  useEffect(() => {
    if (!user || !user.uid || !storeId) return;

    const pendingQuery = query(
      collection(db, 'users', user.uid, 'stores', storeId, 'pendingPurchases'),
      orderBy('createdAt', 'desc'),
      limit(PENDING_PURCHASES_LIMIT)
    );

    const unsubscribe = onSnapshot(pendingQuery, (snapshot) => {
      const pendingData: PendingPurchase[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        pendingData.push({
          id: doc.id,
          items: data.items || [],
          totalAmount: data.totalAmount || 0,
          discount: data.discount || null,
          finalAmount: data.finalAmount || 0,
          createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
          storeId: data.storeId,
          userId: data.userId,
          note: data.note,
        });
      });

      setPendingPurchases(pendingData);
    }, (error) => {
      console.error('❌ Error loading pending purchases:', error);
    });

    return unsubscribe;
  }, [user, storeId]);

  const filteredProducts = useMemo(
    () =>
      products
        .filter((product) => normalizeText(product.name).includes(normalizeText(searchTerm)))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs')),
    [products, searchTerm]
  );

  const topSellingProducts = useMemo(
    () => [...products].sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0)).slice(0, 20),
    [products]
  );

  const pinnedProducts = useMemo(
    () =>
      products
        .filter((p) => pinnedProductIds.includes(p.id))
        .sort((a, b) => pinnedProductIds.indexOf(a.id) - pinnedProductIds.indexOf(b.id)),
    [products, pinnedProductIds]
  );

  const filteredPinnedManagerProducts = useMemo(
    () =>
      products
        .filter((product) => normalizeText(product.name).includes(normalizeText(pinnedSearchTerm)))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs')),
    [products, pinnedSearchTerm]
  );

  const generateItemId = (): string => {
    return 'itm_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  };

  const getMainLineQuantity = (items: CartItem[], productId: string): number =>
    items
      .filter((item) => item.productId === productId && !item.parentItemId)
      .reduce((sum, item) => sum + item.quantity, 0);

  const markProductAddedForHighlight = (prevCart: CartItem[], nextCart: CartItem[], productId: string) => {
    const delta = getMainLineQuantity(nextCart, productId) - getMainLineQuantity(prevCart, productId);
    if (delta === 0) return;

    const addedNow = Math.abs(delta);
    const now = Date.now();
    const prevBurst = addBurstRef.current.get(productId);
    const burstCount =
      prevBurst && now - prevBurst.lastAt <= CART_ADD_BURST_GAP_MS
        ? prevBurst.count + addedNow
        : addedNow;

    addBurstRef.current.set(productId, { count: burstCount, lastAt: now });
    pendingHighlightRef.current = { productId, count: burstCount };
  };

  const flashProductAdded = (productId: string, count: number) => {
    setAddedHighlight({ productId, count });
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setAddedHighlight((current) => (current?.productId === productId ? null : current));
      highlightTimerRef.current = null;
      addBurstRef.current.delete(productId);
    }, CART_ADD_HIGHLIGHT_MS);
  };

  useLayoutEffect(() => {
    const pending = pendingHighlightRef.current;
    if (!pending) return;
    pendingHighlightRef.current = null;
    if (getMainLineQuantity(cart, pending.productId) === 0) return;
    flashProductAdded(pending.productId, pending.count);
  }, [cart]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  // Funkce pro přidání produktu (normální nebo vratka)
  const addToCart = (product: Product) => {
    bumpCartRevision();
    if (isReturnMode) {
      setCart((prevCart) => {
        const existingItem = prevCart.find((item) => item.productId === product.id);
        let nextCart: CartItem[];
        if (existingItem) {
          nextCart = prevCart.map((item) =>
            item.productId === product.id
              ? { ...item, quantity: item.quantity - 1 }
              : item
          );
        } else {
          nextCart = [
            ...prevCart,
            {
              itemId: generateItemId(),
              productId: product.id,
              productName: product.name,
              price: product.price,
              quantity: -1,
              parentItemId: null,
            },
          ];
        }
        markProductAddedForHighlight(prevCart, nextCart, product.id);
        return nextCart;
      });
      setIsReturnMode(false);
      return;
    }

    setCart((prevCart) => {
      const existingItem = prevCart.find(
        (item) => item.productId === product.id && !item.parentItemId
      );
      let nextCart: CartItem[];
      if (existingItem) {
        nextCart = prevCart.map((item) =>
          item.productId === product.id && !item.parentItemId
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        nextCart = [
          ...prevCart,
          {
            itemId: generateItemId(),
            productId: product.id,
            productName: product.name,
            price: product.price,
            quantity: 1,
            parentItemId: null,
          },
        ];
      }
      markProductAddedForHighlight(prevCart, nextCart, product.id);
      return nextCart;
    });
  };

  const removeItemByItemId = (itemId: string) => {
    bumpCartRevision();
    setCart(prevCart => prevCart.filter(item => item.itemId !== itemId && item.parentItemId !== itemId));
  };

  const updateQuantity = (itemId: string, quantity: number) => {
    // Najdeme položku v košíku pro určení, zda je to vratka
    const cartItem = cart.find(item => item.itemId === itemId);
    const isReturnItem = cartItem && cartItem.quantity < 0;
    
    // U vratek (negativní množství) povolíme záporná čísla, ale odstraníme při 0 nebo kladném
    if (isReturnItem && quantity >= 0) {
      if (cartItem?.itemId) removeItemByItemId(cartItem.itemId);
      return;
    }
    
    // U normálních produktů (kladné množství) odstraníme při množství <= 0
    if (!isReturnItem && quantity <= 0) {
      if (cartItem?.itemId) removeItemByItemId(cartItem.itemId);
      return;
    }

    bumpCartRevision();
    setCart(prevCart =>
      prevCart.map(item =>
        item.itemId === itemId
          ? { ...item, quantity }
          : item
      )
    );
  };

  const openSelectExtrasForItem = (parentItemId: string) => {
    setExtrasParentItemId(parentItemId);
    setShowSelectExtras(true);
  };

  const handleSelectExtras = (selectedExtras: Product[]) => {
    if (!extrasParentItemId) return;
    bumpCartRevision();
    setCart(prev => {
      const updated = [...prev];
      for (const p of selectedExtras) {
        // Pokud už existuje stejný extra pro tento parent, zvyšit množství
        const existing = updated.find(i => i.productId === p.id && i.parentItemId === extrasParentItemId);
        if (existing) {
          existing.quantity += 1;
        } else {
          updated.push({
            itemId: generateItemId(),
            productId: p.id,
            productName: p.name,
            price: p.price,
            quantity: 1,
            parentItemId: extrasParentItemId,
          });
        }
      }
      return updated;
    });
    setExtrasParentItemId(null);
  };

  const togglePinnedProduct = async (productId: string) => {
    if (!user || !storeId) return;
    const isPinned = pinnedProductIds.includes(productId);
    const next = isPinned
      ? pinnedProductIds.filter((id) => id !== productId)
      : [...pinnedProductIds, productId];

    try {
      await updateDoc(doc(db, 'users', user.uid, 'stores', storeId), {
        pinnedProductIds: next,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('❌ Chyba při ukládání připnutých položek:', error);
    }
  };

  const reorderPinnedProducts = async (orderedIds: string[]) => {
    if (!user || !storeId) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'stores', storeId), {
        pinnedProductIds: orderedIds,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('❌ Chyba při ukládání pořadí připnutých položek:', error);
    }
  };

  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  // Výpočet slevy
  const discountAmount = discount ? 
    (discount.type === 'percentage' ? (totalAmount * discount.value / 100) : discount.value) : 0;
  
  // Finální částka po slevě
  const finalAmount = totalAmount - discountAmount;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pos-system w-full p-3 md:p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <h2 className="text-lg md:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">
          Prodejní systém
        </h2>
        <div className="flex items-center space-x-2 md:space-x-3">
        <button
            onClick={() => setShowMenu(!showMenu)}
            ref={menuButtonRef}
            className="w-10 h-10 md:w-auto md:h-10 md:px-3 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-600 transition-colors flex items-center justify-center md:gap-2 text-gray-600 dark:text-gray-300 text-xs md:text-sm lg:text-base"
          >
            <svg className="h-4 w-4 md:h-5 md:w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span className="hidden md:inline">Menu</span>
        </button>
        </div>
      </div>

      {/* Menu dropdown - responzivní pozice */}
      {showMenu && (
        <div ref={menuDropdownRef} className="absolute top-16 md:top-20 right-2 md:right-4 lg:right-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl z-50 min-w-40 md:min-w-48 max-w-xs">
          <div className="p-2">
            <button
              onClick={() => {
                setShowProductEditor(true);
                setShowMenu(false);
              }}
              className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
            >
              <span className="w-8 flex items-center justify-center flex-shrink-0">
                <Package className="w-5 h-5 text-purple-500" />
              </span>
              <span className="truncate">Editor</span>
            </button>
            <button
              onClick={() => {
                setShowPinnedManager(true);
                setShowMenu(false);
              }}
              className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
            >
              <span className="w-8 flex items-center justify-center flex-shrink-0">
                <Pin className="w-5 h-5 text-indigo-500" />
              </span>
              <span className="truncate">Připnuté položky</span>
            </button>
            <button
              onClick={() => {
                setShowDiscountModal(true);
                setShowMenu(false);
              }}
              className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
            >
              <span className="w-8 flex items-center justify-center flex-shrink-0">
                <DollarSign className="w-5 h-5 text-green-500" />
              </span>
              <span className="truncate">Sleva</span>
            </button>
            <button
              onClick={activateReturnMode}
              className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
            >
              <span className="w-8 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </span>
              <span className="truncate">Vratka</span>
            </button>
            {cart.length > 0 && (
              <button
                onClick={savePendingPurchase}
                className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
              >
                <span className="w-8 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </span>
                <span className="truncate">Odložit nákup</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4 lg:gap-6">
        {/* Right Column - Cart (na mobilu nahoře, na desktopu vpravo) */}
        <div
          ref={cartColumnRef}
          className="lg:order-2 space-y-3 md:space-y-4 [overflow-anchor:none]"
        >
          {/* Cart Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm md:text-base lg:text-lg font-semibold text-gray-900 dark:text-white">
              Košík ({cart.reduce((sum, item) => sum + Math.abs(item.quantity), 0)})
            </h3>
            {isReturnMode && (
              <div className="bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 px-2 md:px-3 py-1 rounded-lg text-xs md:text-sm font-medium flex items-center">
                <svg className="h-3 w-3 md:h-4 md:w-4 mr-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                <span className="truncate">Režim vratky</span>
              </div>
            )}
          </div>

          {/* Cart Items */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-2 md:p-3 lg:p-4 max-h-64 md:max-h-80 lg:max-h-96 overflow-y-auto text-gray-900 dark:text-gray-100">
            {cart.length === 0 ? (
              <div className="text-center py-4 md:py-6 lg:py-8">
                <ShoppingCart className="h-8 w-8 md:h-10 md:w-10 lg:h-12 lg:w-12 text-gray-400 mx-auto mb-2 md:mb-3 lg:mb-4" />
                <p className="text-xs md:text-sm lg:text-base text-gray-500 dark:text-gray-400">Košík je prázdný</p>
              </div>
            ) : (
              <div className="space-y-2 md:space-y-3">
                {cart.filter(ci => !ci.parentItemId).map((item) => {
                  const children = cart.filter(c => c.parentItemId === item.itemId);
                  return (
                    <div key={item.itemId || item.productId} className="flex flex-col gap-2 w-full p-2 bg-white dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm">
                      <div className="flex justify-between items-start w-full gap-2 min-w-0">
                        <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm md:text-base leading-tight min-w-0 break-words">
                          {item.productName}
                        </h4>
                        <span className={`font-semibold text-sm md:text-base whitespace-nowrap flex-shrink-0 ${
                          item.quantity < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
                        }`}>
                          {item.price * item.quantity} Kč
                        </span>
                      </div>

                      <div className="flex justify-between items-center w-full mt-1 gap-2 min-w-0">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="bg-gray-100 dark:bg-gray-800 rounded-full p-1 flex items-center flex-shrink-0">
                            <button
                              onClick={() => item.itemId && updateQuantity(item.itemId, item.quantity - 1)}
                              className="w-7 h-7 rounded-full bg-white dark:bg-gray-700 shadow-sm text-rose-600 dark:text-rose-300 inline-flex items-center justify-center text-sm font-semibold leading-none flex-shrink-0"
                            >
                              -
                            </button>
                            <span className="w-8 text-center font-medium text-gray-900 dark:text-white text-sm whitespace-nowrap">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => item.itemId && updateQuantity(item.itemId, item.quantity + 1)}
                              className="w-7 h-7 rounded-full bg-white dark:bg-gray-700 shadow-sm text-emerald-600 dark:text-emerald-300 inline-flex items-center justify-center text-sm font-semibold leading-none flex-shrink-0"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {item.price} Kč / ks
                          </span>
                        </div>

                        {!isReturnMode && (
                          <button
                            onClick={() => item.itemId && openSelectExtrasForItem(item.itemId)}
                            className="h-7 px-2.5 rounded-md text-xs leading-none bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/40 inline-flex items-center justify-center whitespace-nowrap flex-shrink-0"
                          >
                            Extra
                          </button>
                        )}
                      </div>

                      {item.quantity < 0 && (
                        <p className="text-xs text-red-500 whitespace-nowrap leading-none m-0">Vratka</p>
                      )}
                      {children.length > 0 && (
                        <div className="mt-1 pl-3 border-l border-gray-300 dark:border-gray-600 space-y-2 min-w-0">
                          {children.map(ch => (
                            <div key={ch.itemId || `${item.itemId}-${ch.productId}`}
                              className="flex flex-col gap-1.5 w-full p-2 bg-transparent rounded-md min-w-0">
                              <div className="flex justify-between items-start w-full gap-2 min-w-0 text-xs md:text-sm text-gray-800 dark:text-gray-200">
                                <span className="min-w-0 break-words">
                                  + {ch.productName}
                                </span>
                                <span className="font-medium whitespace-nowrap flex-shrink-0">
                                  {ch.price * ch.quantity} Kč
                                </span>
                              </div>
                              <div className="flex justify-between items-center w-full gap-2 min-w-0">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="bg-gray-100 dark:bg-gray-800 rounded-full p-1 flex items-center flex-shrink-0">
                                    <button onClick={() => ch.itemId && updateQuantity(ch.itemId, ch.quantity - 1)}
                                      className="w-7 h-7 rounded-full bg-white dark:bg-gray-700 shadow-sm text-rose-600 dark:text-rose-300 inline-flex items-center justify-center text-sm font-semibold leading-none flex-shrink-0">
                                      -
                                    </button>
                                    <span className="w-8 text-center text-sm whitespace-nowrap">{ch.quantity}</span>
                                    <button onClick={() => ch.itemId && updateQuantity(ch.itemId, ch.quantity + 1)}
                                      className="w-7 h-7 rounded-full bg-white dark:bg-gray-700 shadow-sm text-emerald-600 dark:text-emerald-300 inline-flex items-center justify-center text-sm font-semibold leading-none flex-shrink-0">
                                      +
                                    </button>
                                  </div>
                                  <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                    {ch.price} Kč / ks
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                
                {/* Sleva */}
                {discount && (
                  <div className="flex items-center justify-between p-2 md:p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-700">
                    <div className="flex items-center min-w-0 flex-1">
                      <svg className="h-3 w-3 md:h-4 md:w-4 text-green-600 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                      </svg>
                      <span className="text-xs md:text-sm font-medium text-green-700 dark:text-green-300 truncate">
                        Sleva {discount.type === 'percentage' ? `${discount.value}%` : `${discount.value} Kč`}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 md:space-x-3 flex-shrink-0">
                      <span className="text-xs md:text-sm font-semibold text-green-600 dark:text-green-400">
                        -{discountAmount.toFixed(2)} Kč
                      </span>
                      <button
                        onClick={() => setDiscount(null)}
                        className="px-1.5 md:px-2 py-0.5 md:py-1 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-xs hover:bg-red-200 dark:hover:bg-red-900/40 transition-colors flex items-center flex-shrink-0"
                        title="Odstranit slevu"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cart Summary */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-2 md:p-3 lg:p-4">
            <div className="space-y-1.5 md:space-y-2">
              <div className="flex justify-between text-xs md:text-sm text-gray-600 dark:text-gray-400">
                <span>Mezisoučet:</span>
                <span>{totalAmount} Kč</span>
              </div>
              {discount && (
                <div className="flex justify-between text-xs md:text-sm text-green-600 dark:text-green-400">
                  <span>Sleva:</span>
                  <span>-{discountAmount.toFixed(2)} Kč</span>
                </div>
              )}
              <div className="border-t border-gray-200 dark:border-gray-600 pt-1.5 md:pt-2">
                <div className="flex justify-between items-center text-sm md:text-base lg:text-lg font-bold text-gray-900 dark:text-white">
                  <span>Celkem:</span>
                  <span>{finalAmount} Kč</span>
                </div>
              </div>
            </div>
          </div>

          {/* Checkout Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCheckout(true)}
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-2.5 md:py-3 px-3 md:px-4 lg:px-6 rounded-lg font-medium hover:from-purple-700 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-all duration-200 shadow-lg flex items-center justify-center text-xs md:text-sm lg:text-base"
          >
            <CreditCard className="h-3 w-3 md:h-4 md:w-4 lg:h-5 lg:w-5 mr-2 flex-shrink-0" />
            <span className="truncate">
              {finalAmount < 0 ? `Vrátit zákazníkovi ${Math.abs(finalAmount)} Kč` : `Zaplatit ${finalAmount} Kč`}
            </span>
          </motion.button>
        </div>

        {/* Left Column - Products (na mobilu dole, na desktopu vlevo) */}
        <div className="lg:col-span-2 lg:order-1 space-y-3 md:space-y-4 lg:space-y-6">
          {/* Search */}
          <div className="relative" ref={searchContainerRef}>
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
            <input
              type="text"
              placeholder="Hledat produkty..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onFocus={() => setShowAllProducts(true)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            
            {/* Moderní popup s produkty */}
            {showAllProducts && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl z-50 max-h-96 overflow-hidden">
                {/* Header popupu */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Všechny produkty ({filteredProducts.length})
                  </h3>
                  <button
                    type="button"
                    onPointerDown={keepSearchKeyboardOpen}
                    onClick={() => setShowAllProducts(false)}
                    className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors inline-flex items-center justify-center"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                {/* Obsah popupu */}
                <div className="p-4 max-h-80 overflow-y-auto">
                  {filteredProducts.length === 0 ? (
                    <div className="text-center py-8">
                      <Package className="h-8 w-8 text-gray-400 mx-auto mb-3" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {searchTerm ? `Žádné produkty neodpovídají vyhledávání "${searchTerm}"` : 'Žádné produkty nebyly nalezeny'}
                      </p>
                      {products.length === 0 && (
                        <p className="text-xs text-gray-400 mt-2">
                          Vytvořte svůj první produkt kliknutím na "Nový produkt"
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2">
                      {filteredProducts.map((product) => {
                        const isHighlighted = addedHighlight?.productId === product.id;
                        return (
                          <motion.button
                            key={product.id}
                            type="button"
                            onPointerDown={keepSearchKeyboardOpen}
                            onClick={() => addToCart(product)}
                            className={`w-full p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/10 text-left group ${productPickButtonClass(isHighlighted)}`}
                        >
                          {isHighlighted && addedHighlight && (
                            <ProductAddedBadge count={addedHighlight.count} positionClassName="top-1.5 left-1.5" />
                          )}
                          <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-gray-900 dark:text-white text-sm truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                                {product.name}
                              </h4>
                            </div>
                            <div className="ml-3 flex-shrink-0">
                              <span className="text-lg font-bold text-purple-600 dark:text-purple-400">
                                {product.price} Kč
                              </span>
                            </div>
                          </div>
                        </motion.button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Odložené nákupy */}
          {pendingPurchases.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Odložené nákupy
              </h3>
              <div className="space-y-3">
                {pendingPurchases.map((pending) => (
                  <motion.div
                    key={pending.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-600 transition-all duration-200"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-3">
                        <svg className="h-5 w-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          {pending.createdAt.toLocaleString('cs-CZ', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => restorePendingPurchase(pending)}
                          className="px-3 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg text-sm hover:bg-blue-200 dark:hover:bg-blue-900/40 transition-colors"
                        >
                          Obnovit
                        </button>
                        <button
                          onClick={() => deletePendingPurchase(pending.id)}
                          className="px-3 py-1 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm hover:bg-red-200 dark:hover:bg-red-900/40 transition-colors"
                        >
                          Smazat
                        </button>
                      </div>
                    </div>
                    
                    <div className="space-y-2 mb-3">
                      {pending.items.map((item, index) => (
                        <div key={index} className="flex justify-between text-sm">
                          <span className="text-gray-700 dark:text-gray-300">
                            {item.productName} × {item.quantity}
                          </span>
                          <span className={`font-medium ${
                            item.quantity < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
                          }`}>
                            {item.price * item.quantity} Kč
                          </span>
                        </div>
                      ))}
                    </div>
                    
                    {pending.discount && (
                      <div className="flex justify-between text-sm text-green-600 dark:text-green-400 mb-2">
                        <span>Sleva:</span>
                        <span>-{pending.discount.type === 'percentage' ? `${pending.discount.value}%` : `${pending.discount.value} Kč`}</span>
                      </div>
                    )}
                    
                    <div className="border-t border-gray-200 dark:border-gray-600 pt-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Celkem:</span>
                        <span className={`text-lg font-bold ${
                          pending.finalAmount < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
                        }`}>
                          {pending.finalAmount} Kč
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Připnuté položky */}
          {pinnedProducts.length > 0 && (
            <PinnedProductsGrid
              products={pinnedProducts}
              highlightedProductId={addedHighlight?.productId ?? null}
              renderBadge={() =>
                addedHighlight ? <ProductAddedBadge count={addedHighlight.count} /> : null
              }
              pickButtonClass={productPickButtonClass}
              onProductClick={addToCart}
              onReorder={reorderPinnedProducts}
            />
          )}

          {/* Top 20 Nejprodávanějších */}
          {topSellingProducts.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Nejprodávanější
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {topSellingProducts.map((product) => {
                  const isHighlighted = addedHighlight?.productId === product.id;
                  return (
                    <motion.button
                      key={product.id}
                      type="button"
                      onClick={() => addToCart(product)}
                      className={`bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600 text-left ${productPickButtonClass(isHighlighted)}`}
                    >
                      {isHighlighted && addedHighlight && (
                        <ProductAddedBadge count={addedHighlight.count} />
                      )}
                      <h4 className="font-medium text-gray-900 dark:text-white text-sm mb-2">
                        {product.name}
                      </h4>
                      <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
                        {product.price} Kč
                      </p>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showCheckout && (
          <CheckoutModal
            onClose={() => setShowCheckout(false)}
            cart={cart}
            totalAmount={totalAmount}
            storeId={storeId}
            storeName={storeName}
            discount={discount}
            discountAmount={discountAmount}
            finalAmount={finalAmount}
            onSuccess={() => {
              void clearCartState();
              setShowCheckout(false);
              setDiscount(null); // Reset slevy po úspěšném prodeji
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProductEditor && (
          <ProductEditor
            storeId={storeId}
            onClose={() => setShowProductEditor(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDiscountModal && (
          <DiscountModal
            onClose={() => setShowDiscountModal(false)}
            onApply={(discountData) => {
              setDiscount(discountData);
              setShowDiscountModal(false);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPinnedManager && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => { setShowPinnedManager(false); setPinnedSearchTerm(''); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div className="flex items-center">
                  <Pin className="w-5 h-5 text-indigo-500 mr-2" />
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Připnuté položky</h3>
                </div>
                <button
                  onClick={() => { setShowPinnedManager(false); setPinnedSearchTerm(''); }}
                  className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300"
                >
                  ✕
                </button>
              </div>
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={pinnedSearchTerm}
                    onChange={(e) => setPinnedSearchTerm(e.target.value)}
                    placeholder="Hledat položku..."
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                  />
                </div>
              </div>
              <div className="p-4 max-h-[52vh] overflow-y-auto space-y-2">
                {filteredPinnedManagerProducts.map((product) => {
                    const isPinned = pinnedProductIds.includes(product.id);
                    return (
                      <button
                        key={product.id}
                        onClick={() => togglePinnedProduct(product.id)}
                        className={`w-full px-4 py-3 rounded-lg border text-left transition-colors ${
                          isPinned
                            ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium break-words">{product.name}</span>
                          <span className="text-sm whitespace-nowrap">{product.price} Kč</span>
                        </div>
                      </button>
                    );
                  })}
                {filteredPinnedManagerProducts.length === 0 && (
                  <div className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
                    Žádné položky pro hledaný výraz.
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSelectExtras && extrasParentItemId && (
          <SelectExtrasModal
            storeId={storeId}
            onClose={() => { setShowSelectExtras(false); setExtrasParentItemId(null); }}
            onSelect={handleSelectExtras}
          />
        )}
      </AnimatePresence>

      {/* Popup potvrzení úspěšné platby (SumUp návrat) – zavře se samo po odpočtu */}
      <AnimatePresence>
        {successPopupCountdown !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
            onClick={() => setSuccessPopupCountdown(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setSuccessPopupCountdown(null)}
                aria-label="Zavřít"
                className="absolute top-3 right-3 w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400"
              >
                ✕
              </button>
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 20 }}
                className="mx-auto w-20 h-20 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-5"
              >
                <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
              </motion.div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Platba byla úspěšná!
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Prodej byl zaznamenán a košík vyčištěn.
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Okno se zavře za {successPopupCountdown} s
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
