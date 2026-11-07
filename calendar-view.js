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

// Personal entries are the add-on's own local schedule (never synced with
// VRChat). They are stored as { id, date: 'YYYY-MM-DD', start: 'HH:MM'|'',
// end: 'HH:MM'|'', title, detail } and converted to the calendar-event
// shape so the grid planning and day grouping can treat them uniformly.
// Missing times mean all-day: the span covers 00:00–23:59 of the date.
export function personalEventAsCalendarEvent(entry) {
  const date = typeof entry?.date === 'string' ? entry.date : '';
  const start = typeof entry?.start === 'string' && entry.start ? entry.start : '00:00';
  const end = typeof entry?.end === 'string' && entry.end ? entry.end : '23:59';
  const startLocal = new Date(`${date}T${start}:00`);
  const endLocal = new Date(`${date}T${end}:00`);
  return {
    id: entry?.id, personal: true, title: entry?.title || '',
    startsAt: Number.isNaN(startLocal.getTime()) ? '' : startLocal.toISOString(),
    endsAt: Number.isNaN(endLocal.getTime()) ? '' : endLocal.toISOString(),
  };
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

const MAX_LANES = 4;

// Plan one week the way the official calendar does: every event — single
// day or spanning — competes for the same horizontal lanes, packed by
// start day and then start time. Each day cell then renders one row per
// lane (the event's segment, or an empty placeholder), so all events in
// the week share the same rows and the same height. Spanning events are
// drawn as one segment per touched day cell; segments bleed into the
// neighbouring cell so they read as one continuous bar, anchored to
// their real day cells instead of overlay positioning.
function planWeek(week, events) {
  const weekStartKey = week[0].key;
  const items = [];
  for (const event of events) {
    const { startKey, endKey } = calendarEventSpan(event);
    if (!startKey) continue;
    const startIdx = dayIndexBetween(weekStartKey, startKey);
    const endIdx = dayIndexBetween(weekStartKey, endKey);
    if (endIdx < 0 || startIdx > 6) continue;
    items.push({
      event,
      from: Math.max(0, startIdx),
      to: Math.min(6, endIdx),
      cutLeft: startIdx < 0,
      cutRight: endIdx > 6,
      lane: -1,
    });
  }
  items.sort((a, b) => a.from - b.from || String(a.event.startsAt).localeCompare(String(b.event.startsAt)));
  const laneEnds = [];
  const overflowByDay = new Map(week.map(day => [day.key, 0]));
  for (const item of items) {
    let lane = laneEnds.findIndex(end => end < item.from);
    if (lane === -1) lane = laneEnds.length;
    if (lane >= MAX_LANES) {
      const key = week[item.from].key;
      overflowByDay.set(key, (overflowByDay.get(key) || 0) + 1);
      continue;
    }
    laneEnds[lane] = item.to;
    item.lane = lane;
  }
  const segmentsByDay = new Map(week.map(day => [day.key, []]));
  for (const item of items) {
    if (item.lane < 0) continue;
    for (let col = item.from; col <= item.to; col += 1) {
      segmentsByDay.get(week[col].key)?.push({
        event: item.event,
        lane: item.lane,
        isStart: col === item.from && !item.cutLeft,
        isEnd: col === item.to && !item.cutRight,
        joinLeft: col > item.from || item.cutLeft,
        joinRight: col < item.to || item.cutRight,
        showTitle: col === item.from,
      });
    }
  }
  return { segmentsByDay, overflowByDay, laneCount: Math.min(laneEnds.length, MAX_LANES) };
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
  const allEvents = [...(view.events || []),
    ...(view.personalEvents || []).map(personalEventAsCalendarEvent)];
  const weeksHtml = weeks.map(week => {
    const { segmentsByDay, overflowByDay, laneCount } = planWeek(week, allEvents);
    const cells = week.map(day => {
      const segments = segmentsByDay.get(day.key) || [];
      const overflow = overflowByDay.get(day.key) || 0;
      const lanesHtml = laneCount ? `<span class="calendar-lanes">${[...Array(laneCount)].map((_, lane) => {
        const segment = segments.find(row => row.lane === lane);
        if (!segment) return '<span class="calendar-lane-empty"></span>';
        return `<span class="calendar-seg${segment.isStart ? ' start' : ''}${segment.isEnd ? ' end' : ''}${segment.joinLeft ? ' join-l' : ''}${segment.joinRight ? ' join-r' : ''}${segment.event.personal ? ' personal' : ''}" ${segment.event.personal ? `data-calendar-personal="${escapeHtml(segment.event.id)}"` : `data-calendar-event="${escapeHtml(segment.event.id)}"`} title="${escapeHtml(segment.event.title || '')}">${segment.showTitle ? escapeHtml(segment.event.title || '') : ''}</span>`;
      }).join('')}${overflow > 0 ? `<span class="calendar-more">+${overflow}</span>` : ''}</span>` : '';
      return `<button type="button" class="calendar-day${day.inMonth ? '' : ' outside'}${day.key === todayKey ? ' today' : ''}${day.key === view.selectedDay ? ' selected' : ''}" data-calendar-day="${day.key}" aria-label="${day.key}">
        <span class="calendar-day-number">${day.date.getDate()}</span>
        ${lanesHtml}
      </button>`;
    }).join('');
    return `<div class="calendar-week">${cells}</div>`;
  }).join('');
  return `<div class="calendar-view">
    <div class="calendar-header">
      <button type="button" class="calendar-nav" data-calendar-nav="prev" aria-label="prev">‹</button>
      <span class="calendar-title">${escapeHtml(monthTitle)}</span>
      <button type="button" class="calendar-nav" data-calendar-nav="next" aria-label="next">›</button>
      <button type="button" class="calendar-today" data-calendar-nav="today">${escapeHtml(t('今日'))}</button>
      <span class="calendar-status" role="status">${status ? escapeHtml(status) : ''}</span>
    </div>
    <div class="calendar-weekdays">${weekdayNames.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</div>
    <div class="calendar-grid">${weeksHtml}</div>
  </div>`;
}

export function renderCalendarDayList({ view, locale }) {
  if (!view.selectedDay) return '';
  const timeFormat = new Intl.DateTimeFormat(locale || undefined, { hour: 'numeric', minute: '2-digit' });
  const vrcRows = (groupCalendarEventsByDay(view.events).get(view.selectedDay) || [])
    .map(event => ({ sortKey: String(event.startsAt || ''), event }));
  const personalRows = (view.personalEvents || [])
    .filter(entry => entry?.date === view.selectedDay)
    .map(entry => ({ sortKey: String(personalEventAsCalendarEvent(entry).startsAt || ''), entry }));
  const rows = [...vrcRows, ...personalRows]
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ event, entry }) => {
      if (entry) {
        const range = !entry.start && !entry.end ? t('終日')
          : `${entry.start || ''}${entry.end ? ` – ${entry.end}` : ''}`;
        return `<button type="button" class="calendar-day-event personal${view.editor?.id === entry.id ? ' selected' : ''}" data-calendar-personal="${escapeHtml(entry.id)}">
      <span class="calendar-day-event-time">${escapeHtml(range)}</span>
      <span class="calendar-day-event-title">${escapeHtml(entry.title || '')}</span>
      <span class="calendar-day-event-meta">${escapeHtml(t('自分の予定'))}</span>
    </button>`;
      }
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
      <a class="calendar-detail-view" href="${escapeHtml(buildCalendarEventPageUrl(event))}" target="_blank" rel="noopener noreferrer">View</a>
    </div>
  </section>`;
}

// Editor for one personal entry, shown in the same floating panel as the
// event detail. entry is null for a new entry on dateKey. app.js reads the
// field values back out of the panel when Save/Delete is clicked.
export function renderCalendarPersonalEditor({ entry, dateKey }) {
  const isNew = !entry?.id;
  const heading = t(isNew ? '予定を追加' : '予定を編集');
  const timeGroup = (group, label, value) => {
    const [h = '', m = ''] = String(value || '').split(':');
    return `<label>${escapeHtml(t(label))}<span class="calendar-personal-time" data-time-group="${group}"><input type="text" class="time-seg" data-time-seg inputmode="numeric" autocomplete="off" placeholder="--" value="${escapeHtml(h)}"><span class="time-sep" aria-hidden="true">:</span><input type="text" class="time-seg" data-time-seg inputmode="numeric" autocomplete="off" placeholder="--" value="${escapeHtml(m)}"><button type="button" class="time-picker-button" data-time-picker tabindex="-1" aria-label="${escapeHtml(t('時刻を選ぶ'))}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></button></span></label>`;
  };
  return `<section class="calendar-detail calendar-personal-editor" aria-label="${escapeHtml(heading)}">
    <div class="calendar-personal-head">
      <h3 class="calendar-detail-title">${escapeHtml(heading)}</h3>
      <button type="button" class="calendar-detail-close" data-calendar-popup-close aria-label="${escapeHtml(t('閉じる'))}">×</button>
    </div>
    <div class="calendar-personal-form">
      <label>${escapeHtml(t('日付'))}<input type="date" id="personalDate" max="9999-12-31" value="${escapeHtml(entry?.date || dateKey || '')}"></label>
      <div class="calendar-personal-times">
        ${timeGroup('start', '開始', entry?.start || '')}
        ${timeGroup('end', '終了', entry?.end || '')}
      </div>
      <label>${escapeHtml(t('タイトル'))}<input type="text" id="personalTitle" value="${escapeHtml(entry?.title || '')}" maxlength="100"></label>
      <label>${escapeHtml(t('詳細'))}<textarea id="personalDetail" rows="3" maxlength="500">${escapeHtml(entry?.detail || '')}</textarea></label>
      <div class="calendar-personal-actions">
        ${isNew ? '' : `<button type="button" class="calendar-personal-delete" data-personal-delete>${escapeHtml(t('削除'))}</button>`}
        <button type="button" class="calendar-personal-save" data-personal-save>${escapeHtml(t('保存'))}</button>
      </div>
    </div>
  </section>`;
}

// Reads one segment group (start or end) back into an 'HH:MM' string.
// Both segments empty means "no time" (an all-day entry); a half-filled
// group is zero-padded on the missing side.
export function personalTimeGroupValue(group) {
  if (!group) return '';
  const segs = group.querySelectorAll('[data-time-seg]');
  const h = (segs[0]?.value || '').replace(/\D/g, '');
  const m = (segs[1]?.value || '').replace(/\D/g, '');
  if (!h && !m) return '';
  return `${(h || '0').padStart(2, '0')}:${(m || '0').padStart(2, '0')}`;
}

// Segmented time entry, following the mainstream time-field design (React
// Aria TimeField, Bit AutoAdvance, Chrome's own segment editor): hour and
// minute are separate segments, and focus advances only when the segment
// being edited cannot take another digit — after two digits, or after one
// digit no second digit could extend (3-9 for hours, 6-9 for minutes,
// coerced to 0X). There is no global keystroke counting, so corrections
// behave: focusing a segment selects its content, typing restarts just that
// segment, Backspace in an empty segment steps back one segment, and a
// pasted run of digits ("2200", "21:05") distributes across the segments.
export function wirePersonalEditorTimeSegments(root) {
  if (!root || root.dataset?.timeSegmentsWired) return;
  if (root.dataset) root.dataset.timeSegmentsWired = '1';
  const segments = () => [...root.querySelectorAll('[data-time-seg]')];
  const segInfo = (seg) => {
    const group = seg.closest('[data-time-group]');
    const inGroup = group ? [...group.querySelectorAll('[data-time-seg]')] : [seg];
    const isMinute = inGroup.indexOf(seg) === 1;
    return { isMinute, max: isMinute ? 59 : 23, firstMax: isMinute ? 5 : 2 };
  };
  const focusSeg = (seg) => { if (seg) { seg.focus(); seg.select?.(); } };
  const stepSeg = (seg, delta) => { const all = segments(); return all[all.indexOf(seg) + delta] || null; };
  // Writes the leading digits of `digits` into seg; returns digits consumed.
  const setSegment = (seg, digits) => {
    const { max, firstMax } = segInfo(seg);
    if (!digits) { seg.value = ''; return 0; }
    const first = Number(digits[0]);
    if (first > firstMax) { seg.value = `0${first}`; return 1; }
    if (digits.length === 1) { seg.value = digits; return 1; }
    if (Number(digits.slice(0, 2)) > max) { seg.value = digits[0]; return 1; }
    seg.value = digits.slice(0, 2); return 2;
  };
  const isComplete = (seg) => seg.value.length === 2;

  root.addEventListener('focusin', (event) => {
    if (event.target?.matches?.('[data-time-seg]')) event.target.select?.();
  });
  root.addEventListener('focusout', (event) => {
    const seg = event.target;
    if (!seg?.matches?.('[data-time-seg]')) return;
    if (seg.value.length === 1) seg.value = seg.value.padStart(2, '0');
  });
  root.addEventListener('input', (event) => {
    const seg = event.target;
    if (!seg?.matches?.('[data-time-seg]')) return;
    const digits = seg.value.replace(/\D/g, '');
    if (digits.length <= 2) {
      // Ordinary typing: a digit the segment rejects (e.g. the 9 in hour 29)
      // is dropped, never handed on to the next segment.
      setSegment(seg, digits);
      if (isComplete(seg)) focusSeg(stepSeg(seg, 1) || seg);
      return;
    }
    // A longer run (paste, or typing into a filled segment): fill this
    // segment, then distribute the rest across the following segments.
    let current = seg;
    let rest = digits;
    while (current && rest) {
      const consumed = setSegment(current, rest);
      if (!consumed) break;
      rest = rest.slice(consumed);
      current = stepSeg(current, 1);
    }
    focusSeg(current || seg);
  });
  const closePickers = () => root.querySelectorAll('.time-picker-list').forEach((list) => list.remove());
  const openPicker = (group) => {
    closePickers();
    const current = personalTimeGroupValue(group);
    const list = document.createElement('div');
    list.className = 'time-picker-list';
    list.setAttribute('role', 'listbox');
    let html = '';
    for (let mins = 0; mins < 24 * 60; mins += 10) {
      const value = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      html += `<button type="button" class="time-picker-item${value === current ? ' selected' : ''}" role="option" data-time-value="${value}" aria-selected="${value === current}">${value}</button>`;
    }
    list.innerHTML = html;
    group.appendChild(list);
    (list.querySelector('.selected') || list.firstElementChild)?.scrollIntoView({ block: 'center' });
  };
  root.addEventListener('click', (event) => {
    const pickerButton = event.target.closest?.('[data-time-picker]');
    if (pickerButton) {
      event.stopPropagation();
      const group = pickerButton.closest('[data-time-group]');
      if (group?.querySelector('.time-picker-list')) closePickers();
      else if (group) openPicker(group);
      return;
    }
    const item = event.target.closest?.('[data-time-value]');
    if (item) {
      // Fully handled here. Propagation must stop: the pick removes the
      // clicked item from the DOM, and if the same click then reaches
      // handlers that test the target's ancestors (the app's outside-click
      // close), the detached target looks like an outside click and the
      // whole editor closes.
      event.stopPropagation();
      const group = item.closest('[data-time-group]');
      const segs = group?.querySelectorAll('[data-time-seg]');
      const [h, m] = (item.dataset.timeValue || '').split(':');
      if (segs?.length === 2 && h && m) { segs[0].value = h; segs[1].value = m; }
      closePickers();
      focusSeg(segs?.[1]);
      return;
    }
    if (!event.target.closest?.('.calendar-personal-time')) closePickers();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePickers();
    const seg = event.target;
    if (!seg?.matches?.('[data-time-seg]')) return;
    if (event.key === 'Backspace' && !seg.value) {
      event.preventDefault();
      focusSeg(stepSeg(seg, -1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const target = stepSeg(seg, event.key === 'ArrowLeft' ? -1 : 1);
      if (target) { event.preventDefault(); focusSeg(target); }
    } else if (event.key === ':' && !segInfo(seg).isMinute) {
      const target = stepSeg(seg, 1);
      if (target) { event.preventDefault(); focusSeg(target); }
    }
  });
}
