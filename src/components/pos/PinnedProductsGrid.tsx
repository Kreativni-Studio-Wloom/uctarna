'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Product } from '@/types';

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 8;

interface DragState {
  productId: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
}

interface PinnedProductsGridProps {
  /** Připnuté produkty v aktuálním uloženém pořadí. */
  products: Product[];
  highlightedProductId: string | null;
  renderBadge: (productId: string) => React.ReactNode;
  pickButtonClass: (isHighlighted: boolean) => string;
  onProductClick: (product: Product) => void;
  /** Uloží nové pořadí ID připnutých produktů. */
  onReorder: (productIds: string[]) => void;
}

export const PinnedProductsGrid: React.FC<PinnedProductsGridProps> = ({
  products,
  highlightedProductId,
  renderBadge,
  pickButtonClass,
  onProductClick,
  onReorder,
}) => {
  const [reorderMode, setReorderMode] = useState(false);
  // Lokální pořadí během režimu přeskupování (přepisuje props, dokud se zápis nepropíše zpět)
  const [order, setOrder] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const orderRef = useRef<string[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const orderAtDragStartRef = useRef<string[]>([]);
  const longPressTimerRef = useRef<number | null>(null);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  const orderedProducts = useMemo(() => {
    if (!order) return products;
    const byId = new Map(products.map((p) => [p.id, p]));
    const inOrder = order
      .map((id) => byId.get(id))
      .filter((p): p is Product => Boolean(p));
    const missing = products.filter((p) => !order.includes(p.id));
    return [...inOrder, ...missing];
  }, [products, order]);

  const draggedProduct = drag ? products.find((p) => p.id === drag.productId) : null;

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pressStartRef.current = null;
  };

  const startDrag = (productId: string, clientX: number, clientY: number) => {
    const el = itemRefs.current.get(productId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next: DragState = {
      productId,
      width: rect.width,
      height: rect.height,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      x: clientX,
      y: clientY,
    };
    orderAtDragStartRef.current = orderRef.current;
    dragRef.current = next;
    setDrag(next);
  };

  const enterReorderMode = (productId: string, clientX: number, clientY: number) => {
    const ids = products.map((p) => p.id);
    orderRef.current = ids;
    setOrder(ids);
    setReorderMode(true);
    suppressClickRef.current = true;
    if (typeof navigator !== 'undefined') navigator.vibrate?.(30);
    startDrag(productId, clientX, clientY);
  };

  const exitReorderMode = () => {
    setReorderMode(false);
    setOrder(null);
    dragRef.current = null;
    setDrag(null);
  };

  const handlePointerDown = (e: React.PointerEvent, product: Product) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pressStartRef.current = { x: e.clientX, y: e.clientY };

    if (reorderMode) {
      suppressClickRef.current = true;
      startDrag(product.id, e.clientX, e.clientY);
      return;
    }

    const { clientX, clientY } = e;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      enterReorderMode(product.id, clientX, clientY);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pressStartRef.current || dragRef.current) return;
    const dist = Math.hypot(
      e.clientX - pressStartRef.current.x,
      e.clientY - pressStartRef.current.y
    );
    if (dist > MOVE_CANCEL_PX) cancelLongPress();
  };

  const dragging = drag !== null;

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const updated = { ...current, x: e.clientX, y: e.clientY };
      dragRef.current = updated;
      setDrag(updated);

      // Hit-test: nad kterou kartou je ukazatel → přesun taženého ID na její pozici
      for (const [id, el] of itemRefs.current) {
        if (id === current.productId) continue;
        const r = el.getBoundingClientRect();
        if (
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
        ) {
          const from = orderRef.current.indexOf(current.productId);
          const to = orderRef.current.indexOf(id);
          if (from !== -1 && to !== -1 && from !== to) {
            const next = [...orderRef.current];
            next.splice(from, 1);
            next.splice(to, 0, current.productId);
            orderRef.current = next;
            setOrder(next);
          }
          break;
        }
      }
    };

    const endDrag = () => {
      dragRef.current = null;
      setDrag(null);
      if (orderRef.current.join('|') !== orderAtDragStartRef.current.join('|')) {
        onReorder(orderRef.current);
      }
    };

    const preventTouchScroll = (e: TouchEvent) => e.preventDefault();

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    document.addEventListener('touchmove', preventTouchScroll, { passive: false });

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      document.removeEventListener('touchmove', preventTouchScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  useEffect(() => {
    if (!reorderMode) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitReorderMode();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [reorderMode]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Připnuté položky
        </h3>
        {reorderMode && (
          <button
            onClick={exitReorderMode}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
          >
            <Check className="h-4 w-4" />
            Hotovo
          </button>
        )}
      </div>

      {reorderMode && (
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2 mb-3">
          Tažením karet změníte jejich pořadí.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {orderedProducts.map((product, index) => {
          const isHighlighted = highlightedProductId === product.id;
          const isDragSource = drag?.productId === product.id;
          return (
            <motion.button
              key={product.id}
              layout
              ref={(el) => {
                if (el) itemRefs.current.set(product.id, el);
                else itemRefs.current.delete(product.id);
              }}
              type="button"
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                if (reorderMode) return;
                onProductClick(product);
              }}
              onPointerDown={(e) => handlePointerDown(e, product)}
              onPointerMove={handlePointerMove}
              onPointerUp={cancelLongPress}
              onPointerCancel={cancelLongPress}
              onPointerLeave={cancelLongPress}
              onContextMenu={(e) => e.preventDefault()}
              animate={
                reorderMode && !isDragSource
                  ? { rotate: [-1, 1, -1] }
                  : { rotate: 0 }
              }
              transition={
                reorderMode && !isDragSource
                  ? {
                      rotate: {
                        repeat: Infinity,
                        duration: 0.3,
                        ease: 'easeInOut',
                        delay: (index % 3) * 0.08,
                      },
                    }
                  : { duration: 0.15 }
              }
              style={reorderMode ? { touchAction: 'none' } : undefined}
              className={`bg-white dark:bg-gray-800 p-4 rounded-lg border text-left select-none [-webkit-touch-callout:none] ${
                isDragSource
                  ? 'border-dashed border-purple-400 dark:border-purple-500 opacity-40'
                  : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600'
              } ${reorderMode ? 'cursor-grab' : ''} ${pickButtonClass(isHighlighted)}`}
            >
              {isHighlighted && !reorderMode && renderBadge(product.id)}
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

      {/* Tažená karta letící pod prstem/kurzorem */}
      {drag && draggedProduct && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <motion.div
            initial={{ scale: 1 }}
            animate={{ scale: 1.06 }}
            style={{
              position: 'absolute',
              left: drag.x - drag.offsetX,
              top: drag.y - drag.offsetY,
              width: drag.width,
              height: drag.height,
            }}
          >
            <div className="h-full bg-white dark:bg-gray-800 p-4 rounded-lg border-2 border-purple-500 shadow-2xl text-left">
              <h4 className="font-medium text-gray-900 dark:text-white text-sm mb-2">
                {draggedProduct.name}
              </h4>
              <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
                {draggedProduct.price} Kč
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
