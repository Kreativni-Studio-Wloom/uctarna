'use client';

import React, { useCallback, useRef } from 'react';
import { DEFAULT_BRAND_HUE, DEFAULT_BRAND_SHADE, getBrandPreviewColor, hueToPalette } from '@/lib/colorScheme';

interface ColorWheelPickerProps {
  hue: number;
  shade: number;
  onHueChange: (hue: number) => void;
  onShadeChange: (shade: number) => void;
}

const WHEEL_SIZE = 148;
const THUMB_RADIUS = 38;

function pickHueFromPointer(clientX: number, clientY: number, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  return Math.round((degrees + 90 + 360) % 360);
}

export const ColorWheelPicker: React.FC<ColorWheelPickerProps> = ({
  hue,
  shade,
  onHueChange,
  onShadeChange,
}) => {
  const wheelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const previewColor = getBrandPreviewColor(hue, shade);
  const palette = hueToPalette(hue, shade);

  const handlePointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = wheelRef.current?.getBoundingClientRect();
      if (!rect) return;
      onHueChange(pickHueFromPointer(clientX, clientY, rect));
    },
    [onHueChange]
  );

  const onWheelPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    wheelRef.current?.setPointerCapture(e.pointerId);
    handlePointer(e.clientX, e.clientY);
  };

  const onWheelPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    handlePointer(e.clientX, e.clientY);
  };

  const onWheelPointerUp = (e: React.PointerEvent) => {
    dragging.current = false;
    wheelRef.current?.releasePointerCapture(e.pointerId);
  };

  const thumbAngle = ((hue - 90) * Math.PI) / 180;
  const thumbX = 50 + Math.cos(thumbAngle) * (THUMB_RADIUS / (WHEEL_SIZE / 2)) * 50;
  const thumbY = 50 + Math.sin(thumbAngle) * (THUMB_RADIUS / (WHEEL_SIZE / 2)) * 50;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-8">
      {/* Kolo barev */}
      <div className="relative shrink-0" style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}>
        <div
          ref={wheelRef}
          role="slider"
          aria-label="Vybrat barvu"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={hue}
          tabIndex={0}
          onPointerDown={onWheelPointerDown}
          onPointerMove={onWheelPointerMove}
          onPointerUp={onWheelPointerUp}
          onPointerCancel={onWheelPointerUp}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault();
              onHueChange((hue - 5 + 360) % 360);
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault();
              onHueChange((hue + 5) % 360);
            }
          }}
          className="absolute inset-0 rounded-full cursor-pointer touch-none shadow-md"
          style={{
            background:
              'conic-gradient(from -90deg, hsl(0,90%,55%), hsl(30,90%,55%), hsl(60,90%,55%), hsl(90,90%,55%), hsl(120,90%,55%), hsl(150,90%,55%), hsl(180,90%,55%), hsl(210,90%,55%), hsl(240,90%,55%), hsl(270,90%,55%), hsl(300,90%,55%), hsl(330,90%,55%), hsl(360,90%,55%))',
          }}
        />
        {/* Vnitřní kruh — náhled */}
        <div
          className="absolute rounded-full border-2 border-white dark:border-gray-700 shadow-inner pointer-events-none"
          style={{
            inset: '22%',
            backgroundColor: previewColor,
          }}
        />
        {/* Ukazatel na kruhu */}
        <div
          className="absolute w-5 h-5 rounded-full border-2 border-white shadow-md pointer-events-none"
          style={{
            left: `${thumbX}%`,
            top: `${thumbY}%`,
            transform: 'translate(-50%, -50%)',
            backgroundColor: `hsl(${hue}, 80%, 50%)`,
          }}
        />
      </div>

      {/* Odstín + vzorky */}
      <div className="flex-1 w-full sm:min-w-[180px] space-y-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="brandShade" className="text-sm font-medium text-gray-900 dark:text-white">
              Odstín
            </label>
            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">{shade}%</span>
          </div>
          <input
            id="brandShade"
            type="range"
            min={0}
            max={100}
            value={shade}
            onChange={(e) => onShadeChange(Number(e.target.value))}
            className="w-full h-2 rounded-full appearance-none cursor-pointer bg-gradient-to-r from-gray-200 via-brand-500 to-brand-900 accent-brand-600"
            style={{
              background: `linear-gradient(to right, hsl(${hue}, 25%, 88%), hsl(${hue}, 55%, 55%), hsl(${hue}, 70%, 25%))`,
            }}
          />
          <div className="flex justify-between mt-1 text-[10px] text-gray-500 dark:text-gray-400">
            <span>Světlý</span>
            <span>Tmavý</span>
          </div>
        </div>

        <div className="flex gap-2">
          {([200, 500, 700] as const).map((level) => (
            <div key={level} className="flex-1 text-center">
              <div
                className="h-8 rounded-lg border border-gray-200 dark:border-gray-600 shadow-sm"
                style={{ backgroundColor: `rgb(${palette[level]})` }}
              />
              <span className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 block">{level}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export { DEFAULT_BRAND_HUE, DEFAULT_BRAND_SHADE };
