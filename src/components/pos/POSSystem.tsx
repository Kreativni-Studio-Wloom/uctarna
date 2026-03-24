'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Product, CartItem, PendingPurchase } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, ShoppingCart, CreditCard, DollarSign, AlertCircle, Package, ListPlus } from 'lucide-react';
// removed touch hook usage inside maps; using pointer events instead
import { AddProductModal } from './AddProductModal';
import { CheckoutModal } from './CheckoutModal';
import { DiscountModal } from './DiscountModal';
import { ProductEditor } from './ProductEditor';
import { ExtrasManagerModal } from './ExtrasManagerModal';
import { SelectExtrasModal } from './SelectExtrasModal';

interface POSSystemProps {
  storeId: string;
  storeName: string;
}

export const POSSystem: React.FC<POSSystemProps> = ({ storeId, storeName }) => {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddProduct, setShowAddProduct] = useState(false);
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
  const [showExtrasManager, setShowExtrasManager] = useState(false);
  const [showSelectExtras, setShowSelectExtras] = useState(false);
  const [extrasParentItemId, setExtrasParentItemId] = useState<string | null>(null);
  const [addedHighlightId, setAddedHighlightId] = useState<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

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

  // Odběr košíku z Firestore
  useEffect(() => {
    if (!user || !user.uid || !storeId) return;

    const cartDocRef = doc(db, 'users', user.uid, 'stores', storeId, 'state', 'cart');
    const unsubscribe = onSnapshot(cartDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data: any = snapshot.data();
        const items: CartItem[] = Array.isArray(data.items) ? data.items : [];
        suppressNextSaveRef.current = true;
        setCart(items);
      } else {
        suppressNextSaveRef.current = true;
        setCart([]);
      }
      hasLoadedCartRef.current = true;
    }, (error) => {
      console.error('Error loading cart:', error);
      hasLoadedCartRef.current = true;
    });

    return unsubscribe;
  }, [user, storeId]);

  // Posluchač pro zprávy o úspěšné platbě kartou
  useEffect(() => {
    const handlePaymentSuccess = (event: MessageEvent) => {
      if (event.data?.type === 'PAYMENT_SUCCESS') {
        // Vyčistit košík, zavřít modal a resetovat slevu
        setCart([]);
        setShowCheckout(false);
        setDiscount(null);
        console.log('✅ Úspěšná platba kartou - košík vyčištěn');
      }
    };

    window.addEventListener('message', handlePaymentSuccess);
    return () => window.removeEventListener('message', handlePaymentSuccess);
  }, []);

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
      
      // Vyčistit košík a slevu
      setCart([]);
      setDiscount(null);
      setShowMenu(false);
      
      console.log('✅ Nákup odložen:', pendingPurchase);
    } catch (error) {
      console.error('❌ Chyba při odkládání nákupu:', error);
    }
  };

  // Funkce pro obnovení odloženého nákupu
  const restorePendingPurchase = async (pendingPurchase: PendingPurchase) => {
    setCart(pendingPurchase.items);
    setDiscount(pendingPurchase.discount || null);
    
    // Automaticky smazat z uložených nákupů
    await deletePendingPurchase(pendingPurchase.id);
    
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

  // Ukládání košíku do Firestore při změně obsahu
  useEffect(() => {
    if (!user || !storeId) return;
    if (!hasLoadedCartRef.current) return; // počkej na první načtení ze snapshotu
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      return;
    }
    const cartDocRef = doc(db, 'users', user.uid, 'stores', storeId, 'state', 'cart');
    const save = async () => {
      try {
        await setDoc(cartDocRef, {
          items: cart,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      } catch (error) {
        console.error('❌ Chyba při ukládání košíku do Firestore:', error);
      }
    };
    save();
  }, [cart, user, storeId]);

  // --- konec perzistence košíku ---

  // Zavřít vyhledávač po kliknutí mimo oblast vyhledávání/popupu
  useEffect(() => {
    if (!showAllProducts) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowAllProducts(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAllProducts]);

  useEffect(() => {
    if (!user || !user.uid || !storeId) return;

    console.log('🔍 Loading products for store:', storeId, 'user:', user.uid);

    const productsQuery = query(
      collection(db, 'users', user.uid, 'stores', storeId, 'products')
    );

    const unsubscribe = onSnapshot(productsQuery, (snapshot) => {
      const productsData: Product[] = [];
      console.log('📊 Snapshot size:', snapshot.size);
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        console.log('📦 Product data:', doc.id, data);
        
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
      
      console.log('✅ Loaded products:', productsData.length, productsData);
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
      collection(db, 'users', user.uid, 'stores', storeId, 'pendingPurchases')
    );

    const unsubscribe = onSnapshot(pendingQuery, (snapshot) => {
      const pendingData: PendingPurchase[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        const pendingPurchase: PendingPurchase = {
          id: doc.id,
          items: data.items || [],
          totalAmount: data.totalAmount || 0,
          discount: data.discount || null,
          finalAmount: data.finalAmount || 0,
          createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
          storeId: data.storeId,
          userId: data.userId,
          note: data.note,
        };
        pendingData.push(pendingPurchase);
      });
      
      // Seřadit podle data vytvoření (nejnovější první)
      const sortedPending = pendingData.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setPendingPurchases(sortedPending);
    }, (error) => {
      console.error('❌ Error loading pending purchases:', error);
    });

    return unsubscribe;
  }, [user, storeId]);

  const filteredProducts = products
    .filter(product =>
      normalizeText(product.name).includes(normalizeText(searchTerm))
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'));

  // Top 20 nejprodávanějších produktů na základě soldCount
  const topSellingProducts = products
    .sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0))
    .slice(0, 20);

  const popularProducts = products.filter(product => product.isPopular);

  const generateItemId = (): string => {
    return 'itm_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  };

  // Funkce pro přidání produktu (normální nebo vratka)
  const addToCart = (product: Product) => {
    if (isReturnMode) {
      // Vratka - produkt se přidá s negativním množstvím
      setCart(prevCart => {
        const existingItem = prevCart.find(item => item.productId === product.id);
        if (existingItem) {
          return prevCart.map(item =>
            item.productId === product.id
              ? { ...item, quantity: item.quantity - 1 }
              : item
          );
        } else {
          return [...prevCart, {
            itemId: generateItemId(),
            productId: product.id,
            productName: product.name,
            price: product.price,
            quantity: -1,
            parentItemId: null,
          }];
        }
      });
      setIsReturnMode(false); // Deaktivuje režim vratky
    } else {
      // Normální přidání produktu
    setCart(prevCart => {
      const existingItem = prevCart.find(item => item.productId === product.id && !item.parentItemId);
      if (existingItem) {
        return prevCart.map(item =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        return [...prevCart, {
          itemId: generateItemId(),
          productId: product.id,
          productName: product.name,
          price: product.price,
          quantity: 1,
          parentItemId: null,
        }];
      }
    });
    }
    // Trigger mini highlight animation on clicked product
    setAddedHighlightId(product.id);
    window.setTimeout(() => {
      setAddedHighlightId((current) => (current === product.id ? null : current));
    }, 400);
  };

  const removeItemByItemId = (itemId: string) => {
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

  const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  // Výpočet slevy
  const discountAmount = discount ? 
    (discount.type === 'percentage' ? (totalAmount * discount.value / 100) : discount.value) : 0;
  
  // Finální částka po slevě
  const finalAmount = totalAmount - discountAmount;

  const handleAddProduct = async (name: string, price: number, cost?: number) => {
    if (!user) return;

    try {
      console.log('➕ Adding product:', { name, price, cost, storeId });
      
      const newProduct: Omit<Product, 'id'> = {
        name,
        price,
        cost: typeof cost === 'number' ? cost : 0,
        isPopular: false,
        soldCount: 0, // Výchozí hodnota pro nové produkty
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const docRef = await addDoc(collection(db, 'users', user.uid, 'stores', storeId, 'products'), {
        ...newProduct,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      console.log('✅ Product added with ID:', docRef.id);
      setShowAddProduct(false);
    } catch (error) {
      console.error('❌ Error adding product:', error);
      alert('Chyba při vytváření produktu: ' + error);
    }
  };

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
    <div className="pos-system min-h-screen w-full bg-gray-50 dark:bg-gray-900 p-3 md:p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <h2 className="text-lg md:text-xl lg:text-2xl font-bold text-gray-900 dark:text-white">
          Prodejní systém
        </h2>
        <div className="flex items-center space-x-2 md:space-x-3">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
            onClick={() => setShowMenu(!showMenu)}
            className="bg-gray-600 text-white px-2 md:px-3 lg:px-4 py-2 rounded-lg font-medium hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200 flex items-center text-xs md:text-sm lg:text-base"
          >
            <svg className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span className="hidden sm:inline">Menu</span>
        </motion.button>
        </div>
      </div>

      {/* Menu dropdown - responzivní pozice */}
      {showMenu && (
        <div className="absolute top-16 md:top-20 right-2 md:right-4 lg:right-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl z-50 min-w-40 md:min-w-48 max-w-xs">
          <div className="p-2">
            <button
              onClick={() => {
                setShowAddProduct(true);
                setShowMenu(false);
              }}
              className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
            >
              <Plus className="h-3 w-3 md:h-4 md:w-4 mr-2 md:mr-3 text-blue-500 flex-shrink-0" />
              <span className="truncate">Nový produkt</span>
            </button>
            <button
              onClick={() => {
                setShowExtrasManager(true);
                setShowMenu(false);
              }}
              className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
            >
              <ListPlus className="h-3 w-3 md:h-4 md:w-4 mr-2 md:mr-3 text-green-600 flex-shrink-0" />
              <span className="truncate">Přidat extras</span>
            </button>
            <button
              onClick={() => {
                setShowProductEditor(true);
                setShowMenu(false);
              }}
              className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
            >
              <Package className="h-3 w-3 md:h-4 md:w-4 mr-2 md:mr-3 text-purple-500 flex-shrink-0" />
              <span className="truncate">Editor</span>
            </button>
            <button
              onClick={() => {
                setShowDiscountModal(true);
                setShowMenu(false);
              }}
              className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
            >
              <svg className="h-3 w-3 md:h-4 md:w-4 mr-2 md:mr-3 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
              <span className="truncate">Sleva</span>
            </button>
            <button
              onClick={activateReturnMode}
              className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
            >
              <svg className="h-3 w-3 md:h-4 md:w-4 mr-2 md:mr-3 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span className="truncate">Vratka</span>
            </button>
            {cart.length > 0 && (
              <button
                onClick={savePendingPurchase}
                className="w-full text-left px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center text-sm"
              >
                <svg className="h-3 w-3 md:h-4 md:w-4 mr-2 md:mr-3 text-orange-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="truncate">Odložit nákup</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4 lg:gap-6">
        {/* Right Column - Cart (na mobilu nahoře, na desktopu vpravo) */}
        <div className="lg:order-2 space-y-3 md:space-y-4">
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
                    <div key={item.itemId || item.productId} className="p-2.5 md:p-3 bg-gray-50 dark:bg-gray-700 rounded-lg overflow-hidden">
                      <div className="space-y-2 min-w-0">
                        <h4 className="font-medium text-gray-900 dark:text-gray-100 text-sm md:text-base leading-tight min-w-0 break-words">
                          {item.productName}
                        </h4>
                        <div className="flex items-center justify-between w-full min-w-0">
                          <span className="text-xs md:text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap leading-none m-0 flex-shrink-0">
                            {item.price} Kč × {item.quantity} ks
                          </span>
                          <div className="flex items-center gap-2 mx-3 flex-shrink-0 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => item.itemId && updateQuantity(item.itemId, item.quantity - 1)}
                                className="w-6 h-6 flex-shrink-0 rounded-full bg-rose-100 dark:bg-rose-900/25 text-rose-600 dark:text-rose-300 inline-flex items-center justify-center hover:bg-rose-200 dark:hover:bg-rose-900/40 transition-colors text-xs font-semibold leading-none"
                              >
                                -
                              </button>
                              <span className="w-5 text-center font-medium text-gray-900 dark:text-white text-xs whitespace-nowrap leading-none">
                                {item.quantity}
                              </span>
                              <button
                                onClick={() => item.itemId && updateQuantity(item.itemId, item.quantity + 1)}
                                className="w-6 h-6 flex-shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-900/25 text-emerald-600 dark:text-emerald-300 inline-flex items-center justify-center hover:bg-emerald-200 dark:hover:bg-emerald-900/40 transition-colors text-xs font-semibold leading-none"
                              >
                                +
                              </button>
                            </div>
                            {!isReturnMode && (
                              <button
                                onClick={() => item.itemId && openSelectExtrasForItem(item.itemId)}
                                className="h-6 px-2 rounded-md text-[11px] leading-none bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/40 inline-flex items-center justify-center whitespace-nowrap flex-shrink-0"
                              >
                                Extra
                              </button>
                            )}
                            <div className="text-right min-w-[78px] h-6 inline-flex items-center justify-end">
                              <span className={`font-semibold text-xs md:text-sm whitespace-nowrap leading-none m-0 ${
                                item.quantity < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'
                              }`}>
                                {item.price * item.quantity} Kč
                              </span>
                            </div>
                          </div>
                        </div>
                        {item.quantity < 0 && (
                          <p className="text-xs text-red-500 whitespace-nowrap leading-none m-0">Vratka</p>
                        )}
                      </div>
                      {children.length > 0 && (
                        <div className="mt-2 pl-3 border-l border-gray-300 dark:border-gray-600 space-y-1.5 min-w-0">
                          {children.map(ch => (
                            <div key={ch.itemId || `${item.itemId}-${ch.productId}`}
                              className="flex items-center justify-between gap-2 text-xs md:text-sm text-gray-800 dark:text-gray-200 min-w-0">
                              <div className="flex flex-col items-start gap-0.5 flex-1 min-w-0">
                                <span className="min-w-0 w-full whitespace-nowrap">
                                  + {ch.productName}
                                </span>
                                <span className="whitespace-nowrap text-gray-700 dark:text-gray-300 leading-none">
                                  {ch.price} Kč × {ch.quantity}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 md:gap-1.5 flex-shrink-0 whitespace-nowrap">
                                <button onClick={() => ch.itemId && updateQuantity(ch.itemId, ch.quantity - 1)}
                                  className="w-6 h-6 flex-shrink-0 rounded-full bg-rose-100 dark:bg-rose-900/25 text-rose-600 dark:text-rose-300 inline-flex items-center justify-center text-xs font-semibold leading-none hover:bg-rose-200 dark:hover:bg-rose-900/40 transition-colors">
                                  -
                                </button>
                                <span className="w-5 text-center whitespace-nowrap leading-none">{ch.quantity}</span>
                                <button onClick={() => ch.itemId && updateQuantity(ch.itemId, ch.quantity + 1)}
                                  className="w-6 h-6 flex-shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-900/25 text-emerald-600 dark:text-emerald-300 inline-flex items-center justify-center text-xs font-semibold leading-none hover:bg-emerald-200 dark:hover:bg-emerald-900/40 transition-colors">
                                  +
                                </button>
                                <span className="min-w-[52px] md:min-w-[56px] text-right font-medium whitespace-nowrap leading-none">
                                  {ch.price * ch.quantity} Kč
                                </span>
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
                    onClick={() => setShowAllProducts(false)}
                    className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
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
                        const isHighlighted = addedHighlightId === product.id;
                        return (
                          <motion.button
                            key={product.id}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onPointerUp={() => {
                              addToCart(product);
                              // nech vyhledávač otevřený; zavře se kliknutím mimo
                            }}
                            className={`w-full p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-all duration-200 text-left group touch-target ${isHighlighted ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-800' : ''}`}
                        >
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

          {/* Top 20 Nejprodávanějších */}
          {topSellingProducts.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Nejprodávanější
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {topSellingProducts.map((product) => {
                  const isHighlighted = addedHighlightId === product.id;
                  return (
                    <motion.button
                      key={product.id}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onPointerUp={() => addToCart(product)}
                      className={`bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600 transition-all duration-200 text-left touch-target ${isHighlighted ? 'ring-2 ring-purple-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-800' : ''}`}
                    >
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
        {showAddProduct && (
          <AddProductModal
            onClose={() => setShowAddProduct(false)}
            onAdd={handleAddProduct}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showExtrasManager && (
          <ExtrasManagerModal
            storeId={storeId}
            onClose={() => setShowExtrasManager(false)}
          />
        )}
      </AnimatePresence>

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
              setCart([]);
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
        {showSelectExtras && extrasParentItemId && (
          <SelectExtrasModal
            storeId={storeId}
            onClose={() => { setShowSelectExtras(false); setExtrasParentItemId(null); }}
            onSelect={handleSelectExtras}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
