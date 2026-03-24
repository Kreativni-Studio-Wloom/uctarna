'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';

interface SumUpResponse {
  id: string;
  timestamp: any;
  requestMethod: string;
  requestUrl: string;
  userAgent: string;
  contentType: string;
  rawBody: any;
  extractedData: any;
  allKeys: string[];
  processedAt: string;
}

export default function SumUpDataPage() {
  const { user } = useAuth();
  const [sumUpData, setSumUpData] = useState<SumUpResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<SumUpResponse | null>(null);

  useEffect(() => {
    if (!user) return;

    // Zkusíme načíst data z obecné složky sumup-debug
    const sumUpRef = collection(db, 'sumup-debug');
    const q = query(sumUpRef, orderBy('timestamp', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SumUpResponse[];
      
      setSumUpData(data);
      setLoading(false);
    }, (error) => {
      console.error('Chyba při načítání SumUp dat:', error);
      setLoading(false);
    });

    return unsubscribe;
  }, [user]);

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    
    const dateObj = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return new Intl.DateTimeFormat('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(dateObj);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Načítám SumUp data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6"
        >
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            SumUp Data z Firebase
          </h1>
          
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Celkem záznamů: {sumUpData.length}
          </div>
          
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Kde najdete data v Firebase:</strong>
            </div>
            <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              • Hlavní struktura: <code>users/{user?.uid}/stores/{'{storeId}'}/sumup</code> (pod konkrétní profil a prodejnu)<br/>
              • Debug složka: <code>sumup-debug</code> (všechna data pro debugging)<br/>
              • Testovací data: <code>debug/sumup</code> (z debug endpointu)
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Seznam záznamů */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Seznam SumUp odpovědí
              </h2>
              
              {sumUpData.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  Žádné SumUp data nejsou k dispozici
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {sumUpData.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                        selectedItem?.id === item.id
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatDate(item.timestamp)}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {item.requestMethod} - {item.extractedData?.status || 'N/A'}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Keys: {item.allKeys?.length || 0}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Detail vybraného záznamu */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Detail záznamu
              </h2>
              
              {selectedItem ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                      Základní informace
                    </h3>
                    <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded text-sm">
                      <div><strong>Čas:</strong> {formatDate(selectedItem.timestamp)}</div>
                      <div><strong>Metoda:</strong> {selectedItem.requestMethod}</div>
                      <div><strong>URL:</strong> {selectedItem.requestUrl}</div>
                      <div><strong>User-Agent:</strong> {selectedItem.userAgent}</div>
                      <div><strong>Content-Type:</strong> {selectedItem.contentType}</div>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                      Extrahovaná data
                    </h3>
                    <pre className="bg-gray-50 dark:bg-gray-700 p-3 rounded text-sm overflow-auto max-h-40">
                      {JSON.stringify(selectedItem.extractedData, null, 2)}
                    </pre>
                  </div>

                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                      Raw data
                    </h3>
                    <pre className="bg-gray-50 dark:bg-gray-700 p-3 rounded text-sm overflow-auto max-h-40">
                      {JSON.stringify(selectedItem.rawBody, null, 2)}
                    </pre>
                  </div>

                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white mb-2">
                      Všechny klíče
                    </h3>
                    <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded text-sm">
                      {selectedItem.allKeys?.join(', ') || 'N/A'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  Vyberte záznam pro zobrazení detailů
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
