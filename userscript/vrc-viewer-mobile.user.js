// ==UserScript==
// @name         VRChat Viewer Mobile
// @namespace    https://github.com/mos-vrc/vrchat-friends-and-group-instance-viewer
// @version      0.5.4
// @description  Read-only mobile viewer for VRChat friends and instances, styled after the extension's simple display, with a Favorite+ view (instances where Favorite friends are). Runs on vrchat.com and uses only the site's own login session. No credentials are collected, no writes are performed.
// @match        https://vrchat.com/*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var API = '/api/1';
  var PAGE = 100;
  var MAX_FRIENDS = 1000;
  var MAX_FAVORITES = 2000;
  var DETAIL_CONCURRENCY = 3;

  var C = {
    bg: '#101418', card: '#171c22', border: '#2a2f36', text: '#e8eaed',
    sub: '#9aa0a6', accent: '#1f6feb', chip: '#2a2f36', star: '#e3b341'
  };
  var STATUS_COLORS = {
    'active': '#3fb950', 'join me': '#2f81f7', 'ask me': '#d29922',
    'busy': '#f85149', 'offline': '#6e7681'
  };

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }
  function btnCss() {
    return 'background:' + C.chip + ';color:' + C.text + ';border:1px solid #3c434c;' +
      'border-radius:8px;padding:8px 12px;font-size:14px;';
  }

  // ---------------- state ----------------
  var state = {
    me: null, friends: [], query: '',
    view: 'favplus',           // 'favplus' | 'all'
    favorites: null,           // Set of usr_ ids; null until loaded
    favGroupNames: {},         // usr id -> [group displayName, ...]
    favFailed: false,
    updatedAt: null, loading: false, enriching: false
  };
  var worldCache = {};    // worldId -> {name, thumb, capacity}
  var instanceCache = {}; // location -> {memberCount}

  // ---------------- UI skeleton ----------------
  var panel = el('div',
    'position:fixed;inset:0;z-index:2147483000;background:' + C.bg + ';color:' + C.text + ';' +
    'font:14px/1.5 -apple-system,system-ui,sans-serif;display:none;overflow-y:auto;' +
    '-webkit-overflow-scrolling:touch;padding:12px;padding-bottom:calc(12px + env(safe-area-inset-bottom));box-sizing:border-box;');

  var header = el('div', 'display:flex;align-items:center;gap:6px;');
  header.appendChild(el('div', 'font-size:15px;font-weight:700;', 'フレンド'));
  var meta = el('div',
    'color:' + C.sub + ';font-size:11px;line-height:1.35;white-space:pre-line;margin-left:2px;');
  header.appendChild(meta);
  header.appendChild(el('div', 'flex:1;'));
  var searchBtn = el('button', btnCss() + 'padding:7px 11px;', '🔍');
  var refreshBtn = el('button', btnCss() + 'padding:7px 11px;', '↻');
  var closeBtn = el('button', btnCss() + 'padding:7px 11px;', '✕');
  header.appendChild(searchBtn); header.appendChild(refreshBtn); header.appendChild(closeBtn);
  panel.appendChild(header);

  var viewRow = el('div', 'display:flex;gap:6px;margin:7px 0 0;');
  var favViewBtn = el('button', '', 'Favorite+');
  var allViewBtn = el('button', '', 'すべて');
  viewRow.appendChild(favViewBtn); viewRow.appendChild(allViewBtn);
  panel.appendChild(viewRow);

  function paintViewButtons() {
    [favViewBtn, allViewBtn].forEach(function (b, i) {
      var active = (i === 0) === (state.view === 'favplus');
      b.style.cssText = btnCss() + 'flex:1;padding:6px 10px;font-size:13px;font-weight:' + (active ? '700' : '400') +
        ';background:' + (active ? C.accent : C.chip) + ';color:#fff;';
      if (!active) b.style.color = C.text;
    });
  }
  favViewBtn.addEventListener('click', function () { state.view = 'favplus'; paintViewButtons(); render(); });
  allViewBtn.addEventListener('click', function () { state.view = 'all'; paintViewButtons(); render(); });
  paintViewButtons();

  var searchWrap = el('div', 'display:none;margin:7px 0 0;');
  var search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'フレンド検索';
  // Keep iOS Safari from offering contact AutoFill on this field.
  search.setAttribute('autocomplete', 'off');
  search.setAttribute('autocorrect', 'off');
  search.setAttribute('autocapitalize', 'off');
  search.setAttribute('name', 'vrcv-q-9d2');
  search.setAttribute('enterkeyhint', 'search');
  search.spellcheck = false;
  search.style.cssText = 'width:100%;box-sizing:border-box;background:' + C.card + ';color:' + C.text +
    ';border:1px solid ' + C.border + ';border-radius:8px;padding:9px 10px;font-size:15px;';
  searchWrap.appendChild(search);
  panel.appendChild(searchWrap);

  var status = el('div', 'color:' + C.sub + ';margin:6px 0;white-space:pre-wrap;display:none;');
  panel.appendChild(status);
  function setStatus(text) {
    status.textContent = text || '';
    status.style.display = text ? 'block' : 'none';
  }
  var list = el('div', '');
  panel.appendChild(list);
  panel.appendChild(el('div', 'color:' + C.sub + ';font-size:12px;margin-top:14px;',
    '読み取り専用です。表示はこの端末の中だけで完結し、外部に送信されません。'));
  document.body.appendChild(panel);

  var fab = el('button',
    'position:fixed;right:14px;bottom:calc(20px + env(safe-area-inset-bottom));z-index:2147482999;' +
    'background:' + C.accent + ';color:#fff;border:none;border-radius:999px;padding:12px 16px;' +
    'font-size:15px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.45);', 'フレンド');
  function openPanel() {
    panel.style.display = 'block';
    if (state.loading) return;   // a load is already running; it renders when done
    if (!state.updatedAt) load();
    else render();
  }
  fab.addEventListener('click', openPanel);
  document.body.appendChild(fab);

  // Home-screen shortcut: opening vrchat.com with #vrcviewer in the URL
  // opens the viewer panel immediately. The official site's loading screen
  // redirects through pages that can drop the fragment, so the intent is
  // also kept in sessionStorage for a short window and re-checked a few
  // times after load; whichever page of the chain runs this script first
  // marks it, and the final page opens the panel.
  var AUTO_KEY = 'vrcv-autoopen';
  function markAutoOpen() {
    try { sessionStorage.setItem(AUTO_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }
  function consumeAutoOpen() {
    try {
      var t = Number(sessionStorage.getItem(AUTO_KEY) || 0);
      if (t && Date.now() - t < 60000) {
        sessionStorage.removeItem(AUTO_KEY);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }
  function maybeAutoOpen() {
    if (/#vrcviewer\b/.test(location.hash || '')) {
      markAutoOpen();
      openPanel();
      return;
    }
    if (consumeAutoOpen()) openPanel();
  }
  maybeAutoOpen();
  [800, 2000, 4000].forEach(function (ms) { setTimeout(maybeAutoOpen, ms); });
  window.addEventListener('hashchange', maybeAutoOpen);

  closeBtn.addEventListener('click', function () { panel.style.display = 'none'; });
  refreshBtn.addEventListener('click', load);
  searchBtn.addEventListener('click', function () {
    var open = searchWrap.style.display !== 'none';
    if (open) {
      searchWrap.style.display = 'none';
      search.value = '';
      state.query = '';
      render();
    } else {
      searchWrap.style.display = 'block';
      search.focus();
    }
  });
  search.addEventListener('input', function () {
    state.query = search.value.trim().toLowerCase();
    render();
  });

  // ---------------- API ----------------
  function fetchJson(path) {
    return fetch(API + path, { credentials: 'include', headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        if (r.status === 429) {
          var e = new Error('混み合っています（429）。少し待ってから更新してください。');
          e.status = 429; throw e;
        }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function fetchAllFriends(offline) {
    var all = [];
    function page(offset) {
      return fetchJson('/auth/user/friends?n=' + PAGE + '&offset=' + offset +
        '&offline=' + (offline ? 'true' : 'false') + '&v=2')
        .then(function (rows) {
          rows = rows || [];
          all = all.concat(rows);
          if (rows.length === PAGE && all.length < MAX_FRIENDS) return page(offset + PAGE);
          return all;
        });
    }
    return page(0);
  }

  // Friend favorites: rows {id: fvrt_..., favoriteId: usr_..., tags: ['group_0', ...]}
  // plus group metadata for display names. Same endpoints as the extension.
  function fetchFavorites() {
    var rows = [];
    function page(offset) {
      return fetchJson('/favorites?type=friend&n=' + PAGE + '&offset=' + offset)
        .then(function (items) {
          items = items || [];
          rows = rows.concat(items);
          if (items.length === PAGE && rows.length < MAX_FAVORITES) return page(offset + PAGE);
          return rows;
        });
    }
    return page(0).then(function (favRows) {
      return fetchJson('/favorite/groups?type=friend&n=100&offset=0')
        .catch(function () { return []; })
        .then(function (groups) {
          var groupNames = {};
          (groups || []).forEach(function (g) {
            if (g && g.name) groupNames[g.name] = g.displayName || g.name;
          });
          var ids = new Set(), byUser = {};
          favRows.forEach(function (r) {
            if (!r || typeof r.favoriteId !== 'string' || r.favoriteId.indexOf('usr_') !== 0) return;
            ids.add(r.favoriteId);
            var names = byUser[r.favoriteId] || (byUser[r.favoriteId] = []);
            (Array.isArray(r.tags) ? r.tags : []).forEach(function (tag) {
              var disp = groupNames[tag];
              if (disp && names.indexOf(disp) < 0) names.push(disp);
            });
          });
          return { ids: ids, byUser: byUser };
        });
    });
  }

  function encodeInstancePath(location) {
    var i = location.indexOf(':');
    return encodeURIComponent(location.slice(0, i)) + ':' + encodeURIComponent(location.slice(i + 1));
  }

  function runQueue(jobs, onEach) {
    var idx = 0, active = 0;
    return new Promise(function (resolve) {
      function next() {
        if (idx >= jobs.length && active === 0) { resolve(); return; }
        while (active < DETAIL_CONCURRENCY && idx < jobs.length) {
          var job = jobs[idx++];
          active++;
          job().then(done, done);
        }
      }
      function done() { active--; onEach && onEach(); next(); }
      next();
    });
  }

  // ---------------- domain helpers ----------------
  function parseLocation(loc) {
    if (!loc || loc === 'offline') return { kind: 'offline' };
    if (loc === 'private') return { kind: 'private' };
    if (loc === 'traveling') return { kind: 'traveling' };
    var i = loc.indexOf(':');
    if (i < 0) return { kind: 'unknown' };
    return { kind: 'instance', worldId: loc.slice(0, i), location: loc };
  }

  // Mirrors the extension's classifyPermission (domain.js), display labels only.
  function instanceTypeLabel(location) {
    var rest = location.slice(location.indexOf(':') + 1);
    var ga = /~groupAccessType\(([^)]+)\)/.exec(location);
    if (/~group\(grp_/.test(location) || ga) {
      if (ga && ga[1] === 'public') return 'グループ公開';
      if (ga && ga[1] === 'plus') return 'グループ+';
      return 'グループ';
    }
    if (rest.indexOf('hidden') >= 0) return 'フレンド+';
    if (rest.indexOf('friends') >= 0) return 'フレンドのみ';
    if (rest.indexOf('canRequestInvite') >= 0) return '招待+';
    if (rest.indexOf('private') >= 0) return '招待制';
    return '公開';
  }

  function statusColor(f) {
    var s = String(f.status || f.state || '').toLowerCase();
    if (f.location === 'offline' || s === 'offline') return STATUS_COLORS.offline;
    return STATUS_COLORS[s] || STATUS_COLORS.active;
  }

  function avatarUrl(f) {
    return f.currentAvatarThumbnailImageUrl || f.profilePicOverrideThumbnail ||
      f.currentAvatarImageUrl || '';
  }

  function friendName(f) { return f.displayName || f.username || f.id; }

  function isFav(f) { return Boolean(state.favorites && f.id && state.favorites.has(f.id)); }

  function matches(f) {
    if (!state.query) return true;
    return friendName(f).toLowerCase().indexOf(state.query) >= 0;
  }

  // ---------------- load ----------------
  var renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(function () { renderTimer = null; render(); }, 250);
  }

  function load() {
    if (state.loading) return;
    state.loading = true;
    setStatus('');
    meta.textContent = '読み込み中…';
    var friendsP = fetchJson('/auth/user')
      .then(function (me) {
        state.me = me;
        return fetchAllFriends(false);
      });
    var favP = fetchFavorites()
      .then(function (fav) {
        state.favorites = fav.ids;
        state.favGroupNames = fav.byUser;
        state.favFailed = false;
      })
      .catch(function () {
        state.favorites = state.favorites || new Set();
        state.favFailed = true;
      });
    Promise.all([friendsP, favP])
      .then(function (results) {
        state.friends = results[0];
        state.updatedAt = new Date();
        state.loading = false;
        if (state.view === 'favplus' && (!state.favorites || state.favorites.size === 0)) {
          state.view = 'all';   // nothing to show in Favorite+; fall back gracefully
          paintViewButtons();
        }
        render();
        enrich(state.friends);
      })
      .catch(function (err) {
        state.loading = false;
        meta.textContent = '';
        setStatus('取得できませんでした: ' + String(err && err.message || err) +
          (err && err.status === 429 ? '' : '\nvrchat.com にログインしているか確認してください。'));
      });
  }

  function enrich(friends) {
    if (state.enriching) return;
    var worldJobs = [], instanceJobs = [], seenW = {}, seenI = {};
    friends.forEach(function (f) {
      var p = parseLocation(f.location);
      if (p.kind !== 'instance') return;
      if (!worldCache[p.worldId] && !seenW[p.worldId]) {
        seenW[p.worldId] = true;
        worldJobs.push(function () {
          return fetchJson('/worlds/' + encodeURIComponent(p.worldId))
            .then(function (w) {
              worldCache[p.worldId] = {
                name: w.name || p.worldId,
                thumb: w.thumbnailImageUrl || w.imageUrl || '',
                capacity: typeof w.capacity === 'number' ? w.capacity : null
              };
            })
            .catch(function () { worldCache[p.worldId] = { name: p.worldId, thumb: '', capacity: null }; });
        });
      }
      if (!instanceCache[p.location] && !seenI[p.location]) {
        seenI[p.location] = true;
        instanceJobs.push(function () {
          return fetchJson('/instances/' + encodeInstancePath(p.location))
            .then(function (inst) {
              instanceCache[p.location] = {
                memberCount: typeof inst.memberCount === 'number' ? inst.memberCount : null
              };
            })
            .catch(function () { instanceCache[p.location] = { memberCount: null }; });
        });
      }
    });
    if (!worldJobs.length && !instanceJobs.length) return;
    state.enriching = true;
    runQueue(worldJobs, scheduleRender)
      .then(function () { return runQueue(instanceJobs, scheduleRender); })
      .then(function () { state.enriching = false; render(); });
  }

  // ---------------- render ----------------
  function avatarTile(f) {
    var fav = isFav(f);
    var tile = el('div',
      'position:relative;width:64px;height:64px;border-radius:6px;overflow:hidden;background:' + C.chip + ';flex:none;' +
      (fav ? 'outline:2px solid ' + C.star + ';outline-offset:-2px;' : ''));
    var url = avatarUrl(f);
    if (url) {
      var img = document.createElement('img');
      img.src = url; img.alt = ''; img.loading = 'lazy';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      tile.appendChild(img);
    } else {
      tile.appendChild(el('div',
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;color:' + C.sub + ';',
        friendName(f).slice(0, 1)));
    }
    tile.appendChild(el('span',
      'position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;' +
      'background:' + statusColor(f) + ';border:1.5px solid rgba(8,10,14,.9);box-sizing:border-box;'));
    if (fav) {
      tile.appendChild(el('span',
        'position:absolute;top:0;right:2px;font-size:11px;color:' + C.star + ';text-shadow:0 1px 2px rgba(0,0,0,.9);', '★'));
    }
    tile.appendChild(el('div',
      'position:absolute;left:0;right:0;bottom:0;padding:6px 3px 2px;font-size:10px;font-weight:700;' +
      'color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
      'background:linear-gradient(to bottom,rgba(8,10,14,0),rgba(8,10,14,.82));' +
      'text-shadow:0 1px 2px rgba(0,0,0,.95);', friendName(f)));
    return tile;
  }

  function nameRow(f, withGroup) {
    var row = el('div', 'display:flex;align-items:center;gap:7px;padding:3px 0;min-width:0;');
    row.appendChild(el('span',
      'flex:none;width:8px;height:8px;border-radius:50%;background:' + statusColor(f) + ';'));
    var label = (isFav(f) ? '★ ' : '') + friendName(f);
    row.appendChild(el('span', 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;', label));
    if (withGroup) {
      var groups = state.favGroupNames[f.id] || [];
      if (groups.length) {
        row.appendChild(el('span',
          'color:' + C.sub + ';font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
          groups.join(' / ')));
      }
    }
    return row;
  }

  function instanceBox(loc, g, favCount) {
    var w = worldCache[g.worldId];
    var inst = instanceCache[loc] || {};
    var box = el('div', 'padding:10px 2px 12px;border-bottom:1px solid ' + C.border + ';');
    var head = el('div', 'display:flex;gap:10px;align-items:center;');
    if (w && w.thumb) {
      var img = document.createElement('img');
      img.src = w.thumb; img.alt = ''; img.loading = 'lazy';
      img.style.cssText = 'flex:none;width:76px;height:57px;border-radius:6px;object-fit:cover;background:' + C.chip + ';';
      head.appendChild(img);
    }
    var ht = el('div', 'min-width:0;flex:1;');
    ht.appendChild(el('div',
      'font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      w ? w.name : g.worldId));
    var parts = [String(g.members.length)];
    if (typeof inst.memberCount === 'number') parts.push(String(inst.memberCount));
    if (w && typeof w.capacity === 'number') parts.push(String(w.capacity));
    var sub = instanceTypeLabel(loc) + ' ・ ' + parts.join(' / ');
    if (typeof favCount === 'number') sub += ' ・ Favorite ' + favCount + '人';
    ht.appendChild(el('div', 'color:' + C.sub + ';font-size:12px;margin-top:1px;', sub));
    head.appendChild(ht);
    box.appendChild(head);
    var grid = el('div', 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;');
    g.members.forEach(function (f) { grid.appendChild(avatarTile(f)); });
    box.appendChild(grid);
    return box;
  }

  function sectionBox(title, rows, withGroup) {
    var box = el('div', 'padding:10px 2px 12px;border-bottom:1px solid ' + C.border + ';');
    box.appendChild(el('div', 'font-weight:700;margin-bottom:3px;', title));
    rows.forEach(function (f) { box.appendChild(nameRow(f, withGroup)); });
    return box;
  }

  function groupByLocation(friends) {
    var groups = {}, privates = [], traveling = [], offlines = [], shown = 0;
    friends.forEach(function (f) {
      if (!matches(f)) return;
      var p = parseLocation(f.location);
      if (p.kind === 'instance') {
        (groups[p.location] = groups[p.location] || { worldId: p.worldId, members: [] }).members.push(f);
      } else if (p.kind === 'private') privates.push(f);
      else if (p.kind === 'traveling') traveling.push(f);
      else if (p.kind === 'offline') offlines.push(f);
      shown++;
    });
    return { groups: groups, privates: privates, traveling: traveling, offlines: offlines, shown: shown };
  }

  function render() {
    list.textContent = '';
    var friends = state.friends;
    var onlineCount = friends.filter(function (f) { return f.location !== 'offline'; }).length;
    meta.textContent =
      'オンライン ' + onlineCount + '人' +
      (state.updatedAt ? '\n' + state.updatedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) + ' 更新' : '') +
      (state.enriching ? ' ・ 詳細取得中' : '');
    setStatus(state.favFailed
      ? 'Favorite の取得に失敗しました。「すべて」表示のみ利用できます。'
      : '');
    if (state.view === 'favplus' && state.favorites && state.favorites.size) renderFavPlus(friends);
    else renderAll(friends);
  }

  // Favorite+: instances where at least one Favorite friend currently is
  // (same rule as the extension: exact location match; owner does not count),
  // then Favorite friends who are in private / traveling.
  function renderFavPlus(friends) {
    var parts = groupByLocation(friends);
    var favInstances = Object.keys(parts.groups).map(function (loc) {
      var g = parts.groups[loc];
      var favs = g.members.filter(isFav);
      return { loc: loc, group: g, favCount: favs.length };
    }).filter(function (x) { return x.favCount > 0; });
    favInstances.sort(function (a, b) {
      return b.favCount - a.favCount || b.group.members.length - a.group.members.length;
    });
    favInstances.forEach(function (x) { list.appendChild(instanceBox(x.loc, x.group, x.favCount)); });

    var favPrivates = parts.privates.filter(isFav);
    var favTraveling = parts.traveling.filter(isFav);
    if (favPrivates.length) list.appendChild(sectionBox('プライベートの Favorite（' + favPrivates.length + '人）', favPrivates, true));
    if (favTraveling.length) list.appendChild(sectionBox('移動中の Favorite（' + favTraveling.length + '人）', favTraveling, true));

    if (!favInstances.length && !favPrivates.length && !favTraveling.length && !state.loading) {
      list.appendChild(el('div', 'color:' + C.sub + ';padding:12px 0;',
        state.query ? '絞り込みに合う Favorite フレンドがいません。'
          : '今オンラインの Favorite フレンドはいません。'));
    }
  }

  function renderAll(friends) {
    var parts = groupByLocation(friends);
    Object.keys(parts.groups).sort(function (a, b) {
      return parts.groups[b].members.length - parts.groups[a].members.length;
    }).forEach(function (loc) { list.appendChild(instanceBox(loc, parts.groups[loc], null)); });

    [['プライベート', parts.privates], ['移動中', parts.traveling], ['オフライン', parts.offlines]]
      .forEach(function (pair) {
        if (pair[1].length) list.appendChild(sectionBox(pair[0] + '（' + pair[1].length + '人）', pair[1], false));
      });

    if (!parts.shown && !state.loading) {
      list.appendChild(el('div', 'color:' + C.sub + ';padding:12px 0;',
        state.query ? '絞り込みに合うフレンドがいません。' : '表示できるフレンドがいません。'));
    }
  }
})();
