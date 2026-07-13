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
const THUMB_RADIUS_PCT = 38; // % poloměru kola (0 = střed, 50 = okraj)
const WHEEL_SAT = 90;
const WHEEL_LIGHT = 55;

/** Hue 0 = červená nahoře, po směru hodinových ručiček (shodné s CSS conic-gradient). */
function hueFromPointer(clientX: number, clientY: number, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const radians = Math.atan2(dx, -dy);
  return Math.round(((radians * 180) / Math.PI + 360) % 360);
}

function hueToThumbPosition(hue: number): { x: number; y: number } {
  const radians = (hue * Math.PI) / 180;
  return {
    x: 50 + Math.sin(radians) * THUMB_RADIUS_PCT,
    y: 50 - Math.cos(radians) * THUMB_RADIUS_PCT,
  };
}

const WHEEL_GRADIENT =
  'conic-gradient(hsl(0,90%,55%), hsl(30,90%,55%), hsl(60,90%,55%), hsl(90,90%,55%), hsl(120,90%,55%), hsl(150,90%,55%), hsl(180,90%,55%), hsl(210,90%,55%), hsl(240,90%,55%), hsl(270,90%,55%), hsl(300,90%,55%), hsl(330,90%,55%), hsl(360,90%,55%))';

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
  const lightPalette = hueToPalette(hue, 0);
  const darkPalette = hueToPalette(hue, 100);

  const handlePointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = wheelRef.current?.getBoundingClientRect();
      if (!rect) return;
      onHueChange(hueFromPointer(clientX, clientY, rect));
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

  const thumb = hueToThumbPosition(hue);
  const thumbColor = `hsl(${hue}, ${WHEEL_SAT}%, ${WHEEL_LIGHT}%)`;

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
          style={{ background: WHEEL_GRADIENT }}
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
            left: `${thumb.x}%`,
            top: `${thumb.y}%`,
            transform: 'translate(-50%, -50%)',
            backgroundColor: thumbColor,
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
              background: `linear-gradient(to right, rgb(${lightPalette[200]}), rgb(${palette[600]}), rgb(${darkPalette[700]}))`,
            }}
          />
          <div className="flex justify-between mt-1 text-[10px] text-gray-500 dark:text-gray-400">
            <span>Světlý</span>
            <span>Tmavý</span>
          </div>
        </div>

        <div className="flex gap-2">
          {([
            { level: 200 as const, label: 'Světlý' },
            { level: 600 as const, label: 'Hlavní' },
            { level: 700 as const, label: 'Tmavý' },
          ]).map(({ level, label }) => (
            <div key={level} className="flex-1 text-center">
              <div
                className="h-8 rounded-lg border border-gray-200 dark:border-gray-600 shadow-sm"
                style={{ backgroundColor: `rgb(${palette[level]})` }}
              />
              <span className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 block">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export { DEFAULT_BRAND_HUE, DEFAULT_BRAND_SHADE };
