import { getLocale } from './i18n.js';

// UI language and browser time zone are independent. Keep API timestamps in UTC.
const messages = Object.freeze({
  ja: Object.freeze({ lastActivity: '最終アクティブ日時' }),
  en: Object.freeze({ lastActivity: 'Last active' }),
});
export function uiText(key, locale = getLocale()) {
  return messages[String(locale).split('-')[0]]?.[key] || messages.ja[key] || '';
}
// Some fonts shape a digit + U+2044 FRACTION SLASH + digit sequence into a
// diagonal fraction (small superscript/subscript digits), which makes dates
// inside notification text hard to read. Normalize fraction-style glyphs to
// plain digits and "/" for display only; stored/API text is never changed.
const vulgarFractions = Object.freeze({ '¼': '1/4', '½': '1/2', '¾': '3/4', '⅐': '1/7', '⅑': '1/9', '⅒': '1/10', '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '↉': '0/3' });
const superscriptDigits = Object.freeze({ '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' });
const subscriptDigits = Object.freeze({ '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' });
export function normalizeFractionGlyphs(value) {
  if (typeof value !== 'string' || !value) return value;
  return value
    .replace(/[⁄∕]/g, '/')
    .replace(/[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞↉]/g, ch => vulgarFractions[ch])
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, ch => superscriptDigits[ch])
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, ch => subscriptDigits[ch]);
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
