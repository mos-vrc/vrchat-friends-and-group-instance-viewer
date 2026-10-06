import { getLocale } from './i18n.js';

// UI language and browser time zone are independent. Keep API timestamps in UTC.
const messages = Object.freeze({
  ja: Object.freeze({ lastActivity: '最終アクティブ日時' }),
  en: Object.freeze({ lastActivity: 'Last active' }),
});
export function uiText(key, locale = getLocale()) {
  return messages[String(locale).split('-')[0]]?.[key] || messages.ja[key] || '';
}
const formatters = new Map();
export function formatActivityDateTime(value, { locale = getLocale(), timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  // Reject absent, local-time, and invalid values instead of guessing a zone.
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return '';
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return '';
  if (new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) !== value.slice(0, 10) || Number(value.slice(11, 13)) > 23) return '';
  const key = locale + ':' + timeZone;
  if (!formatters.has(key)) {
    if (formatters.size >= 8) formatters.clear();
    formatters.set(key, new Intl.DateTimeFormat(locale, {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  const parts = Object.fromEntries(formatters.get(key).formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
