import { escapeHtml } from './domain.js';
import { t } from './i18n.js';

// Calendar (group events) month view. Pure markup and date helpers; data
// fetching and UI lifetime stay in app.js / api.js, mirroring
// notification-view.js. Event objects follow the VRChat CalendarEvent
// schema (startsAt/endsAt ISO strings, ownerId = the hosting group).

export function calendarDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Six Sunday-start weeks covering the given month, including the spill-over
// days from the neighbouring months.
export function calendarMonthMatrix(year, monthIndex) {
  const first = new Date(year, monthIndex, 1);
  const start = new Date(year, monthIndex, 1 - first.getDay());
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      week.push({ date, inMonth: date.getMonth() === monthIndex });
    }
    weeks.push(week);
  }
  return weeks;
}

export function calendarEventDayKey(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : calendarDayKey(date);
}

export function groupCalendarEventsByDay(events) {
  const byDay = new Map();
  for (const event of events || []) {
    const key = calendarEventDayKey(event?.startsAt);
    if (!key) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  return byDay;
}

// Event page on the official site (same shape as the links VRChat itself
// shares: /home/group/{groupId}/calendar/{calendarId}). Falls back to the
// calendar top page when an event does not carry both ids.
export function buildCalendarEventPageUrl(event) {
  const owner = typeof event?.ownerId === 'string' ? event.ownerId : '';
  const id = typeof event?.id === 'string' ? event.id : '';
  if (owner.startsWith('grp_') && id.startsWith('cal_')) {
    return `https://vrchat.com/home/group/${encodeURIComponent(owner)}/calendar/${encodeURIComponent(id)}`;
  }
  return 'https://vrchat.com/home/calendar';
}

const CATEGORY_LABELS = Object.freeze({
  arts: 'Arts', avatars: 'Avatars', dance: 'Dance', education: 'Education',
  exploration: 'Exploration', film_media: 'Film & Media', gaming: 'Gaming',
  hangout: 'Hangout', music: 'Music', other: 'Other', performance: 'Performance',
  roleplaying: 'Roleplaying', wellness: 'Wellness',
});

export function calendarCategoryLabel(category) {
  return CATEGORY_LABELS[category] || 'Other';
}

export function calendarAccessLabel(accessType) {
  return accessType === 'group' ? 'Group' : 'Public';
}

export function calendarIsRecurring(event) {
  return Boolean(event?.seriesId) || event?.occurrenceKind === 'series' || event?.occurrenceKind === 'occurrence';
}

function timeRangeText(event, locale) {
  const start = new Date(event?.startsAt);
  const end = new Date(event?.endsAt);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  if (Number.isNaN(start.getTime())) return '';
  if (Number.isNaN(end.getTime())) return time.format(start);
  return `${time.format(start)}–${time.format(end)}`;
}

export function renderCalendarMonth({ view, locale }) {
  const cursor = view.cursor;
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthTitle = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(cursor);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const weekdayNames = Array.from({ length: 7 }, (_, i) => weekday.format(new Date(2024, 0, 7 + i)));
  const byDay = groupCalendarEventsByDay(view.events);
  const todayKey = calendarDayKey(new Date());
  const status = view.loading
    ? t('取得中…')
    : view.error
      ? t('イベントを取得できませんでした。更新ボタンで再取得してください。')
      : view.partial
        ? t('一部取得失敗')
        : view.ready && !view.events.length
          ? t('この月のイベントはありません。')
          : '';
  const weeks = calendarMonthMatrix(year, month).map((week) => `<div class="calendar-week">${week.map(({ date, inMonth }) => {
    const key = calendarDayKey(date);
    const dayEvents = byDay.get(key) || [];
    const chips = dayEvents.slice(0, 3).map((event) => `<span class="calendar-chip">${escapeHtml(event.title || '')}</span>`).join('');
    const more = dayEvents.length > 3 ? `<span class="calendar-more">+${dayEvents.length - 3}</span>` : '';
    const classes = ['calendar-day', inMonth ? '' : 'calendar-day-outside', key === todayKey ? 'calendar-day-today' : '', key === view.selectedDay ? 'calendar-day-selected' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-calendar-day="${key}" aria-label="${key}"><span class="calendar-day-number">${date.getDate()}</span>${chips}${more}</button>`;
  }).join('')}</div>`).join('');
  const selectedEvents = view.selectedDay ? (byDay.get(view.selectedDay) || []) : [];
  const selectedHeading = view.selectedDay
    ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${view.selectedDay}T12:00:00`))
    : '';
  const dayList = view.selectedDay ? `<section class="calendar-day-list" aria-label="${escapeHtml(selectedHeading)}">
    <h3>${escapeHtml(selectedHeading)}</h3>
    ${selectedEvents.length ? selectedEvents.map((event) => {
      const group = view.groups.get(event.ownerId);
      return `<button type="button" class="calendar-event-row" data-calendar-event="${escapeHtml(event.id)}">
        <span class="calendar-event-time">${escapeHtml(timeRangeText(event, locale))}</span>
        <span class="calendar-event-title">${escapeHtml(event.title || '')}</span>
        <span class="calendar-event-meta">${escapeHtml(calendarCategoryLabel(event.category))}${group?.name ? ` ・ ${escapeHtml(group.name)}` : ''}</span>
      </button>`;
    }).join('') : `<div class="calendar-day-empty">${escapeHtml(t('この日のイベントはありません。'))}</div>`}
  </section>` : '';
  return `<section class="calendar-view" aria-label="${escapeHtml(t('イベントカレンダー'))}">
    <div class="calendar-header">
      <button type="button" class="calendar-nav" data-calendar-nav="prev" aria-label="prev">‹</button>
      <h2 class="calendar-title">${escapeHtml(monthTitle)}</h2>
      <button type="button" class="calendar-nav" data-calendar-nav="next" aria-label="next">›</button>
      <button type="button" class="calendar-today" data-calendar-nav="today">${escapeHtml(t('今日'))}</button>
    </div>
    <div class="calendar-status" role="status">${status ? escapeHtml(status) : ''}</div>
    <div class="calendar-week calendar-week-head">${weekdayNames.map((name) => `<span class="calendar-weekday">${escapeHtml(name)}</span>`).join('')}</div>
    ${weeks}
    ${dayList}
  </section>`;
}

export function renderCalendarEventPopup({ event, group, displayImageUrl, locale }) {
  const start = new Date(event?.startsAt);
  const dateText = Number.isNaN(start.getTime())
    ? ''
    : `${new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(start)} ${new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(start)}`;
  const imageUrl = event?.imageUrl ? displayImageUrl(event.imageUrl, 'world') : '';
  const groupIcon = group?.iconUrl ? displayImageUrl(group.iconUrl, 'avatar') : '';
  const interested = Number(event?.interestedUserCount) || 0;
  const interestedFriends = Number(event?.interestedFriendCount) || 0;
  return `<div class="calendar-popup-card">
    <div class="calendar-popup-media">
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy">` : ''}
      <span class="calendar-popup-category">${escapeHtml(calendarCategoryLabel(event?.category))}</span>
      <button type="button" class="calendar-popup-close" data-calendar-popup-close aria-label="${escapeHtml(t('閉じる'))}">×</button>
    </div>
    <div class="calendar-popup-body">
      <h3 class="calendar-popup-title">${escapeHtml(event?.title || '')}</h3>
      <div class="calendar-popup-group">
        ${groupIcon ? `<img src="${escapeHtml(groupIcon)}" alt="" loading="lazy">` : '<span class="calendar-popup-group-icon" aria-hidden="true"></span>'}
        <span>${escapeHtml(group?.name || t('グループ'))}</span>
      </div>
      <div class="calendar-popup-when">${calendarIsRecurring(event) ? '<span class="calendar-popup-recur" aria-hidden="true">↻</span> ' : ''}${escapeHtml(dateText)} | ${escapeHtml(calendarAccessLabel(event?.accessType))}</div>
      ${event?.description ? `<p class="calendar-popup-desc">${escapeHtml(event.description)}</p>` : ''}
      ${interested || interestedFriends ? `<div class="calendar-popup-interest">${escapeHtml(t('興味あり'))}: ${interested}${interestedFriends ? ` (${escapeHtml(t('フレンド'))} ${interestedFriends})` : ''}</div>` : ''}
      <a class="calendar-popup-view" href="${escapeHtml(buildCalendarEventPageUrl(event))}" target="_blank" rel="noopener noreferrer">View</a>
    </div>
  </div>`;
}
