'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Receipt, Calendar, Eye, DollarSign, CreditCard, QrCode, Trash2, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Sale, Store } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, increment } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { generateReceiptPdfBlob } from '@/lib/pdfGenerator';

interface ReceiptsViewProps {
  storeId: string;
}

export const ReceiptsView: React.FC<ReceiptsViewProps> = ({ storeId }) => {
  const ITEMS_PER_PAGE = 10;
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [store, setStore] = useState<Store | null>(null);
  const [generatingPdfForSaleId, setGeneratingPdfForSaleId] = useState<string | null>(null);
  const [sharingPdfForSaleId, setSharingPdfForSaleId] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !storeId) return;

    const salesRef = collection(db, 'users', user.uid, 'stores', storeId, 'sales');
    const q = query(salesRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const salesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sale[];
      
      setSales(salesData);
      setLoading(false);
    });

    return unsubscribe;
  }, [user, storeId]);

  useEffect(() => {
    if (!user || !storeId) return;
    const storeRef = doc(db, 'users', user.uid, 'stores', storeId);
    const unsubscribe = onSnapshot(storeRef, (snapshot) => {
      if (!snapshot.exists()) {
        setStore(null);
        return;
      }
      setStore({ id: snapshot.id, ...snapshot.data() } as Store);
    });
    return unsubscribe;
  }, [user, storeId]);

  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    
    const dateObj = date instanceof Date ? date : date.toDate();
    return new Intl.DateTimeFormat('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dateObj);
  };

  const getPaymentIcon = (method: Sale['paymentMethod']) => {
    switch (method) {
      case 'cash':
        return <DollarSign className="h-4 w-4" />;
      case 'card':
        return <CreditCard className="h-4 w-4" />;
      case 'qr':
        return <QrCode className="h-4 w-4" />;
      default:
        return <CreditCard className="h-4 w-4" />;
    }
  };

  const getPaymentLabel = (method: Sale['paymentMethod']) => {
    switch (method) {
      case 'cash':
        return 'Hotovost';
      case 'card':
        return 'Karta'; // Zahrnuje i SumUp platby
      case 'qr':
        return 'QR kód';
      default:
        return 'Neznámé';
    }
  };

  const getPaymentColor = (method: Sale['paymentMethod']) => {
    switch (method) {
      case 'cash':
        return 'text-green-600 dark:text-green-400';
      case 'card':
        return 'text-purple-600 dark:text-purple-400'; // Zahrnuje i SumUp platby
      case 'qr':
        return 'text-blue-600 dark:text-blue-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const filteredSales = sales.filter((sale) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const docId = (sale.documentId || '').toString().toLowerCase();
    const vs = ((sale as any).variableSymbol || '').toString().toLowerCase();
    const id = (sale.id || '').toString().toLowerCase();
    return docId.includes(q) || vs.includes(q) || id.includes(q);
  });

  const totalPages = Math.ceil(filteredSales.length / ITEMS_PER_PAGE);
  const paginatedSales = filteredSales.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    if (totalPages === 0 && currentPage !== 1) {
      setCurrentPage(1);
      return;
    }
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleDeleteSale = async (sale: Sale) => {
    if (!user || !storeId) return;

    setDeleting(true);
    try {
      // Smaž doklad z databáze
      const saleRef = doc(db, 'users', user.uid, 'stores', storeId, 'sales', sale.id);
      await deleteDoc(saleRef);

      // Aktualizuj počet prodaných kusů pro každý produkt (vrátit zpět)
      for (const item of sale.items) {
        const productRef = doc(db, 'users', user.uid, 'stores', storeId, 'products', item.productId);
        await updateDoc(productRef, {
          soldCount: increment(-item.quantity), // Odečti prodané množství
        });
      }

      console.log('✅ Doklad úspěšně smazán:', sale.id);
    } catch (error) {
      console.error('❌ Chyba při mazání dokladu:', error);
      alert('Chyba při mazání dokladu. Zkuste to znovu.');
    } finally {
      setDeleting(false);
      setSaleToDelete(null);
    }
  };

  const handleOpenReceiptPdf = async (sale: Sale) => {
    if (generatingPdfForSaleId) return;
    setGeneratingPdfForSaleId(sale.id);
    try {
      const pdfBlob = await generateReceiptPdfBlob(sale, {
        companyName: store?.companyName,
        ico: store?.ico,
        companyAddress: store?.companyAddress,
      });

      const objectUrl = URL.createObjectURL(pdfBlob);
      const openedWindow = window.open(objectUrl, '_blank', 'noopener,noreferrer');
      if (!openedWindow) {
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `doklad-${sale.documentId || sale.id}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      console.error('❌ Chyba při generování PDF dokladu:', error);
      alert('Nepodařilo se vygenerovat PDF doklad. Zkuste to prosím znovu.');
    } finally {
      setGeneratingPdfForSaleId(null);
    }
  };

  const handleShareReceiptPdf = async (sale: Sale) => {
    if (sharingPdfForSaleId) return;
    setSharingPdfForSaleId(sale.id);
    try {
      const pdfBlob = await generateReceiptPdfBlob(sale, {
        companyName: store?.companyName,
        ico: store?.ico,
        companyAddress: store?.companyAddress,
      });

      const file = new File([pdfBlob], `doklad-${sale.documentId || sale.id}.pdf`, {
        type: 'application/pdf',
      });

      const nav = window.navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
      };
      const canShareFiles = typeof nav.canShare === 'function' && nav.canShare({ files: [file] });

      if (canShareFiles) {
        await nav.share({
          files: [file],
          title: 'Uctenka',
        });
        return;
      }

      await handleOpenReceiptPdf(sale);
    } catch (error) {
      const errorName = (error as { name?: string })?.name;
      if (errorName === 'AbortError') {
        return;
      }
      console.error('❌ Chyba při sdílení PDF dokladu:', error);
      await handleOpenReceiptPdf(sale);
    } finally {
      setSharingPdfForSaleId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Doklady
        </h2>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Celkem: {filteredSales.length} dokladů
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCurrentPage(1);
          }}
          placeholder="Hledat podle ID nebo čísla dokladu…"
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        />
      </div>

      {filteredSales.length === 0 ? (
        <div className="text-center py-12">
          <Receipt className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {sales.length === 0 ? 'Zatím nejsou žádné doklady' : 'Nenalezeny žádné doklady'}
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            {sales.length === 0 ? 'Po prvním prodeji se zde zobrazí doklady' : 'Zkuste upravit hledaný výraz'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence>
            {paginatedSales.map((sale, index) => (
              <motion.div
                key={sale.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 hover:shadow-xl transition-all duration-200"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <Receipt className="h-5 w-5 text-purple-600 mr-2" />
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      {sale.documentId || `#${sale.id.slice(-8)}`}
                    </span>
                  </div>
                  <div className="flex items-center text-sm text-gray-700 dark:text-gray-300">
                    <div className={getPaymentColor(sale.paymentMethod)}>
                      {getPaymentIcon(sale.paymentMethod)}
                    </div>
                    <span className="ml-1">{getPaymentLabel(sale.paymentMethod)}</span>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex items-center text-sm text-gray-700 dark:text-gray-300 mb-2">
                    <Calendar className="h-4 w-4 mr-2" />
                    {formatDate(sale.createdAt)}
                  </div>
                  {sale.customerName && (
                    <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                      <span className="text-gray-500 dark:text-gray-400 mr-2">Jméno:</span>
                      <span className="font-medium">{sale.customerName}</span>
                    </div>
                  )}
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {sale.currency === 'EUR' ? 
                      `${sale.totalAmount.toFixed(2)} €` : 
                      `${sale.totalAmount} Kč`
                    }
                    {sale.currency === 'EUR' && sale.originalAmountCZK && (
                      <span className="text-sm text-gray-500 ml-2">
                        ({sale.originalAmountCZK} Kč)
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {sale.items.length} položek
                  </div>
                  {sale.paymentMethod === 'card' && sale.sumUpData?.sumUpTxCode && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      <span className="text-gray-400 mr-1">SumUp:</span>
                      <span className="font-mono">{sale.sumUpData.sumUpTxCode}</span>
                    </div>
                  )}
                </div>

                <div className="flex space-x-2">
                  <button
                    onClick={() => handleOpenReceiptPdf(sale)}
                    disabled={generatingPdfForSaleId === sale.id || sharingPdfForSaleId === sale.id}
                    className="flex-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 py-2 px-3 rounded-lg font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {generatingPdfForSaleId === sale.id ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 dark:border-blue-400 mr-2"></div>
                        Generuji...
                      </>
                    ) : (
                      <>Doklad</>
                    )}
                  </button>
                  <button
                    onClick={() => handleShareReceiptPdf(sale)}
                    disabled={sharingPdfForSaleId === sale.id || generatingPdfForSaleId === sale.id}
                    className="flex-1 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 py-2 px-3 rounded-lg font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {sharingPdfForSaleId === sale.id ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600 dark:border-indigo-400 mr-2"></div>
                        Připravuji...
                      </>
                    ) : (
                      <>Tisk</>
                    )}
                  </button>
                  <button
                    onClick={() => setSelectedSale(sale)}
                    className="flex-1 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 py-2 px-4 rounded-lg font-medium hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors flex items-center justify-center"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Detail
                  </button>
                  <button
                    onClick={() => setSaleToDelete(sale)}
                    className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 py-2 px-4 rounded-lg font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors flex items-center justify-center"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center mt-6">
          <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-2 shadow-sm">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors flex items-center"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Předchozí
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`min-w-[2.25rem] h-9 px-3 rounded-lg text-sm font-medium transition-colors ${
                  currentPage === page
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {page}
              </button>
            ))}

            <button
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors flex items-center"
            >
              Další
              <ChevronRight className="h-4 w-4 ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* Sale Detail Modal */}
      <AnimatePresence>
        {selectedSale && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedSale(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold text-white">
                    Detail dokladu
                  </h3>
                  <button
                    onClick={() => setSelectedSale(null)}
                    className="text-white hover:text-gray-200 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Datum:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatDate(selectedSale.createdAt)}</span>
                  </div>
                  {selectedSale.customerName && (
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 dark:text-gray-400">Jméno:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{selectedSale.customerName}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">Způsob platby:</span>
                    <span className="font-medium text-gray-900 dark:text-white">{getPaymentLabel(selectedSale.paymentMethod)}</span>
                  </div>
                  {selectedSale.paymentMethod === 'card' && selectedSale.sumUpData?.sumUpTxCode && (
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 dark:text-gray-400">SumUp kód:</span>
                      <span className="font-mono text-sm text-gray-900 dark:text-white">{selectedSale.sumUpData.sumUpTxCode}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <h4 className="font-medium text-gray-900 dark:text-white mb-3">Položky:</h4>
                    <div className="space-y-2">
                      {(selectedSale.items as any[]).filter(i => !i.parentItemId).map((item: any, index: number) => {
                        const children = (selectedSale.items as any[]).filter(c => c.parentItemId === item.itemId);
                        return (
                          <div key={index}>
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-700 dark:text-gray-300">
                                {item.productName} × {item.quantity}
                              </span>
                              <span className="font-medium text-gray-900 dark:text-white">
                                {item.price * item.quantity} Kč
                              </span>
                            </div>
                            {children.length > 0 && (
                              <div className="mt-1 pl-3 border-l border-gray-300 dark:border-gray-600 space-y-1">
                                {children.map((ch, cidx) => (
                                  <div key={cidx} className="flex justify-between items-center text-xs">
                                    <span className="text-gray-600 dark:text-gray-400">+ {ch.productName} × {ch.quantity}</span>
                                    <span className="text-gray-700 dark:text-gray-300">{ch.price * ch.quantity} Kč</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <div className="flex justify-between items-center text-lg font-bold text-gray-900 dark:text-white">
                      <span>Celkem:</span>
                      <span>
                        {selectedSale.currency === 'EUR' ? 
                          `${selectedSale.totalAmount.toFixed(2)} €` : 
                          `${selectedSale.totalAmount} Kč`
                        }
                        {selectedSale.currency === 'EUR' && selectedSale.originalAmountCZK && (
                          <span className="text-sm text-gray-500 ml-2">
                            ({selectedSale.originalAmountCZK} Kč)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleOpenReceiptPdf(selectedSale)}
                        disabled={generatingPdfForSaleId === selectedSale.id || sharingPdfForSaleId === selectedSale.id}
                        className="w-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 py-2.5 px-4 rounded-lg font-medium hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {generatingPdfForSaleId === selectedSale.id ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 dark:border-blue-400 mr-2"></div>
                            Generuji...
                          </>
                        ) : (
                          <>Doklad</>
                        )}
                      </button>
                      <button
                        onClick={() => handleShareReceiptPdf(selectedSale)}
                        disabled={sharingPdfForSaleId === selectedSale.id || generatingPdfForSaleId === selectedSale.id}
                        className="w-full bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 py-2.5 px-4 rounded-lg font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {sharingPdfForSaleId === selectedSale.id ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600 dark:border-indigo-400 mr-2"></div>
                            Připravuji...
                          </>
                        ) : (
                          <>Tisk</>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {saleToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
            onClick={() => setSaleToDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-gradient-to-r from-red-600 to-red-700 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <AlertTriangle className="h-6 w-6 text-white mr-3" />
                    <h3 className="text-xl font-semibold text-white">
                      Smazat doklad
                    </h3>
                  </div>
                  <button
                    onClick={() => setSaleToDelete(null)}
                    className="text-white hover:text-gray-200 transition-colors"
                    disabled={deleting}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mr-3" />
                    <div className="text-sm text-red-700 dark:text-red-300">
                      <strong>Pozor!</strong> Tato akce je nevratná. Doklad bude trvale smazán z databáze.
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 dark:text-gray-400">Datum:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{formatDate(saleToDelete.createdAt)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 dark:text-gray-400">Částka:</span>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {saleToDelete.currency === 'EUR' ? 
                          `${saleToDelete.totalAmount.toFixed(2)} €` : 
                          `${saleToDelete.totalAmount.toLocaleString('cs-CZ')} Kč`
                        }
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 dark:text-gray-400">Položky:</span>
                      <span className="font-medium text-gray-900 dark:text-white">{saleToDelete.items.length}</span>
                    </div>
                  </div>

                  <div className="flex space-x-3 pt-4">
                    <button
                      onClick={() => setSaleToDelete(null)}
                      disabled={deleting}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50"
                    >
                      Zrušit
                    </button>
                    <button
                      onClick={() => handleDeleteSale(saleToDelete)}
                      disabled={deleting}
                      className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center"
                    >
                      {deleting ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Mazání...
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4 mr-2" />
                          Smazat
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
