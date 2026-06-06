export const BB_UNIT = 100;
export const SB = BB_UNIT / 2;

export function bb(value: number): number {
  return Math.round(value * BB_UNIT);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function formatBb(units: number, signed = false): string {
  const rounded = Math.round((units / BB_UNIT) * 10) / 10;
  const text = rounded.toFixed(1).replace(/\.0$/, "");
  if (!signed) return `${text}bb`;
  return `${rounded >= 0 ? "+" : ""}${text}bb`;
}

export function parseBb(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return bb(parsed);
}

export function toBbNumber(units: number): number {
  return Math.round((units / BB_UNIT) * 100) / 100;
}
