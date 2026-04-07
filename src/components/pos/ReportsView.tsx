'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Sale, Product } from '@/types';
import { motion } from 'framer-motion';
import { FileText, Calendar, TrendingUp, DollarSign, Users, CreditCard, Banknote, Mail, BarChart3, Euro, Calculator, QrCode } from 'lucide-react';
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
  const [selectedPeriod, setSelectedPeriod] = useState<'day' | 'month' | 'total' | 'custom'>('day');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [customStartDate, setCustomStartDate] = useState(new Date());
  const [customEndDate, setCustomEndDate] = useState(new Date());
  const [showActionNameModal, setShowActionNameModal] = useState(false);
  const [actionName, setActionName] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successCountdown, setSuccessCountdown] = useState(5);

  // Cast user na ExtendedUser
  const extendedUser = user as ExtendedUser | null;

  useEffect(() => {
    if (!user || !user.uid || !storeId) return;

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
    } else if (selectedPeriod === 'custom') {
      // Validace intervalu - začátek nesmí být později než konec
      if (customStartDate > customEndDate) {
        return []; // Vrátit prázdný seznam místo pádu
      }
      const start = startOfDay(customStartDate);
      const end = endOfDay(customEndDate);
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
    const qrSales = filteredSales
      .filter(sale => sale.paymentMethod === 'qr')
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

    // Výpočet celkových slev
    const totalDiscounts = filteredSales.reduce((sum, sale) => {
      return sum + (sale.discountAmount || 0);
    }, 0);

    // Počet prodejů se slevou
    const salesWithDiscount = filteredSales.filter(sale => sale.discount && sale.discountAmount && sale.discountAmount > 0).length;

    return {
      totalSales: totalSalesCZK, // Celková tržba v korunách
      salesInCZK, // Tržby v korunách (odečtené vrácené koruny)
      salesInEUR, // Skutečně vybrané eura
      cashSales,
      cardSales,
      qrSales,
      customerCount,
      totalCosts, // Celkové náklady
      totalProfit, // Celkový zisk
      totalDiscounts, // Celkové slevy
      salesWithDiscount, // Počet prodejů se slevou
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
        period: selectedPeriod === 'day' ? 'Denní' : selectedPeriod === 'month' ? 'Měsíční' : selectedPeriod === 'custom' ? 'Vlastní období' : 'Celková',
        startDate: selectedPeriod === 'day' 
          ? format(selectedDate, 'd.M.yyyy', { locale: cs })
          : selectedPeriod === 'month' 
            ? format(selectedDate, 'MMMM yyyy', { locale: cs })
            : selectedPeriod === 'custom'
              ? format(customStartDate, 'd.M.yyyy', { locale: cs })
            : extendedUser?.stores?.find(s => s.id === storeId)?.createdAt 
              ? format(extendedUser.stores.find(s => s.id === storeId)!.createdAt, 'd.M.yyyy', { locale: cs })
              : 'Od založení',
        endDate: selectedPeriod === 'day' 
          ? format(selectedDate, 'd.M.yyyy', { locale: cs })
          : selectedPeriod === 'month' 
            ? format(selectedDate, 'MMMM yyyy', { locale: cs })
            : selectedPeriod === 'custom'
              ? format(customEndDate, 'd.M.yyyy', { locale: cs })
            : format(new Date(), 'd.M.yyyy', { locale: cs }),
        totalSales: reportData.totalSales,
        salesInCZK: reportData.salesInCZK,
        salesInEUR: reportData.salesInEUR,
        cashSales: reportData.cashSales,
        cardSales: reportData.cardSales,
        qrSales: reportData.qrSales,
        customerCount: reportData.customerCount,
        totalCosts: reportData.totalCosts,
        totalProfit: reportData.totalProfit,
        totalDiscounts: reportData.totalDiscounts,
        salesWithDiscount: reportData.salesWithDiscount,
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

      // Zobraz potvrzovací modal s odpočtem a automatickým zavřením
      setShowSuccessModal(true);
      setSuccessCountdown(5);
      const intervalId = setInterval(() => {
        setSuccessCountdown(prev => {
          if (prev <= 1) {
            clearInterval(intervalId);
            setShowSuccessModal(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
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
    qrSales: number;
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
    const trimmedActionName = actionName.trim();
    if (selectedPeriod === 'custom') {
      generatePDFReport(trimmedActionName || 'vlastni obdobi uzaverka');
    } else {
      generatePDFReport(trimmedActionName || undefined);
    }
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
    qrSales: number;
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
    } else if (selectedPeriod === 'custom') {
      if (customStartDate > customEndDate) {
        return 'Neplatný interval';
      }
      return `${format(customStartDate, 'd.M.yyyy', { locale: cs })} - ${format(customEndDate, 'd.M.yyyy', { locale: cs })}`;
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
  const productMap = new Map(products.map((product) => [product.id, product]));
  const soldProductsSummary = Array.from(
    reportData.sales.reduce((acc, sale) => {
      sale.items?.forEach((item) => {
        const key = item.productId || item.productName;
        const product = productMap.get(item.productId);
        const unitCost = product?.cost || 0;
        const revenue = item.price * item.quantity;
        const costs = unitCost * item.quantity;
        const profit = revenue - costs;

        const existing = acc.get(key);
        if (existing) {
          existing.quantity += item.quantity;
          existing.revenue += revenue;
          existing.costs += costs;
          existing.profit += profit;
          return;
        }

        acc.set(key, {
          name: item.productName,
          quantity: item.quantity,
          unitPrice: item.price,
          revenue,
          costs,
          profit,
        });
      });

      return acc;
    }, new Map<string, {
      name: string;
      quantity: number;
      unitPrice: number;
      revenue: number;
      costs: number;
      profit: number;
    }>())
  )
    .sort((a, b) => b[1].revenue - a[1].revenue);

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
              if (selectedPeriod === 'day' || selectedPeriod === 'custom') {
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
              onClick={() => setSelectedPeriod('custom')}
              className={`px-3 py-2 sm:px-4 rounded-lg font-medium transition-colors text-sm sm:text-base ${
                selectedPeriod === 'custom'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              Období
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
            <>
              {selectedPeriod === 'custom' ? (
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  <div className="flex items-center space-x-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      Od:
                    </label>
                    <input
                      type="date"
                      value={format(customStartDate, 'yyyy-MM-dd')}
                      onChange={(e) => setCustomStartDate(new Date(e.target.value))}
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      Do:
                    </label>
                    <input
                      type="date"
                      value={format(customEndDate, 'yyyy-MM-dd')}
                      onChange={(e) => setCustomEndDate(new Date(e.target.value))}
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                    />
                  </div>
                </div>
              ) : (
                <input
                  type="date"
                  value={format(selectedDate, 'yyyy-MM-dd')}
                  onChange={(e) => setSelectedDate(new Date(e.target.value))}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                />
              )}
            </>
          )}
        </div>
        <div className="text-lg font-medium text-gray-900 dark:text-white">
          {formatDate(selectedDate)}
        </div>
        {selectedPeriod === 'custom' && customStartDate > customEndDate && (
          <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
            <div className="flex items-center">
              <svg className="h-5 w-5 text-red-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <span className="text-red-700 dark:text-red-300 font-medium">
                Neplatný interval: Datum začátku musí být před datem konce
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {/* celkova trzba */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mr-3">
              <DollarSign className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
                Celková tržba
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {reportData.totalSales.toLocaleString('cs-CZ')} Kč
              </p>
            </div>
          </div>
        </motion.div>

        {/* zisk */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/20 rounded-lg flex items-center justify-center mr-3">
              <Calculator className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
                Zisk
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {reportData.totalProfit.toLocaleString('cs-CZ')} Kč
              </p>
            </div>
          </div>
        </motion.div>

        {/* hotovost */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/20 rounded-lg flex items-center justify-center mr-3">
              <Banknote className="h-5 w-5 text-yellow-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
                Hotovost
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {reportData.cashSales.toLocaleString('cs-CZ')} Kč
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {reportData.sales.filter(sale => sale.paymentMethod === 'cash').length} prodejů
              </p>
            </div>
          </div>
        </motion.div>

        {/* karty */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg flex items-center justify-center mr-3">
              <CreditCard className="h-5 w-5 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
                Karty
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {reportData.cardSales.toLocaleString('cs-CZ')} Kč
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {reportData.sales.filter(sale => sale.paymentMethod === 'card').length} prodejů
              </p>
            </div>
          </div>
        </motion.div>

        {/* qr kod */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center mr-3">
              <QrCode className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
                QR kód
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {reportData.qrSales.toLocaleString('cs-CZ')} Kč
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {reportData.sales.filter(sale => sale.paymentMethod === 'qr').length} prodejů
              </p>
            </div>
          </div>
        </motion.div>

        {/* eura */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center mr-3">
              <Euro className="h-5 w-5 text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
                Eura (vybrané)
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {reportData.salesInEUR.toFixed(2)} €
              </p>
            </div>
          </div>
        </motion.div>

        {/* koruny po vraceni */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900/20 rounded-lg flex items-center justify-center mr-3">
              <Banknote className="h-5 w-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
                Koruny (po vrácení)
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {reportData.salesInCZK.toLocaleString('cs-CZ')} Kč
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/20 rounded-lg flex items-center justify-center mr-3">
              <Users className="h-5 w-5 text-orange-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
                Zákazníci
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {reportData.customerCount}
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4"
        >
          <div className="flex items-center">
            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/20 rounded-lg flex items-center justify-center mr-3">
              <TrendingUp className="h-5 w-5 text-red-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 truncate">
                Slevy
              </p>
              <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                {reportData.totalDiscounts.toLocaleString('cs-CZ')} Kč
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {reportData.salesWithDiscount} prodejů
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Recent Sales + Detailed Product Breakdown */}
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Poslední prodeje
          </h3>
          {reportData.sales.length > 0 ? (
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
                      {sale.paymentMethod === 'cash' ? 'Hotovost' : sale.paymentMethod === 'card' ? 'Karta' : 'QR kód'}
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
          ) : (
            <p className="text-gray-600 dark:text-gray-400">
              Pro vybrané období nejsou žádné prodeje.
            </p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Rozpis prodaných produktů
          </h3>

          {soldProductsSummary.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-2 font-semibold text-gray-600 dark:text-gray-300">Produkt</th>
                    <th className="text-right py-3 px-2 font-semibold text-gray-600 dark:text-gray-300">Počet ks</th>
                    <th className="text-right py-3 px-2 font-semibold text-gray-600 dark:text-gray-300">Cena / ks</th>
                    <th className="text-right py-3 px-2 font-semibold text-gray-600 dark:text-gray-300">Tržba celkem</th>
                    <th className="text-right py-3 px-2 font-semibold text-gray-600 dark:text-gray-300">Náklady</th>
                    <th className="text-right py-3 px-2 font-semibold text-gray-600 dark:text-gray-300">Zisk</th>
                  </tr>
                </thead>
                <tbody>
                  {soldProductsSummary.map(([key, item]) => (
                    <tr key={key} className="border-b border-gray-100 dark:border-gray-700/70">
                      <td className="py-3 px-2 font-medium text-gray-900 dark:text-white">{item.name}</td>
                      <td className="py-3 px-2 text-right text-gray-700 dark:text-gray-300">{item.quantity}</td>
                      <td className="py-3 px-2 text-right text-gray-700 dark:text-gray-300">{item.unitPrice.toLocaleString('cs-CZ')} Kč</td>
                      <td className="py-3 px-2 text-right font-medium text-gray-900 dark:text-white">{item.revenue.toLocaleString('cs-CZ')} Kč</td>
                      <td className="py-3 px-2 text-right text-gray-700 dark:text-gray-300">{item.costs.toLocaleString('cs-CZ')} Kč</td>
                      <td className="py-3 px-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{item.profit.toLocaleString('cs-CZ')} Kč</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 dark:bg-gray-700/60">
                    <td className="py-3 px-2 font-semibold text-gray-900 dark:text-white">Celkem</td>
                    <td className="py-3 px-2 text-right font-semibold text-gray-900 dark:text-white">
                      {soldProductsSummary.reduce((sum, [, item]) => sum + item.quantity, 0)}
                    </td>
                    <td className="py-3 px-2" />
                    <td className="py-3 px-2 text-right font-semibold text-gray-900 dark:text-white">
                      {soldProductsSummary.reduce((sum, [, item]) => sum + item.revenue, 0).toLocaleString('cs-CZ')} Kč
                    </td>
                    <td className="py-3 px-2 text-right font-semibold text-gray-900 dark:text-white">
                      {soldProductsSummary.reduce((sum, [, item]) => sum + item.costs, 0).toLocaleString('cs-CZ')} Kč
                    </td>
                    <td className="py-3 px-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {soldProductsSummary.reduce((sum, [, item]) => sum + item.profit, 0).toLocaleString('cs-CZ')} Kč
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">
              V tomto období nejsou prodané položky k rozepsání.
            </p>
          )}
        </div>
      </div>

      {reportData.sales.length === 0 && (
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

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4"
          >
            <div className="flex items-start">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mr-4">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Uzávěrka odeslána</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Uzávěrka byla úspěšně vygenerována a odeslána na váš email.</p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={() => setShowSuccessModal(false)}
                className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Zavřít
              </button>
              <div className="flex items-center text-sm text-gray-600 dark:text-gray-300">
                <svg className="h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Zavírám za {successCountdown}s
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
