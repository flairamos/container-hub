import { createHash } from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncate(value, maxLength) {
  const chars = Array.from(String(value || '').trim());
  if (chars.length <= maxLength) return chars.join('');
  return `${chars.slice(0, maxLength).join('')}…`;
}

export function log(scope, message) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] [${scope}] ${message}`);
}

export function warn(scope, message) {
  const time = new Date().toISOString().slice(11, 19);
  console.warn(`[${time}] [${scope}] ${message}`);
}

export function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

export function isRecent(iso, days) {
  if (!iso) return false;
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}
