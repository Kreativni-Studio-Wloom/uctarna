import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Sale } from '@/types';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CheckCircle2, Timer, Clock } from 'lucide-react';

interface DispatchViewProps {
	storeId: string;
}

export const DispatchView: React.FC<DispatchViewProps> = ({ storeId }) => {
	const { user } = useAuth();
	const [orders, setOrders] = useState<Sale[]>([]);
	const [loading, setLoading] = useState(true);
	const [updatingId, setUpdatingId] = useState<string | null>(null);

	useEffect(() => {
		if (!user || !storeId) return;

		const salesRef = collection(db, 'users', user.uid, 'stores', storeId, 'sales');
		const q = query(salesRef, where('served', '!=', true));

		const unsubscribe = onSnapshot(q, (snapshot) => {
			const data = snapshot.docs
				.map((d) => ({ id: d.id, ...d.data() })) as Sale[];
			// Řazení na klientu podle createdAt ASC, aby nebyl potřeba index
			const sorted = data.sort((a, b) => {
				const aDate: any = (a as any).createdAt;
				const bDate: any = (b as any).createdAt;
				const aTime = aDate?.toDate ? aDate.toDate().getTime() : new Date(aDate || 0).getTime();
				const bTime = bDate?.toDate ? bDate.toDate().getTime() : new Date(bDate || 0).getTime();
				return aTime - bTime;
			});
			setOrders(sorted);
			setLoading(false);
		});

		return unsubscribe;
	}, [user, storeId]);

	const markPrepared = async (saleId: string) => {
		if (!user) return;
		setUpdatingId(saleId);
		try {
			await updateDoc(doc(db, 'users', user.uid, 'stores', storeId, 'sales', saleId), {
				prepared: true,
				preparedAt: new Date(),
			});
		} finally {
			setUpdatingId(null);
		}
	};

	const markServed = async (saleId: string) => {
		if (!user) return;
		setUpdatingId(saleId);
		try {
			await updateDoc(doc(db, 'users', user.uid, 'stores', storeId, 'sales', saleId), {
				served: true,
				servedAt: new Date(),
			});
		} finally {
			setUpdatingId(null);
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
				<h2 className="text-2xl font-bold text-gray-900 dark:text-white">Objednávky</h2>
				<div className="text-sm text-gray-500 dark:text-gray-400">
					Připravené: {orders.filter(o => o.prepared && !o.served).length} | 
					Čekající: {orders.filter(o => !o.prepared && !o.served).length}
				</div>
			</div>

			{orders.length === 0 ? (
				<div className="text-center py-12">
					<Timer className="h-16 w-16 text-gray-400 mx-auto mb-4" />
					<h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Žádné objednávky</h3>
					<p className="text-gray-600 dark:text-gray-400">Nové objednávky se zde zobrazí automaticky</p>
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
					{orders.map((order) => {
						const isPrepared = order.prepared && !order.served;
						const isWaiting = !order.prepared && !order.served;
						
						return (
							<div key={order.id} className={`bg-white dark:bg-gray-800 rounded-xl border p-5 ${
								isPrepared 
									? 'border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20' 
									: 'border-gray-200 dark:border-gray-700'
							}`}>
								<div className="flex items-center justify-between mb-3">
									<div className="text-sm text-gray-500 dark:text-gray-400">#{order.id.slice(-6)}</div>
									<div className="text-lg font-bold text-gray-900 dark:text-white">
										{order.currency === 'EUR' ? `${order.totalAmount.toFixed(2)} €` : `${order.totalAmount} Kč`}
									</div>
								</div>
					<div className="space-y-1 mb-4">
						{order.customerName && (
							<div className="mb-2">
								<span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Jméno</span>
								<div className="text-lg font-semibold text-gray-900 dark:text-white">{order.customerName}</div>
							</div>
						)}
						<div className="mb-1">
							<span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Položky</span>
						</div>
									{order.items.map((item, idx) => (
										<div key={idx} className="flex justify-between items-baseline">
											<span className="text-gray-900 dark:text-white text-lg md:text-xl font-semibold tracking-tight">{item.productName}</span>
											<span className="text-sm font-medium text-gray-900 dark:text-white">× {item.quantity}</span>
										</div>
									))}
								</div>
								
								{isWaiting && (
									<button
										onClick={() => markPrepared(order.id)}
										disabled={updatingId === order.id}
										className="w-full inline-flex items-center justify-center bg-orange-600 hover:bg-orange-700 text-white font-medium py-2.5 rounded-lg transition-colors"
									>
										<Clock className="h-5 w-5 mr-2" />
										{updatingId === order.id ? 'Označuji...' : 'Připraveno'}
									</button>
								)}
								
								{isPrepared && (
									<button
										onClick={() => markServed(order.id)}
										disabled={updatingId === order.id}
										className="w-full inline-flex items-center justify-center bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 rounded-lg transition-colors"
									>
										<CheckCircle2 className="h-5 w-5 mr-2" />
										{updatingId === order.id ? 'Označuji...' : 'Vydáno'}
									</button>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};
