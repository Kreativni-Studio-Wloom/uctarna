export type ColorSchemeId =
  | 'purple'
  | 'violet'
  | 'fuchsia'
  | 'pink'
  | 'rose'
  | 'red'
  | 'orange'
  | 'amber'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo';

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
  red: {
    50: '254 242 242', 100: '254 226 226', 200: '254 202 202', 300: '252 165 165',
    400: '248 113 113', 500: '239 68 68', 600: '220 38 38', 700: '185 28 28',
    800: '153 27 27', 900: '127 29 29',
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
  sky: {
    50: '240 249 255', 100: '224 242 254', 200: '186 230 253', 300: '125 211 252',
    400: '56 189 248', 500: '14 165 233', 600: '2 132 199', 700: '3 105 161',
    800: '7 89 133', 900: '12 74 110',
  },
  blue: {
    50: '239 246 255', 100: '219 234 254', 200: '191 219 254', 300: '147 197 253',
    400: '96 165 250', 500: '59 130 246', 600: '37 99 235', 700: '29 78 216',
    800: '30 64 175', 900: '30 58 138',
  },
  indigo: {
    50: '238 242 255', 100: '224 231 255', 200: '199 210 254', 300: '165 180 252',
    400: '129 140 248', 500: '99 102 241', 600: '79 70 229', 700: '67 56 202',
    800: '55 48 163', 900: '49 46 129',
  },
};

const THEME_COLORS: Record<ColorSchemeId, string> = {
  purple: '#7c3aed', violet: '#7c3aed', fuchsia: '#c026d3', pink: '#db2777',
  rose: '#e11d48', red: '#dc2626', orange: '#ea580c', amber: '#d97706',
  green: '#16a34a', emerald: '#059669', teal: '#0d9488', cyan: '#0891b2',
  sky: '#0284c7', blue: '#2563eb', indigo: '#4f46e5',
};

export const COLOR_SCHEMES: ColorScheme[] = (Object.keys(PALETTES) as ColorSchemeId[]).map((id) => ({
  id,
  label: getSchemeLabel(id),
  themeColor: THEME_COLORS[id],
  shades: PALETTES[id],
}));

function getSchemeLabel(id: ColorSchemeId): string {
  const labels: Record<ColorSchemeId, string> = {
    purple: 'Fialová', violet: 'Violetová', fuchsia: 'Fuchsiová', pink: 'Růžová',
    rose: 'Růžovo-červená', red: 'Červená', orange: 'Oranžová', amber: 'Jantarová',
    green: 'Zelená', emerald: 'Smaragdová', teal: 'Tyrkysová', cyan: 'Azurová',
    sky: 'Nebeská', blue: 'Modrá', indigo: 'Indigo',
  };
  return labels[id];
}

export function isValidColorScheme(value: unknown): value is ColorSchemeId {
  return typeof value === 'string' && value in PALETTES;
}

export function getColorScheme(id?: ColorSchemeId | null): ColorScheme {
  const schemeId = id && isValidColorScheme(id) ? id : DEFAULT_COLOR_SCHEME;
  return COLOR_SCHEMES.find((s) => s.id === schemeId) ?? COLOR_SCHEMES[0];
}

export function applyColorScheme(id?: ColorSchemeId | null): void {
  if (typeof document === 'undefined') return;

  const scheme = getColorScheme(id);
  const root = document.documentElement;

  for (const shade of SHADES) {
    root.style.setProperty(`--brand-${shade}`, scheme.shades[shade]);
  }

  root.style.setProperty('--brand-theme-color', scheme.themeColor);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', scheme.themeColor);
  }
}

/** Pro per-store prvky mimo globální CSS vars (např. karty na dashboardu) */
export function getSchemeRgb(id: ColorSchemeId | undefined | null, shade: ColorShade): string {
  const scheme = getColorScheme(id);
  return scheme.shades[shade];
}

export function getSchemeGradientStyle(
  id: ColorSchemeId | undefined | null,
  fromShade: ColorShade = 500,
  toShade: ColorShade = 700
): { background: string } {
  const from = getSchemeRgb(id, fromShade);
  const to = getSchemeRgb(id, toShade);
  return { background: `linear-gradient(to bottom right, rgb(${from}), rgb(${to}))` };
}
