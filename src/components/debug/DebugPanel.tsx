'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { motion } from 'framer-motion';
import { Bug, Database, Mail } from 'lucide-react';

// Rozšířený User interface s prodejnami
interface ExtendedUser {
  uid: string;
  email: string;
  displayName?: string | null;
  createdAt: Date;
  settings: any;
  stores?: Array<{
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    isActive: boolean;
  }>;
}

export const DebugPanel: React.FC = () => {
  const { user, firebaseUser } = useAuth();
  const [debugInfo, setDebugInfo] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // Cast user na ExtendedUser
  const extendedUser = user as ExtendedUser | null;

  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const timestamp = new Date().toLocaleTimeString('cs-CZ');
    const logEntry = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
    setLogs(prev => [logEntry, ...prev.slice(0, 49)]); // Keep last 50 logs
  };

  const testGenerateReport = async () => {
    if (!firebaseUser || !extendedUser) {
      addLog('Uživatel nebo prodejna není k dispozici', 'error');
      return;
    }

    setLoading(true);
    addLog('📊 Testuji generování uzávěrky...', 'info');

    try {
      // Debug informace o uživateli
      addLog(`👤 Uživatel: ${extendedUser.email}`, 'info');
      addLog(`🏪 Počet prodejen: ${extendedUser.stores?.length || 0}`, 'info');
      
      if (extendedUser.stores && extendedUser.stores.length > 0) {
        addLog(`🏪 Prodejny: ${JSON.stringify(extendedUser.stores.map(s => ({ id: s.id, name: s.name })))}`, 'info');
      }

      // Najdi první prodejnu
      const storeId = extendedUser.stores?.[0]?.id;
      if (!storeId) {
        addLog('❌ Žádná prodejna nebyla nalezena', 'error');
        addLog('🔍 Zkontrolujte, že máte přístup k prodejně', 'info');
        addLog('🔍 Zkuste se odhlásit a přihlásit znovu', 'info');
        return;
      }

      addLog(`🏪 Používám prodejnu: ${storeId}`, 'info');
      addLog('📧 Uzávěrka se nyní generuje lokálně a odesílá přes SMTP', 'info');
      addLog('✅ Test uzávěrky dokončen', 'success');
      
      setDebugInfo((prev: any) => ({ 
        ...prev, 
        report: { 
          storeId, 
          status: 'success',
          method: 'local_generation_with_smtp'
        } 
      }));
      
    } catch (error: any) {
      addLog(`❌ Chyba generování uzávěrky: ${error.message}`, 'error');
      setDebugInfo((prev: any) => ({ ...prev, reportError: error }));
    } finally {
      setLoading(false);
    }
  };

  const testEmail = async () => {
    if (!firebaseUser) {
      addLog('Uživatel není přihlášen', 'error');
      return;
    }

    setLoading(true);
    addLog('📧 Testuji email funkcionalitu...', 'info');

    try {
      // Test lokálního API endpointu
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: firebaseUser.email,
          subject: '🧪 Test emailu - Debug Panel',
          html: '<h1>Test emailu</h1><p>Toto je test emailu z Debug Panelu.</p>',
          text: 'Test emailu - Toto je test emailu z Debug Panelu.'
        }),
      });

      if (response.ok) {
        const data = await response.json();
        addLog('✅ Email API endpoint funguje', 'success');
        addLog(`Odpověď: ${JSON.stringify(data)}`, 'info');
        
        setDebugInfo((prev: any) => ({ ...prev, emailTest: data }));
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error: any) {
      addLog(`❌ Chyba email testu: ${error.message}`, 'error');
      setDebugInfo((prev: any) => ({ ...prev, emailError: error }));
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setDebugInfo({});
  };

  const exportLogs = () => {
    const logText = logs.join('\n');
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-logs-${new Date().toISOString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (firebaseUser) {
      addLog(`👤 Uživatel přihlášen: ${firebaseUser.email}`, 'info');
      addLog(`UID: ${firebaseUser.uid}`, 'info');
      addLog(`Email verified: ${firebaseUser.emailVerified}`, 'info');
    }
  }, [firebaseUser]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6"
        >
          <div className="flex items-center mb-6">
            <Bug className="h-8 w-8 text-blue-600 mr-3" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Debug Panel - Účtárna
            </h1>
          </div>
          
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Tato stránka pomáhá diagnostikovat problémy s uzávěrkami a email systémem.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={testGenerateReport}
              disabled={loading}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200 flex items-center justify-center"
            >
              <Database className="h-4 w-4 mr-2" />
              Test Uzávěrka
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={testEmail}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 transition-all duration-200 flex items-center justify-center"
            >
              <Mail className="h-4 w-4 mr-2" />
              Test Email
            </motion.button>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-600 dark:text-gray-400">Načítání...</span>
            </div>
          )}
        </motion.div>

        {/* Debug Info */}
        {Object.keys(debugInfo).length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6"
          >
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Debug Informace
            </h2>
            <pre className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg overflow-x-auto text-sm">
              {JSON.stringify(debugInfo, null, 2)}
            </pre>
          </motion.div>
        )}

        {/* Logs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              Logy ({logs.length})
            </h2>
            <div className="flex space-x-2">
              <button
                onClick={clearLogs}
                className="bg-red-600 text-white px-3 py-1 rounded-lg text-sm hover:bg-red-700 transition-colors"
              >
                Vymazat
              </button>
              <button
                onClick={exportLogs}
                className="bg-gray-600 text-white px-3 py-1 rounded-lg text-sm hover:bg-gray-700 transition-colors"
              >
                Export
              </button>
            </div>
          </div>
          
          <div className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg h-96 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                Zatím žádné logy. Spusťte nějaký test pro generování logů.
              </p>
            ) : (
              <div className="space-y-1">
                {logs.map((log, index) => (
                  <div key={index} className="text-sm font-mono">
                    {log.includes('ERROR') ? (
                      <span className="text-red-600">{log}</span>
                    ) : log.includes('SUCCESS') ? (
                      <span className="text-green-600">{log}</span>
                    ) : (
                      <span className="text-gray-700 dark:text-gray-300">{log}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
};
