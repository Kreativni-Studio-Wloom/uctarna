'use client';

import dynamic from 'next/dynamic';
import { useAuth } from '@/contexts/AuthContext';
import { LoginForm } from '@/components/auth/LoginForm';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

const Dashboard = dynamic(
  () => import('@/components/dashboard/Dashboard').then((m) => ({ default: m.Dashboard })),
  {
    loading: () => (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 text-brand-600 animate-spin" />
      </div>
    ),
  }
);

export default function Home() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <Loader2 className="h-12 w-12 text-brand-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">
            Načítání Účtárny...
          </h2>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 p-4">
        <LoginForm onSuccess={() => {}} />
      </div>
    );
  }

  return <Dashboard />;
}
