export type ColorSchemeId =
  | 'purple'
  | 'violet'
  | 'indigo'
  | 'blue'
  | 'sky'
  | 'fuchsia'
  | 'pink'
  | 'rose'
  | 'salmon'
  | 'coral'
  | 'peach'
  | 'red'
  | 'wine'
  | 'bordeaux'
  | 'rust'
  | 'orange'
  | 'amber'
  | 'gold'
  | 'yellow'
  | 'tan'
  | 'beige'
  | 'brown'
  | 'cocoa'
  | 'olive'
  | 'white'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan';

export type ColorShade = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export type ColorPalette = Record<ColorShade, string>;

export interface ColorScheme {
  id: ColorSchemeId;
  label: string;
  /** Hex pro theme-color meta tag a náhledy */
  themeColor: string;
  shades: ColorPalette;
}

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = 'purple';

/** 30 barev = 6 řádků × 5 (PC) = 10 řádků × 3 (mobil); podobné odstíny vedle sebe */
export const COLOR_SCHEME_ORDER: ColorSchemeId[] = [
  // fialová → modrá
  'purple', 'violet', 'indigo', 'blue', 'sky',
  // růžová → lososová
  'fuchsia', 'pink', 'rose', 'salmon', 'coral',
  // broskvová → vínová
  'peach', 'red', 'wine', 'bordeaux', 'rust',
  // teplé odstíny
  'orange', 'amber', 'gold', 'yellow', 'tan',
  // hnědá → neutrální
  'beige', 'brown', 'cocoa', 'olive', 'white',
  // zelená → azurová
  'lime', 'green', 'emerald', 'teal', 'cyan',
];

const SHADES: ColorShade[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

/** Tailwind RGB palety – formát "R G B" pro podporu opacity modifikátorů */
const PALETTES: Record<ColorSchemeId, ColorPalette> = {
  purple: {
    50: '250 245 255', 100: '243 232 255', 200: '233 213 255', 300: '216 180 254',
    400: '192 132 252', 500: '168 85 247', 600: '147 51 234', 700: '126 34 206',
    800: '107 33 168', 900: '88 28 135',
  },
  violet: {
    50: '245 243 255', 100: '237 233 254', 200: '221 214 254', 300: '196 181 253',
    400: '167 139 250', 500: '139 92 246', 600: '124 58 237', 700: '109 40 217',
    800: '91 33 182', 900: '76 29 149',
  },
  indigo: {
    50: '238 242 255', 100: '224 231 255', 200: '199 210 254', 300: '165 180 252',
    400: '129 140 248', 500: '99 102 241', 600: '79 70 229', 700: '67 56 202',
    800: '55 48 163', 900: '49 46 129',
  },
  blue: {
    50: '239 246 255', 100: '219 234 254', 200: '191 219 254', 300: '147 197 253',
    400: '96 165 250', 500: '59 130 246', 600: '37 99 235', 700: '29 78 216',
    800: '30 64 175', 900: '30 58 138',
  },
  sky: {
    50: '240 249 255', 100: '224 242 254', 200: '186 230 253', 300: '125 211 252',
    400: '56 189 248', 500: '14 165 233', 600: '2 132 199', 700: '3 105 161',
    800: '7 89 133', 900: '12 74 110',
  },
  fuchsia: {
    50: '253 244 255', 100: '250 232 255', 200: '245 208 254', 300: '240 171 252',
    400: '232 121 249', 500: '217 70 239', 600: '192 38 211', 700: '162 28 175',
    800: '134 25 143', 900: '112 26 117',
  },
  pink: {
    50: '253 242 248', 100: '252 231 243', 200: '251 207 232', 300: '249 168 212',
    400: '244 114 182', 500: '236 72 153', 600: '219 39 119', 700: '190 24 93',
    800: '157 23 77', 900: '131 24 67',
  },
  rose: {
    50: '255 241 242', 100: '255 228 230', 200: '254 205 211', 300: '253 164 175',
    400: '251 113 133', 500: '244 63 94', 600: '225 29 72', 700: '190 18 60',
    800: '159 18 57', 900: '136 19 55',
  },
  salmon: {
    50: '255 245 245', 100: '255 228 225', 200: '255 205 195', 300: '255 170 155',
    400: '250 128 114', 500: '233 110 95', 600: '206 88 75', 700: '171 72 60',
    800: '140 58 48', 900: '115 46 38',
  },
  coral: {
    50: '255 247 245', 100: '255 235 228', 200: '255 210 195', 300: '255 175 150',
    400: '255 130 100', 500: '255 100 75', 600: '234 82 58', 700: '194 62 42',
    800: '154 50 34', 900: '124 40 28',
  },
  peach: {
    50: '255 250 245', 100: '255 241 230', 200: '254 224 195', 300: '253 200 155',
    400: '251 175 115', 500: '245 145 80', 600: '220 118 55', 700: '180 95 42',
    800: '145 75 34', 900: '118 60 28',
  },
  red: {
    50: '254 242 242', 100: '254 226 226', 200: '254 202 202', 300: '252 165 165',
    400: '248 113 113', 500: '239 68 68', 600: '220 38 38', 700: '185 28 28',
    800: '153 27 27', 900: '127 29 29',
  },
  wine: {
    50: '253 245 247', 100: '250 230 235', 200: '245 200 210', 300: '230 155 170',
    400: '200 105 120', 500: '170 72 88', 600: '140 55 70', 700: '114 47 55',
    800: '95 38 45', 900: '78 30 38',
  },
  bordeaux: {
    50: '250 242 244', 100: '245 225 230', 200: '235 190 200', 300: '210 140 155',
    400: '175 85 100', 500: '140 50 65', 600: '115 35 50', 700: '95 25 40',
    800: '75 20 32', 900: '60 15 25',
  },
  rust: {
    50: '255 247 242', 100: '255 235 220', 200: '255 210 175', 300: '240 170 120',
    400: '220 130 70', 500: '200 100 45', 600: '180 80 30', 700: '150 65 25',
    800: '120 52 20', 900: '95 42 18',
  },
  orange: {
    50: '255 247 237', 100: '255 237 213', 200: '254 215 170', 300: '253 186 116',
    400: '251 146 60', 500: '249 115 22', 600: '234 88 12', 700: '194 65 12',
    800: '154 52 18', 900: '124 45 18',
  },
  amber: {
    50: '255 251 235', 100: '254 243 199', 200: '253 230 138', 300: '252 211 77',
    400: '251 191 36', 500: '245 158 11', 600: '217 119 6', 700: '180 83 9',
    800: '146 64 14', 900: '120 53 15',
  },
  gold: {
    50: '255 251 235', 100: '254 243 210', 200: '253 228 165', 300: '250 210 115',
    400: '245 185 65', 500: '234 160 30', 600: '202 130 15', 700: '165 105 12',
    800: '130 82 10', 900: '105 65 8',
  },
  yellow: {
    50: '254 252 232', 100: '254 249 195', 200: '254 240 138', 300: '253 224 71',
    400: '250 204 21', 500: '234 179 8', 600: '202 138 4', 700: '161 98 7',
    800: '133 77 14', 900: '113 63 18',
  },
  tan: {
    50: '250 247 242', 100: '245 237 225', 200: '235 220 195', 300: '220 195 160',
    400: '200 165 120', 500: '180 140 95', 600: '160 120 75', 700: '130 98 60',
    800: '105 78 48', 900: '85 62 38',
  },
  beige: {
    50: '253 250 245', 100: '248 242 230', 200: '240 230 210', 300: '225 210 185',
    400: '205 185 155', 500: '185 165 130', 600: '165 145 110', 700: '140 120 90',
    800: '115 98 72', 900: '95 80 58',
  },
  brown: {
    50: '250 245 240', 100: '245 235 225', 200: '230 210 190', 300: '210 180 150',
    400: '180 140 100', 500: '150 110 70', 600: '120 85 55', 700: '95 68 42',
    800: '75 54 35', 900: '60 42 28',
  },
  cocoa: {
    50: '248 242 238', 100: '240 228 218', 200: '225 200 180', 300: '200 165 140',
    400: '165 125 95', 500: '130 95 70', 600: '105 75 55', 700: '85 60 42',
    800: '68 48 32', 900: '55 38 26',
  },
  olive: {
    50: '248 250 242', 100: '237 242 220', 200: '220 230 185', 300: '195 210 145',
    400: '165 185 105', 500: '130 155 75', 600: '105 125 58', 700: '85 100 45',
    800: '68 80 36', 900: '55 65 28',
  },
  white: {
    50: '255 255 255', 100: '250 250 250', 200: '245 245 245', 300: '229 229 229',
    400: '212 212 212', 500: '163 163 163', 600: '115 115 115', 700: '82 82 82',
    800: '64 64 64', 900: '38 38 38',
  },
  lime: {
    50: '247 254 231', 100: '236 252 203', 200: '217 249 157', 300: '190 242 100',
    400: '163 230 53', 500: '132 204 22', 600: '101 163 13', 700: '77 124 15',
    800: '63 98 18', 900: '54 83 20',
  },
  green: {
    50: '240 253 244', 100: '220 252 231', 200: '187 247 208', 300: '134 239 172',
    400: '74 222 128', 500: '34 197 94', 600: '22 163 74', 700: '21 128 61',
    800: '22 101 52', 900: '20 83 45',
  },
  emerald: {
    50: '236 253 245', 100: '209 250 229', 200: '167 243 208', 300: '110 231 183',
    400: '52 211 153', 500: '16 185 129', 600: '5 150 105', 700: '4 120 87',
    800: '6 95 70', 900: '6 78 59',
  },
  teal: {
    50: '240 253 250', 100: '204 251 241', 200: '153 246 228', 300: '94 234 212',
    400: '45 212 191', 500: '20 184 166', 600: '13 148 136', 700: '15 118 110',
    800: '17 94 89', 900: '19 78 74',
  },
  cyan: {
    50: '236 254 255', 100: '207 250 254', 200: '165 243 252', 300: '103 232 249',
    400: '34 211 238', 500: '6 182 212', 600: '8 145 178', 700: '14 116 144',
    800: '21 94 117', 900: '22 78 99',
  },
};

const THEME_COLORS: Record<ColorSchemeId, string> = {
  purple: '#7c3aed', violet: '#7c3aed', indigo: '#4f46e5', blue: '#2563eb', sky: '#0284c7',
  fuchsia: '#c026d3', pink: '#db2777', rose: '#e11d48', salmon: '#E66B58', coral: '#FF644A',
  peach: '#F59150', red: '#dc2626', wine: '#722F37', bordeaux: '#800020', rust: '#B4532A',
  orange: '#ea580c', amber: '#d97706', gold: '#CA9A16', yellow: '#ca8a04', tan: '#A0784C',
  beige: '#B9A68B', brown: '#785637', cocoa: '#69482F', olive: '#6B7D3A', white: '#ffffff',
  lime: '#65a30d', green: '#16a34a', emerald: '#059669', teal: '#0d9488', cyan: '#0891b2',
};

const SCHEME_LABELS: Record<ColorSchemeId, string> = {
  purple: 'Fialová', violet: 'Violetová', indigo: 'Indigo', blue: 'Modrá', sky: 'Nebeská',
  fuchsia: 'Fuchsiová', pink: 'Růžová', rose: 'Růžovo-červená', salmon: 'Lososová', coral: 'Korálová',
  peach: 'Broskvová', red: 'Červená', wine: 'Vínová', bordeaux: 'Bordó', rust: 'Rezavá',
  orange: 'Oranžová', amber: 'Jantarová', gold: 'Zlatá', yellow: 'Žlutá', tan: 'Písková',
  beige: 'Béžová', brown: 'Hnědá', cocoa: 'Kakaová', olive: 'Olivová', white: 'Bílá',
  lime: 'Limetková', green: 'Zelená', emerald: 'Smaragdová', teal: 'Tyrkysová', cyan: 'Azurová',
};

/** Světlé barvy — v náhledu potřebují okraj a tmavou fajfku */
const LIGHT_SCHEMES = new Set<ColorSchemeId>(['white', 'beige', 'yellow', 'gold', 'tan', 'peach']);

export const COLOR_SCHEMES: ColorScheme[] = COLOR_SCHEME_ORDER.map((id) => ({
  id,
  label: SCHEME_LABELS[id],
  themeColor: THEME_COLORS[id],
  shades: PALETTES[id],
}));

export function isLightColorScheme(id: ColorSchemeId): boolean {
  return LIGHT_SCHEMES.has(id);
}

export function isValidColorScheme(value: unknown): value is ColorSchemeId {
  return typeof value === 'string' && value in PALETTES;
}

export function getColorScheme(id?: ColorSchemeId | null): ColorScheme {
  const schemeId = id && isValidColorScheme(id) ? id : DEFAULT_COLOR_SCHEME;
  return COLOR_SCHEMES.find((s) => s.id === schemeId) ?? COLOR_SCHEMES[0];
}

export function applyColorScheme(id?: ColorSchemeId | null): void {
  if (typeof id === 'string' && isValidColorScheme(id)) {
    applyBrandColor(getHueFromLegacyColorScheme(id), DEFAULT_BRAND_SHADE);
    return;
  }
  applyBrandColor(DEFAULT_BRAND_HUE, DEFAULT_BRAND_SHADE);
}

export const DEFAULT_BRAND_HUE = 270;
export const DEFAULT_BRAND_SHADE = 50;

export interface BrandColorConfig {
  hue: number;
  shade: number;
}

function clampShade(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BRAND_SHADE;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeHue(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c; g = x;
  } else if (h < 120) {
    r = x; g = c;
  } else if (h < 180) {
    g = c; b = x;
  } else if (h < 240) {
    g = x; b = c;
  } else if (h < 300) {
    r = x; b = c;
  } else {
    r = c; b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function hslToRgbString(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return `${r} ${g} ${b}`;
}

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return DEFAULT_BRAND_HUE;
  const d = max - min;
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6; break;
  }
  return Math.round(h * 360);
}

function rgbStringToHex(rgb: string): string {
  const [r, g, b] = rgb.split(' ').map(Number);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function getHueFromLegacyColorScheme(id: ColorSchemeId): number {
  if (id === 'white') return 0;
  return hexToHue(THEME_COLORS[id]);
}

/** Generuje celou brand paletu z libovolného odstínu na kole (0–360°) a intenzity (0–100). */
export function hueToPalette(hue: number, shadeLevel = DEFAULT_BRAND_SHADE): ColorPalette {
  const t = shadeLevel / 100;

  // Primární tón 600: světlý pastel (0) → sytá tmavá (100)
  const light600 = 64 - t * 38;
  const sat600 = 42 + t * 40;

  const lightOffsets: Record<ColorShade, number> = {
    50: 46,
    100: 40,
    200: 32,
    300: 22,
    400: 12,
    500: 6,
    600: 0,
    700: -8,
    800: -16,
    900: -24,
  };

  const satMultipliers: Record<ColorShade, number> = {
    50: 0.28,
    100: 0.38,
    200: 0.48,
    300: 0.62,
    400: 0.78,
    500: 0.9,
    600: 1,
    700: 0.98,
    800: 0.95,
    900: 0.9,
  };

  const palette = {} as ColorPalette;
  for (const level of SHADES) {
    const s = Math.min(92, Math.max(18, sat600 * satMultipliers[level]));
    const l = Math.min(98, Math.max(6, light600 + lightOffsets[level]));
    palette[level] = hslToRgbString(hue, s, l);
  }
  return palette;
}

export function resolveBrandColor(store: {
  brandHue?: number;
  brandShade?: number;
  colorScheme?: ColorSchemeId | null;
}): BrandColorConfig {
  if (typeof store.brandHue === 'number' && Number.isFinite(store.brandHue)) {
    return { hue: normalizeHue(store.brandHue), shade: clampShade(store.brandShade) };
  }
  if (store.colorScheme && isValidColorScheme(store.colorScheme)) {
    return { hue: getHueFromLegacyColorScheme(store.colorScheme), shade: DEFAULT_BRAND_SHADE };
  }
  return { hue: DEFAULT_BRAND_HUE, shade: DEFAULT_BRAND_SHADE };
}

export function getBrandPreviewColor(hue: number, shade = DEFAULT_BRAND_SHADE): string {
  return rgbStringToHex(hueToPalette(hue, shade)[600]);
}

export function applyBrandColor(hue: number, shade = DEFAULT_BRAND_SHADE): void {
  if (typeof document === 'undefined') return;

  const palette = hueToPalette(hue, shade);
  const root = document.documentElement;
  const themeColor = rgbStringToHex(palette[600]);

  for (const level of SHADES) {
    root.style.setProperty(`--brand-${level}`, palette[level]);
  }

  root.style.setProperty('--brand-theme-color', themeColor);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', themeColor);
  }
}

export function applyStoreBrandColor(store: {
  brandHue?: number;
  brandShade?: number;
  colorScheme?: ColorSchemeId | null;
}): void {
  const { hue, shade } = resolveBrandColor(store);
  applyBrandColor(hue, shade);
}

/** Pro per-store prvky mimo globální CSS vars (např. karty na dashboardu) */
export function getSchemeRgb(id: ColorSchemeId | undefined | null, shade: ColorShade): string {
  const scheme = getColorScheme(id);
  return scheme.shades[shade];
}

export function getSchemePreviewStyle(scheme: ColorScheme): { backgroundColor: string; boxShadow: string } {
  if (isLightColorScheme(scheme.id)) {
    return {
      backgroundColor: scheme.themeColor,
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
    };
  }
  return {
    backgroundColor: scheme.themeColor,
    boxShadow: `0 4px 10px -2px ${scheme.themeColor}55, 0 2px 4px -2px ${scheme.themeColor}33`,
  };
}

export function getBrandGradientStyle(hue: number, shade = DEFAULT_BRAND_SHADE): { background: string } {
  const palette = hueToPalette(hue, shade);
  return { background: `linear-gradient(to bottom right, rgb(${palette[500]}), rgb(${palette[700]}))` };
}

export function getBrandRgb(hue: number, shade: ColorShade, shadeLevel = DEFAULT_BRAND_SHADE): string {
  return hueToPalette(hue, shadeLevel)[shade];
}
