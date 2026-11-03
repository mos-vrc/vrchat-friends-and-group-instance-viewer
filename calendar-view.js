// Event calendar: pure render helpers for the month grid, the selected
// day's event list, and the event detail panel. No DOM access and no
// fetching here; app.js owns state and passes plain data in.
import { escapeHtml } from './domain.js';
import { t } from './i18n.js';

const CATEGORY_LABELS = {
  arts: 'Arts',
  avatars: 'Avatars',
  dance: 'Dance',
  education: 'Education',
  exploration: 'Exploration',
  film_media: 'Film & Media',
  gaming: 'Gaming',
  hangout: 'Hangout',
  music: 'Music',
  other: 'Other',
  performance: 'Performance',
  roleplaying: 'Roleplaying',
  wellness: 'Wellness',
};

export function calendarDayKey(date) {
  const local = new Date(date);
  if (Number.isNaN(local.getTime())) return '';
  const month = String(local.getMonth() + 1).padStart(2, '0');
  const day = String(local.getDate()).padStart(2, '0');
  return `${local.getFullYear()}-${month}-${day}`;
}

// Six Sunday-start weeks covering the given month, including spill-over
// days from the neighbouring months.
export function calendarMonthMatrix(cursor) {
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      week.push({ date, key: calendarDayKey(date), inMonth: date.getMonth() === month });
    }
    weeks.push(week);
  }
  return weeks;
}

export function calendarEventDayKey(event) {
  return calendarDayKey(event?.startsAt);
}

// The local days an event touches. The end day uses endsAt minus a
// millisecond so an event ending exactly at midnight does not spill.
export function calendarEventSpan(event) {
  const startKey = calendarEventDayKey(event);
  const endMs = Date.parse(event?.endsAt || '');
  const endKey = Number.isNaN(endMs) ? startKey : calendarDayKey(new Date(endMs - 1));
  return { startKey, endKey: endKey < startKey ? startKey : endKey };
}

function dayIndexBetween(fromKey, toKey) {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function groupCalendarEventsByDay(events) {
  const byDay = new Map();
  for (const event of events || []) {
    const key = calendarEventDayKey(event);
    if (!key) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  return byDay;
}

// The official event page lives under the owning group's calendar.
// Anything unexpected falls back to the official calendar top page.
export function buildCalendarEventPageUrl(event) {
  const groupId = typeof event?.ownerId === 'string' ? event.ownerId : '';
  const eventId = typeof event?.id === 'string' ? event.id : '';
  if (groupId.startsWith('grp_') && eventId.startsWith('cal_')) {
    return `https://vrchat.com/home/group/${encodeURIComponent(groupId)}/calendar/${encodeURIComponent(eventId)}`;
  }
  return 'https://vrchat.com/home/calendar';
}

export function calendarCategoryLabel(category) {
  return CATEGORY_LABELS[category] || CATEGORY_LABELS.other;
}

export function calendarAccessLabel(accessType) {
  return accessType === 'group' ? 'Group' : 'Public';
}

export function calendarIsRecurring(event) {
  return Boolean(event?.seriesId) || event?.occurrenceKind === 'series' || event?.occurrenceKind === 'occurrence';
}

const MAX_BAR_LANES = 3;

// Split one week's events into spanning bars (multi-day events, drawn
// across the day cells like the official calendar) and per-day chips.
function planWeek(week, events) {
  const weekStartKey = week[0].key;
  const bars = [];
  const chipsByDay = new Map(week.map(day => [day.key, []]));
  for (const event of events) {
    const { startKey, endKey } = calendarEventSpan(event);
    if (!startKey) continue;
    const startIdx = dayIndexBetween(weekStartKey, startKey);
    const endIdx = dayIndexBetween(weekStartKey, endKey);
    if (endIdx < 0 || startIdx > 6) continue;
    const from = Math.max(0, startIdx), to = Math.min(6, endIdx);
    if (to > from || startIdx < 0) bars.push({ event, from, to });
    else chipsByDay.get(week[startIdx].key)?.push(event);
  }
  bars.sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from));
  const laneEnds = [];
  for (const bar of bars) {
    let lane = laneEnds.findIndex(end => end < bar.from);
    if (lane === -1) lane = laneEnds.length;
    if (lane >= MAX_BAR_LANES) {
      // No free lane: fall back to a chip on the first visible day.
      chipsByDay.get(week[bar.from].key)?.push(bar.event);
      bar.lane = -1;
      continue;
    }
    laneEnds[lane] = bar.to;
    bar.lane = lane;
  }
  const visibleBars = bars.filter(bar => bar.lane >= 0);
  for (const chips of chipsByDay.values()) {
    chips.sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  }
  return { bars: visibleBars, chipsByDay, laneCount: Math.min(laneEnds.length, MAX_BAR_LANES) };
}

export function renderCalendarMonth({ view, locale }) {
  const weeks = calendarMonthMatrix(view.cursor);
  const todayKey = calendarDayKey(new Date());
  const monthTitle = new Intl.DateTimeFormat(locale || undefined, { year: 'numeric', month: 'long' }).format(view.cursor);
  const weekdayNames = [...Array(7)].map((_, i) =>
    new Intl.DateTimeFormat(locale || undefined, { weekday: 'short' }).format(new Date(2024, 0, 7 + i)));
  const status = view.loading ? t('取得中…')
    : view.error ? t('イベントを取得できませんでした。更新ボタンで再取得してください。')
    : view.partial ? t('一部取得失敗')
    : (view.ready && !view.events.length) ? t('この月のイベントはありません。')
    : '';
  const weeksHtml = weeks.map(week => {
    const { bars, chipsByDay, laneCount } = planWeek(week, view.events);
    const cells = week.map(day => {
      const chips = chipsByDay.get(day.key) || [];
      const shown = chips.slice(0, 3);
      const more = chips.length - shown.length;
      return `<button type="button" class="calendar-day${day.inMonth ? '' : ' outside'}${day.key === todayKey ? ' today' : ''}${day.key === view.selectedDay ? ' selected' : ''}" data-calendar-day="${day.key}" aria-label="${day.key}">
        <span class="calendar-day-number">${day.date.getDate()}</span>
        <span class="calendar-day-chips">${shown.map(event =>
          `<span class="calendar-chip" data-calendar-event="${escapeHtml(event.id)}" title="${escapeHtml(event.title || '')}">${escapeHtml(event.title || '')}</span>`).join('')}${more > 0 ? `<span class="calendar-more">+${more}</span>` : ''}</span>
      </button>`;
    }).join('');
    const barsHtml = bars.map(bar => {
      const span = bar.to - bar.from + 1;
      return `<button type="button" class="calendar-bar" data-calendar-event="${escapeHtml(bar.event.id)}" title="${escapeHtml(bar.event.title || '')}" style="left:calc((100% / 7) * ${bar.from} + 3px);width:calc((100% / 7) * ${span} - 6px);top:${26 + bar.lane * 22}px">${escapeHtml(bar.event.title || '')}</button>`;
    }).join('');
    return `<div class="calendar-week" style="--bar-lanes:${laneCount}">${cells}<div class="calendar-bars">${barsHtml}</div></div>`;
  }).join('');
  return `<div class="calendar-view">
    <div class="calendar-header">
      <button type="button" class="calendar-nav" data-calendar-nav="prev" aria-label="prev">‹</button>
      <span class="calendar-title">${escapeHtml(monthTitle)}</span>
      <button type="button" class="calendar-nav" data-calendar-nav="next" aria-label="next">›</button>
      <button type="button" class="calendar-today" data-calendar-nav="today">${escapeHtml(t('今日'))}</button>
    </div>
    <div class="calendar-status" role="status">${status ? escapeHtml(status) : ''}</div>
    <div class="calendar-weekdays">${weekdayNames.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</div>
    <div class="calendar-grid">${weeksHtml}</div>
  </div>`;
}

export function renderCalendarDayList({ view, locale }) {
  if (!view.selectedDay) return '';
  const dayEvents = groupCalendarEventsByDay(view.events).get(view.selectedDay) || [];
  const timeFormat = new Intl.DateTimeFormat(locale || undefined, { hour: 'numeric', minute: '2-digit' });
  const rows = dayEvents.map(event => {
    const start = new Date(event.startsAt), end = new Date(event.endsAt);
    const range = Number.isNaN(start.getTime()) ? ''
      : `${timeFormat.format(start)}${Number.isNaN(end.getTime()) ? '' : ` – ${timeFormat.format(end)}`}`;
    const group = view.groups.get(event.ownerId);
    return `<button type="button" class="calendar-day-event${event.id === view.selectedEventId ? ' selected' : ''}" data-calendar-event="${escapeHtml(event.id)}">
      <span class="calendar-day-event-time">${escapeHtml(range)}</span>
      <span class="calendar-day-event-title">${escapeHtml(event.title || '')}</span>
      <span class="calendar-day-event-meta">${escapeHtml(calendarCategoryLabel(event.category))}${group?.name ? ` ・ ${escapeHtml(group.name)}` : ''}</span>
    </button>`;
  }).join('');
  return `<section class="calendar-day-list" aria-label="${escapeHtml(view.selectedDay)}">
    <h3 class="calendar-day-list-title">${escapeHtml(view.selectedDay)}</h3>
    ${rows || `<p class="calendar-empty">${escapeHtml(t('この日のイベントはありません。'))}</p>`}
  </section>`;
}

export function renderCalendarEventDetail({ event, group, detailImageUrl, locale }) {
  if (!event) return '';
  const start = new Date(event.startsAt);
  const dateText = Number.isNaN(start.getTime()) ? ''
    : new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(start);
  const metaLine = `${calendarIsRecurring(event) ? '↻ ' : ''}${dateText} | ${calendarAccessLabel(event.accessType)}`;
  const interested = [];
  if (event.interestedUserCount > 0) interested.push(`${t('興味あり')} ${event.interestedUserCount}`);
  if (event.interestedFriendCount > 0) interested.push(`${t('フレンド')} ${event.interestedFriendCount}`);
  return `<section class="calendar-detail" aria-label="${escapeHtml(t('イベント詳細'))}">
    <div class="calendar-detail-media">
      ${detailImageUrl ? `<img data-image-src="${escapeHtml(detailImageUrl)}" alt="">` : ''}
      <span class="calendar-detail-category">${escapeHtml(calendarCategoryLabel(event.category))}</span>
      <button type="button" class="calendar-detail-close" data-calendar-popup-close aria-label="${escapeHtml(t('閉じる'))}">×</button>
    </div>
    <div class="calendar-detail-body">
      <h3 class="calendar-detail-title">${escapeHtml(event.title || '')}</h3>
      <div class="calendar-detail-group">${group?.iconUrl ? `<img data-image-src="${escapeHtml(group.iconUrl)}" alt="">` : ''}<span>${escapeHtml(group?.name || t('グループ'))}</span></div>
      <div class="calendar-detail-meta">${escapeHtml(metaLine)}</div>
      ${event.description ? `<p class="calendar-detail-description">${escapeHtml(event.description)}</p>` : ''}
      ${interested.length ? `<div class="calendar-detail-interested">${escapeHtml(interested.join(' ・ '))}</div>` : ''}
      <a class="calendar-detail-view" href="${escapeHtml(buildCalendarEventPageUrl(event))}" target="_blank" rel="noopener noreferrer">View</a>
    </div>
  </section>`;
}
