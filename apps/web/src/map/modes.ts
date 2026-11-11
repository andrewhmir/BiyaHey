import type { Translate } from '../copy';

/** One colour per travel mode. The map, the ribbon and the timeline share it. */
export const MODE_COLORS = {
  walk: '#6b7280',
  jeepney: '#00af5f',
  bus: '#ff4d00',
  mrt3: '#0066eb',
  lrt1: '#0066eb',
  lrt2: '#0066eb',
  ferry: '#0ea5e9',
  'uv-express': '#7c3aed',
  p2p: '#0052bc',
  tricycle: '#d97706',
} as const;

export type ModeKey = keyof typeof MODE_COLORS;

export function modeColor(mode: string): string {
  return MODE_COLORS[mode as ModeKey] ?? '#495057';
}

const MODE_LABEL_KEYS: Record<string, string> = {
  walk: 'mode.walk',
  jeepney: 'mode.jeepney',
  bus: 'mode.bus',
  mrt3: 'mode.mrt3',
  lrt1: 'mode.lrt1',
  lrt2: 'mode.lrt2',
  ferry: 'mode.ferry',
  'uv-express': 'mode.uv-express',
  p2p: 'mode.p2p',
  tricycle: 'mode.tricycle',
};

export function modeLabel(mode: string, t: Translate): string {
  const key = MODE_LABEL_KEYS[mode];
  return key === undefined ? mode : t(key);
}

/** The Maplibre `match` expression that paints each leg by its mode. */
export function modeColorExpression(): unknown[] {
  const pairs = Object.entries(MODE_COLORS).flatMap(([mode, color]) => [mode, color]);
  return ['match', ['get', 'mode'], ...pairs, '#495057'];
}
