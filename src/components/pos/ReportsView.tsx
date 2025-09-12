'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Sale, Product } from '@/types';
import { motion } from 'framer-motion';
import { FileText, Calendar, TrendingUp, DollarSign, Users, CreditCard, Banknote, Mail, BarChart3, Euro, Calculator } from 'lucide-react';
import { generateEmailContent } from '@/lib/email';

// Rozšířený User interface s prodejnami
interface ExtendedUser {
  uid: string;
  email: string;
  displayName?: string | null;
  createdAt: Date;
  settings: {
    eurRate: number;
    theme: 'light' | 'dark' | 'auto';
  };
  stores?: Array<{
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    isActive: boolean;
  }>;
}

interface ReportsViewProps {
  storeId: string;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ storeId }) => {
  const { user, firebaseUser } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<'day' | 'month' | 'total'>('day');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showActionNameModal, setShowActionNameModal] = useState(false);
  const [actionName, setActionName] = useState('');

  // Cast user na ExtendedUser
  const extendedUser = user as ExtendedUser | null;

  useEffect(() => {
    if (!user || !storeId) return;

    const salesQuery = query(
      collection(db, 'users', user.uid, 'stores', storeId, 'sales'),
      orderBy('createdAt', 'desc')
    );

    const productsQuery = query(
      collection(db, 'users', user.uid, 'stores', storeId, 'products')
    );

    const unsubscribeSales = onSnapshot(salesQuery, (snapshot) => {
      const salesData: Sale[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        salesData.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
        } as Sale);
      });
      setSales(salesData);
    });

    const unsubscribeProducts = onSnapshot(productsQuery, (snapshot) => {
      const productsData: Product[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        productsData.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        } as Product);
      });
      setProducts(productsData);
      setLoading(false);
    });

    return () => {
      unsubscribeSales();
      unsubscribeProducts();
    };
  }, [user, storeId]);

  const getFilteredSales = () => {
    if (selectedPeriod === 'day') {
      const start = startOfDay(selectedDate);
      const end = endOfDay(selectedDate);
      return sales.filter(sale => isWithinInterval(sale.createdAt, { start, end }));
    } else if (selectedPeriod === 'month') {
      const start = startOfMonth(selectedDate);
      const end = endOfMonth(selectedDate);
      return sales.filter(sale => isWithinInterval(sale.createdAt, { start, end }));
    } else {
      return sales; // 'total' period
    }
  };

  const getReportData = () => {
    const filteredSales = getFilteredSales();
    const eurRate = extendedUser?.settings?.eurRate || 25.0;
    
    // Výpočet tržeb podle měn
    let totalSalesCZK = 0; // Celková tržba přepočtená na koruny
    let salesInCZK = 0; // Tržby v korunách (odečtené vrácené koruny)
    let salesInEUR = 0; // Skutečně vybrané eura (včetně vrácených)
    
    filteredSales.forEach(sale => {
      if (sale.currency === 'EUR' && sale.eurRate) {
        // Prodej v eurech
        const amountInCZK = sale.totalAmount * sale.eurRate;
        totalSalesCZK += amountInCZK;
        
        // Přidej skutečně vybrané eura (zaplacená částka v eurech)
        if (sale.paidAmount && sale.paidCurrency === 'EUR') {
          salesInEUR += sale.paidAmount;
        } else {
          // Fallback - pokud nejsou uloženy informace o platbě
          salesInEUR += sale.totalAmount;
        }
        
        // Odečti vrácené koruny (pokud byly vráceny)
        if (sale.changeAmount && sale.changeAmount > 0) {
          salesInCZK -= sale.changeAmount; // Odečti vrácené koruny
        }
      } else {
        // Prodej v korunách
        totalSalesCZK += sale.totalAmount;
        salesInCZK += sale.totalAmount;
      }
    });
    
    const cashSales = filteredSales
      .filter(sale => sale.paymentMethod === 'cash')
      .reduce((sum, sale) => {
        if (sale.currency === 'EUR' && sale.eurRate) {
          return sum + (sale.totalAmount * sale.eurRate);
        }
        return sum + sale.totalAmount;
      }, 0);
    const cardSales = filteredSales
      .filter(sale => sale.paymentMethod === 'card')
      .reduce((sum, sale) => {
        if (sale.currency === 'EUR' && sale.eurRate) {
          return sum + (sale.totalAmount * sale.eurRate);
        }
        return sum + sale.totalAmount;
      }, 0);
    const customerCount = filteredSales.length;

    // Výpočet celkových nákladů a zisku
    let totalCosts = 0;
    let totalProfit = 0;

    // Vytvoření mapy produktů pro rychlé vyhledávání
    const productMap = new Map(products.map(p => [p.id, p]));

    filteredSales.forEach(sale => {
      sale.items?.forEach(item => {
        const product = productMap.get(item.productId);
        if (product && product.cost !== undefined) {
          const itemCost = product.cost * item.quantity;
          totalCosts += itemCost;
        }
      });
    });

    totalProfit = totalSalesCZK - totalCosts;

    return {
      totalSales: totalSalesCZK, // Celková tržba v korunách
      salesInCZK, // Tržby v korunách (odečtené vrácené koruny)
      salesInEUR, // Skutečně vybrané eura
      cashSales,
      cardSales,
      customerCount,
      totalCosts, // Celkové náklady
      totalProfit, // Celkový zisk
      sales: filteredSales,
    };
  };

  const generatePDFReport = async (customActionName?: string) => {
    if (!user || !firebaseUser) {
      alert('Pro generování uzávěrky musíte být přihlášeni');
      return;
    }

    setGeneratingPDF(true);
    try {
      // Generování uzávěrky lokálně v prohlížeči
      console.log('🔍 Generating report locally...');
      
      // Získej filtrované prodeje
      const filteredSales = getFilteredSales();
      
      if (filteredSales.length === 0) {
        alert('Pro generování uzávěrky potřebujete mít alespoň jeden prodej v vybraném období.');
        return;
      }
      
      // Vytvoř report data
      const reportData = getReportData();
      const reportDataForPDF = {
        storeName: extendedUser?.stores?.find(s => s.id === storeId)?.name || 'Neznámá prodejna',
        period: selectedPeriod === 'day' ? 'Denní' : selectedPeriod === 'month' ? 'Měsíční' : 'Celková',
        startDate: selectedPeriod === 'day' 
          ? format(selectedDate, 'd.M.yyyy', { locale: cs })
          : selectedPeriod === 'month' 
            ? format(selectedDate, 'MMMM yyyy', { locale: cs })
            : extendedUser?.stores?.find(s => s.id === storeId)?.createdAt 
              ? format(extendedUser.stores.find(s => s.id === storeId)!.createdAt, 'd.M.yyyy', { locale: cs })
              : 'Od založení',
        endDate: selectedPeriod === 'day' 
          ? format(selectedDate, 'd.M.yyyy', { locale: cs })
          : selectedPeriod === 'month' 
            ? format(selectedDate, 'MMMM yyyy', { locale: cs })
            : format(new Date(), 'd.M.yyyy', { locale: cs }),
        totalSales: reportData.totalSales,
        salesInCZK: reportData.salesInCZK,
        salesInEUR: reportData.salesInEUR,
        cashSales: reportData.cashSales,
        cardSales: reportData.cardSales,
        customerCount: reportData.customerCount,
        totalCosts: reportData.totalCosts,
        totalProfit: reportData.totalProfit,
        products: products.map(p => ({
          id: p.id,
          name: p.name,
          price: p.price,
          cost: p.cost
        })),
        sales: reportData.sales
      };

      console.log('✅ Report data prepared:', reportDataForPDF);

      // Generování HTML uzávěrky
      const htmlContent = generateReportHTML(reportDataForPDF);
      
      // Odešli email uzávěrky přes SMTP
      await sendReportEmail(reportDataForPDF, user.email || '', customActionName);

      alert('Uzávěrka byla úspěšně vygenerována a odeslána na váš email!');
      
    } catch (error: unknown) {
      console.error('❌ Error generating report:', error);
      
      let errorMessage = 'Neznámá chyba';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      alert('Chyba při generování uzávěrky: ' + errorMessage);
    } finally {
      setGeneratingPDF(false);
    }
  };

  // Odeslání emailu uzávěrky přes SMTP
  const sendReportEmail = async (reportData: {
    storeName: string;
    period: string;
    startDate: string;
    endDate: string;
    totalSales: number;
    salesInCZK: number;
    salesInEUR: number;
    cashSales: number;
    cardSales: number;
    customerCount: number;
    totalCosts: number;
    totalProfit: number;
    products: Array<{
      id: string;
      name: string;
      price: number;
      cost?: number;
    }>;
    sales: Sale[];
  }, userEmail: string, customActionName?: string) => {
    try {
      console.log('📧 Sending email to:', userEmail);
      
      // Vytvoření email obsahu pomocí nové funkce
      const emailContent = generateEmailContent(reportData, customActionName);
      const actionNameText = customActionName ? ` - ${customActionName}` : '';
      const emailSubject = `${reportData.period} uzávěrka${actionNameText} - ${reportData.storeName}`;
      
      // Odeslání emailu přes API endpoint (který používá SMTP)
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: userEmail,
          subject: emailSubject,
          html: emailContent.html,
          text: emailContent.text
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Email sent successfully via SMTP:', result);
      
    } catch (error) {
      console.error('❌ Error sending email via SMTP:', error);
      
      // Fallback: otevři email klienta s předvyplněnými daty
      const actionNameText = customActionName ? ` - ${customActionName}` : '';
      const emailSubject = `${reportData.period} uzávěrka${actionNameText} - ${reportData.storeName}`;
      const emailContent = generateEmailContent(reportData, customActionName);
      const mailtoLink = `mailto:${userEmail}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailContent.text)}`;
      
      console.log('📧 Fallback: opening email client');
      window.open(mailtoLink);
      
      throw new Error(`Chyba při odesílání emailu přes SMTP: ${error instanceof Error ? error.message : 'Neznámá chyba'}`);
    }
  };

  const handleActionNameSubmit = () => {
    generatePDFReport(actionName.trim() || undefined);
    setShowActionNameModal(false);
    setActionName('');
  };

  const handleActionNameCancel = () => {
    setShowActionNameModal(false);
    setActionName('');
  };

  // Generování HTML obsahu uzávěrky
  const generateReportHTML = (reportData: {
    storeName: string;
    period: string;
    startDate: string;
    endDate: string;
    totalSales: number;
    salesInCZK: number;
    salesInEUR: number;
    cashSales: number;
    cardSales: number;
    customerCount: number;
    totalCosts: number;
    totalProfit: number;
    products: Array<{
      id: string;
      name: string;
      price: number;
      cost?: number;
    }>;
    sales: Sale[];
  }) => {
    // Vytvoření mapy produktů pro rychlé vyhledávání nákladů
    const productMap = new Map(reportData.products.map(p => [p.id, p]));
    
    // Agregace všech prodaných položek s výpočtem zisku
    const productSummary = new Map<string, { 
      quantity: number; 
      totalPrice: number; 
      price: number; 
      totalCost: number; 
      totalProfit: number; 
    }>();
    
    reportData.sales.forEach((sale) => {
      sale.items?.forEach((item) => {
        const key = item.productName;
        const product = productMap.get(item.productId);
        const itemCost = product?.cost || 0;
        const itemProfit = (item.price - itemCost) * item.quantity;
        
        const existing = productSummary.get(key);
        
        if (existing) {
          existing.quantity += item.quantity;
          existing.totalPrice += item.quantity * item.price;
          existing.totalCost += itemCost * item.quantity;
          existing.totalProfit += itemProfit;
        } else {
          productSummary.set(key, {
            quantity: item.quantity,
            totalPrice: item.quantity * item.price,
            price: item.price,
            totalCost: itemCost * item.quantity,
            totalProfit: itemProfit
          });
        }
      });
    });

    // Vytvoření řádků pro souhrn položek
    const productSummaryRows = Array.from(productSummary.entries())
      .sort((a, b) => b[1].totalPrice - a[1].totalPrice) // Seřadit podle celkové hodnoty (sestupně)
      .map(([productName, summary]) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: bold;">${summary.quantity}x ${productName}</td>
          <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">${summary.price.toLocaleString('cs-CZ')} Kč</td>
          <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: bold; color: #28a745;">${summary.totalPrice.toLocaleString('cs-CZ')} Kč</td>
          <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: bold;">${summary.totalProfit.toLocaleString('cs-CZ')} Kč</td>
        </tr>
      `).join('');

    return `
      <!DOCTYPE html>
      <html lang="cs">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${reportData.period} uzávěrka - ${reportData.storeName}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .header p { margin: 10px 0 0 0; opacity: 0.9; }
          .content { padding: 20px; }
          .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 15px; margin: 20px 0; }
          .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center; border: 1px solid #e9ecef; }
          .stat-value { font-size: 24px; font-weight: bold; color: #28a745; margin-bottom: 5px; }
          .stat-label { font-size: 14px; color: #666; }
          .cash-value { color: #ffc107; }
          .card-value { color: #6f42c1; }
          .customer-value { color: #007bff; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background: #f8f9fa; padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; color: #495057; font-weight: bold; }
          td { padding: 12px; border-bottom: 1px solid #dee2e6; }
          .summary { background: #e9ecef; padding: 15px; border-radius: 8px; margin: 20px 0; }
          .footer { background: #e9ecef; padding: 20px; text-align: center; color: #6c757d; font-size: 12px; }
          @media print { body { background: white; } .container { box-shadow: none; } }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${reportData.storeName}</h1>
            <p>${selectedPeriod === 'day' 
              ? `Denní uzávěrka z ${reportData.startDate}`
              : selectedPeriod === 'month' 
                ? `Uzávěrka za měsíc ${reportData.startDate}`
                : `Celková uzávěrka od ${reportData.startDate} do ${reportData.endDate}`}</p>
          </div>
          
          <div class="content">
            <h2>📊 Statistiky uzávěrky</h2>
            
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-value">${reportData.totalSales.toLocaleString('cs-CZ')} Kč</div>
                <div class="stat-label">Celková tržba</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-value cash-value">${reportData.salesInCZK.toLocaleString('cs-CZ')} Kč</div>
                <div class="stat-label">Koruny (po vrácení)</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-value card-value">${reportData.salesInEUR.toFixed(2)} €</div>
                <div class="stat-label">Eura (vybrané)</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-value">${reportData.totalProfit.toLocaleString('cs-CZ')} Kč</div>
                <div class="stat-label">Zisk</div>
              </div>
              
              <div class="stat-card">
                <div class="stat-value customer-value">${reportData.customerCount}</div>
                <div class="stat-label">Počet zákazníků</div>
              </div>
            </div>
            
            <h3>📋 Souhrn prodaných položek</h3>
            <table>
              <thead>
                <tr>
                  <th>Položka</th>
                  <th>Cena za kus</th>
                  <th>Celková hodnota</th>
                  <th>Zisk</th>
                </tr>
              </thead>
              <tbody>
                ${productSummaryRows}
              </tbody>
            </table>
            
            <div class="summary">
              <h4>📊 Souhrn tržeb</h4>
              <p><strong>Období:</strong> ${selectedPeriod === 'day' 
                ? `Denní uzávěrka z ${reportData.startDate}`
                : selectedPeriod === 'month' 
                  ? `Uzávěrka za měsíc ${reportData.startDate}`
                  : `Celková uzávěrka od ${reportData.startDate} do ${reportData.endDate}`}</p>
              <p><strong>Celková tržba:</strong> ${reportData.totalSales.toLocaleString('cs-CZ')} Kč</p>
              <p><strong>Koruny (po vrácení):</strong> ${reportData.salesInCZK.toLocaleString('cs-CZ')} Kč</p>
              <p><strong>Eura (vybrané):</strong> ${reportData.salesInEUR.toFixed(2)} €</p>
              <p><strong>Počet různých produktů:</strong> ${productSummary.size}</p>
            </div>
          </div>
          
          <div class="footer">
            <p>Uzávěrka vygenerována automaticky dne ${format(new Date(), 'dd.MM.yyyy', { locale: cs })}<br>
            <strong>Účtárna</strong> - Profesionální prodejní systém</p>
          </div>
        </div>
      </body>
      </html>
    `;
  };


  const formatDate = (date: Date) => {
    if (selectedPeriod === 'day') {
      return format(date, 'EEEE, d. MMMM yyyy', { locale: cs });
    } else if (selectedPeriod === 'month') {
      return format(date, 'MMMM yyyy', { locale: cs });
    } else {
      return 'Od založení obchodu';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  const reportData = getReportData();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
          Přehled a reporty
        </h2>
        <div className="flex space-x-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              if (selectedPeriod === 'day') {
                setShowActionNameModal(true);
              } else {
                generatePDFReport();
              }
            }}
            disabled={generatingPDF || reportData.sales.length === 0}
            className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center"
          >
            {generatingPDF ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Odesílání uzávěrky...
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" />
                Email uzávěrka
              </>
            )}
          </motion.button>
        </div>
      </div>

      {/* Period Selection */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center space-y-3 sm:space-y-0 sm:space-x-4 mb-4">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedPeriod('day')}
              className={`px-3 py-2 sm:px-4 rounded-lg font-medium transition-colors text-sm sm:text-base ${
                selectedPeriod === 'day'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Den
            </button>
            <button
              onClick={() => setSelectedPeriod('month')}
              className={`px-3 py-2 sm:px-4 rounded-lg font-medium transition-colors text-sm sm:text-base ${
                selectedPeriod === 'month'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Měsíc
            </button>
            <button
              onClick={() => setSelectedPeriod('total')}
              className={`px-3 py-2 sm:px-4 rounded-lg font-medium transition-colors text-sm sm:text-base ${
                selectedPeriod === 'total'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Celkem
            </button>
          </div>
          {selectedPeriod !== 'total' && (
            <input
              type="date"
              value={format(selectedDate, 'yyyy-MM-dd')}
              onChange={(e) => setSelectedDate(new Date(e.target.value))}
              className="w-full sm:w-auto px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm sm:text-base"
            />
          )}
        </div>
        <div className="text-lg font-medium text-gray-900 dark:text-white">
          {formatDate(selectedDate)}
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="flex items-center">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mr-4">
              <DollarSign className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Celková tržba
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {reportData.totalSales.toLocaleString('cs-CZ')} Kč
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="flex items-center">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center mr-4">
              <Banknote className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Koruny (po vrácení)
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {reportData.salesInCZK.toLocaleString('cs-CZ')} Kč
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="flex items-center">
            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center mr-4">
              <Euro className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Eura (vybrané)
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {reportData.salesInEUR.toFixed(2)} €
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="flex items-center">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center mr-4">
              <Calculator className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Zisk
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {reportData.totalProfit.toLocaleString('cs-CZ')} Kč
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="flex items-center">
            <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/20 rounded-lg flex items-center justify-center mr-4">
              <Users className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Zákazníci
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {reportData.customerCount}
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Recent Sales */}
      {reportData.sales.length > 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Poslední prodeje
          </h3>
          <div className="space-y-3">
            {reportData.sales.slice(0, 5).map((sale) => (
              <div key={sale.id} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {format(sale.createdAt, 'HH:mm')}
                  </span>
                  <span className="mx-2 text-gray-400">•</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {sale.items.length} položek
                  </span>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {sale.paymentMethod === 'cash' ? 'Hotovost' : 'Karta'}
                  </span>
                  <span className="text-xs text-gray-400">
                    {sale.currency === 'EUR' ? 'EUR' : 'CZK'}
                  </span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {sale.currency === 'EUR' ? 
                      `${sale.totalAmount.toFixed(2)} €` : 
                      `${sale.totalAmount.toLocaleString('cs-CZ')} Kč`
                    }
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-12">
          <BarChart3 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Žádné prodeje pro vybrané období
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Pro generování uzávěrky potřebujete mít alespoň jeden prodej
          </p>
        </div>
      )}

      {/* Action Name Modal */}
      {showActionNameModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4"
          >
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mr-4">
                <FileText className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Název akce
              </h3>
            </div>
            
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Zadejte název akce, který se zobrazí v předmětu a nadpisu emailu. Můžete nechat prázdné.
            </p>
            
            <input
              type="text"
              value={actionName}
              onChange={(e) => setActionName(e.target.value)}
              placeholder="Např. Ranní směna, Večerní uzávěrka..."
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-6"
              autoFocus
            />
            
            <div className="flex space-x-3">
              <button
                onClick={handleActionNameCancel}
                className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Zrušit
              </button>
              <button
                onClick={handleActionNameSubmit}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Generovat uzávěrku
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
