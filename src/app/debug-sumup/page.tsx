'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';

export default function DebugSumUpPage() {
  const [testData, setTestData] = useState({
    status: 'success',
    txCode: 'TEST123',
    foreignTxId: 'TEST_FOREIGN_123',
    amount: 100,
    currency: 'CZK',
    storeId: 'test-store',
    userId: 'test-user',
    cartItems: [{ productId: 'test-product', quantity: 1, price: 100 }]
  });
  
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const testCallback = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/debug-sumup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testData),
      });
      
      const data = await response.json();
      setResult(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setResult({ error: message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6"
        >
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            SumUp Debug Test
          </h1>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Test Data (JSON):
              </label>
              <textarea
                value={JSON.stringify(testData, null, 2)}
                onChange={(e) => {
                  try {
                    setTestData(JSON.parse(e.target.value));
                  } catch (error) {
                    // Ignore invalid JSON while typing
                  }
                }}
                className="w-full h-64 p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
              />
            </div>
            
            <button
              onClick={testCallback}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50"
            >
              {loading ? 'Testing...' : 'Test Callback'}
            </button>
            
            {result && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Result:
                </label>
                <pre className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm overflow-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
