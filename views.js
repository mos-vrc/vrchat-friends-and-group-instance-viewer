import {readFailureMessage} from "./ui-feedback.js";
import {worldPlatforms, worldIsUnavailable} from "./world-catalog.js";
import {t, lt} from "./i18n.js";
import {formatActivityDateTime, uiText} from "./ui-format.js";
import {CONFIG, PERMISSIONS, TABS} from "./config.js";
import {classifyPermission, effectiveInstanceUserCount, escapeHtml, friendIsOnline, friendStateText, instanceOwnerId, nonFriendOwnerForEntry, onlineStatusInfo, permissionBadgeClass, permissionLabel, participantsForEntry, resolveFriendLocation, regionLabel, sortParticipants, uniqueUsers} from "./domain.js";

// Markup and display grouping. Reads current state; API writes stay in app.js.
export function createViews({
  FRIEND_VIEW_SORTS,
  VIEW_MODES,
  compareFriendNames,
  compareOfflineFriends,
  displayImageUrl,
  elements,
  friendAvatarUrl,
  friendMap,
  instanceIsHighlighted,
  limitedMarkup,
  needsHydration,
  getInstanceRetryState = () => ({pending:false,attempts:0}),
  renderFavoriteActionButton,
  renderFramedAvatar,
  renderWorldFavoriteButton,
  state,
  getRepository,
  getWorldFavorites,
  getWorldCatalog,
  getWorldView
}) {
  let renderedInstanceIndex = null;

  function renderFriendSidebarLocationThumbnail(friend) {
    const status = onlineStatusInfo(friend);
    const location = resolveFriendLocation(friend);
    const entry = reverseEntryForFriend(friend);
    const permission = entry?.permission || classifyPermission(location);
    const isWebsite = status.className === 'online-website';
    const isPrivate = permission === PERMISSIONS.PRIVATE || location === 'private';
    const permissionClass = permissionBadgeClass(permission);

    const worldName = friendLocationLabel(friend, entry);
    const groupName = entry?.groupName || entry?.instanceData?.group?.name || entry?.instanceData?.groupName || '';
    const locationTitle = groupName ? `${worldName} / ${groupName}` : worldName;

    let countText = '';
    if (entry && !isPrivate && !isWebsite) {
      const userCount = effectiveInstanceUserCount(entry, friendMap());
      const capacity = entry.world?.capacity ?? entry.capacity ?? entry.world?.hardCapacity;
      const friendCount = uniqueUsers(entry.friends).length;
      countText = `${friendCount}/${userCount}/${Number.isFinite(capacity) ? capacity : '-'}`;
    }

    const thumb = entry && !isPrivate && !isWebsite
      ? displayImageUrl(entry.world?.thumbnailImageUrl || entry.instanceData?.world?.thumbnailImageUrl || entry.instanceData?.world?.imageUrl || '', 'world')
      : '';
    const thumbContent = thumb
      ? `<img class="friend-sidebar-location-thumb-image" data-image-src="${escapeHtml(thumb)}" loading="lazy" decoding="async" alt="">`
      : `<div class="friend-sidebar-location-thumb-placeholder friend-location-thumb-placeholder">${renderFriendLocationPlaceholderIcon({ isPrivate, isWebsite })}</div>`;
    const statusText = isWebsite
      ? 'OtherPlatform'
      : isPrivate
        ? 'Private'
        : permissionLabel(permission);

    return `
    <div class="friend-sidebar-location-thumb" title="${escapeHtml(locationTitle)}">
      ${thumbContent}
      <div class="friend-sidebar-location-meta">
        <span class="friend-state friend-sidebar-location-status ${permissionClass}">${escapeHtml(statusText)}</span>
        ${countText ? lt`<span class="friend-sidebar-location-count" title="フレンド数 / 参加人数 / 最大人数">${escapeHtml(countText)}</span>` : ''}
      </div>
      <div class="friend-sidebar-location-title">${escapeHtml(locationTitle)}</div>
    </div>`;
  }

  function renderFriendSidebarItem(friend) {
    const name = friend.displayName || friend.username || friend.id;
    const status = onlineStatusInfo(friend);
    const location = resolveFriendLocation(friend);
    const entry = reverseEntryForFriend(friend);
    const permission = entry?.permission || classifyPermission(location);
    const isWebsite = status.className === 'online-website';
    const isPrivate = permission === PERMISSIONS.PRIVATE || location === 'private';
    const avatarUrl = friendAvatarUrl(friend);
    const avatar = avatarUrl
      ? `<img class="friend-avatar avatar-fallback" data-image-src="${escapeHtml(avatarUrl)}" loading="lazy" decoding="async" alt="">`
      : '<img class="friend-avatar avatar-fallback" src="user-placeholder.svg" alt="" decoding="async">';
    const showLocation = state.sidebarMode === 'location';
    const locationData = !isWebsite && !isPrivate && location && location !== 'offline'
      ? ` data-location="${escapeHtml(entry?.location || location)}"`
      : '';
    const loadingClass = showLocation && entry && needsHydration(entry)
      ? ' friend-sidebar-location-loading'
      : '';
    const noPreviewClass = !friendIsOnline(friend) || isWebsite || isPrivate ? ' friend-sidebar-no-preview' : '';

    return `
    <div class="friend-item${loadingClass}${noPreviewClass}${!friendIsOnline(friend) ? ' friend-offline' : ''}" data-friend-id="${escapeHtml(friend.id)}"${locationData} tabindex="0" role="button" aria-label="${escapeHtml(name)}">
      <div class="friend-avatar-wrap">
        ${renderFramedAvatar(friend,avatar)}
        ${renderFavoriteActionButton(friend.id)}
      </div>
      <div class="friend-copy">
        <div class="friend-name">
          <span class="online-dot ${status.className}" title="${escapeHtml(status.label)}" aria-label="${escapeHtml(status.label)}">●</span>
          <span class="friend-name-text" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        </div>
        <div class="friend-state ${permissionBadgeClass(permission)}">${escapeHtml(friendStateText(friend))}</div>
      </div>
      ${showLocation ? renderFriendSidebarLocationThumbnail(friend) : ''}
    </div>`;
  }

  function renderRecentWorlds() {
    const recent=state.recent, groups=getWorldFavorites()?.groups||[], selected=getWorldView().selected;
    const group=groups.find(g=>g.key===selected), isRecent=selected==='recent';
    const rows=isRecent?recent.rows:(getWorldFavorites()?.members(selected)||[]).map(id=>getWorldCatalog().worlds.get(id)||getRepository().getCachedWorld(id)||{id,pending:getWorldView().loading,loadFailed:!getWorldView().loading&&Boolean(getWorldView().error),unavailable:!getWorldView().loading&&!getWorldView().error});
    const worldLoading=Boolean(getWorldView().loading || (isRecent&&recent.loading) || getWorldFavorites()?.inflight);
    const notice=getWorldView().error?readFailureMessage(isRecent?'worldFavorites':'worlds',getWorldView().error)
      :isRecent&&recent.error?readFailureMessage('recent',recent.error)
      :getWorldFavorites()?.inflight?t('ワールドFavoriteを確認中…')
      :worldLoading?'':isRecent?(recent.ready&&!rows.length?t('最近訪問したワールドはありません。'):''):!rows.length?t('このリストにはワールドがありません。'):'';
    const editor=getWorldView().editor;
    const edit=editor&&editor.key===selected?`<form class="world-list-editor" data-world-list-editor aria-busy="${editor.saving}"><label>${escapeHtml(t('リスト名'))} <input class="world-list-name" maxlength="20" value="${escapeHtml(editor.draft)}"${editor.saving?' disabled':''}></label><span class="world-name-count">${editor.draft.length} / 20</span><button type="submit"${editor.saving||editor.unknown?' disabled':''}>${escapeHtml(t('保存'))}</button><button type="button" data-world-edit-cancel${editor.saving?' disabled':''}>${escapeHtml(t('キャンセル'))}</button><div role="status">${escapeHtml(editor.saving?t('リスト名を保存しています…'):editor.error?t(editor.error):'')}</div></form>`:'';
    return `<section class="recent-worlds" aria-label="${escapeHtml(t('ワールド管理'))}"><div class="world-tabs" role="tablist" aria-label="${escapeHtml(t('ワールドリスト'))}">
    <button type="button" role="tab" aria-selected="${isRecent}" data-world-tab="recent">${escapeHtml(t('足跡'))}</button>${groups.map((g,i)=>`<button type="button" role="tab" aria-selected="${g.key===selected}" data-world-tab="${escapeHtml(g.key)}" title="${escapeHtml(g.label)}">★${i+1} ${escapeHtml(g.label)} <span class="world-list-count">(${getWorldFavorites().members(g.key).length})</span></button>`).join('')}</div>
    ${group?`<div class="world-list-heading"><h2 title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</h2><button type="button" data-world-edit title="${escapeHtml(t('リスト名を変更'))}" aria-label="${escapeHtml(t('リスト名を変更'))}"${state.favoriteMutationPending?' disabled':''}><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m4 13 9-9 3 3-9 9-4 1zM11 6l3 3"/></svg></button></div>`:`<div class="world-list-heading"><h2>${escapeHtml(t('足跡'))}</h2></div>`}${edit}
    <div class="recent-notice" role="status">${escapeHtml(notice)}</div><div class="recent-world-grid">${rows.map(world=>{
        const unavailable=worldIsUnavailable(world);
        const thumb=unavailable?'':displayImageUrl(world.thumbnailImageUrl||world.imageUrl||'','world'), platforms=unavailable?null:worldPlatforms(world), name=unavailable?t('情報取得不可'):world.loadFailed?t('読み込み失敗'):world.name||t('ワールド情報を取得中…');
        const placeholder=unavailable?`<div class="thumb thumb-placeholder world-unavailable"><span class="world-unavailable-icon" aria-hidden="true">⌕</span><span>World Currently<br>Unavailable</span></div>`:'<div class="thumb thumb-placeholder"></div>';
        return `<article class="recent-world-card" data-world-id="${escapeHtml(world.id)}"><div class="thumb-wrap has-world-favorite"><a class="world-page-link" href="${escapeHtml(buildWorldUrl({worldId:world.id}))}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(t('ワールドページを開く'))}">${thumb?`<img class="thumb" data-image-src="${escapeHtml(thumb)}" alt="" loading="eager" decoding="async">`:placeholder}</a>${renderWorldFavoriteButton(world.id)}<span class="world-platforms" title="${escapeHtml(t('対応環境'))}">${escapeHtml(platforms?.length?platforms.join(' / '):t('対応環境不明'))}</span><button type="button" class="world-copy" data-copy-url="${escapeHtml(buildWorldUrl({worldId:world.id}))}" title="${escapeHtml(t('ワールドURLをコピー'))}" aria-label="${escapeHtml(t('ワールドURLをコピー'))}"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="6" width="11" height="11" rx="1.5"/><path d="M13 6V3H3v10h3"/></svg></button></div>
      <div class="recent-world-name"><span title="${escapeHtml(name)}">${escapeHtml(name)}</span></div><div class="recent-world-author"><span title="${escapeHtml(unavailable||world.pending?world.id:world.authorName||t('作者不明'))}">${escapeHtml(unavailable||world.pending?world.id:world.authorName||t('作者不明'))}</span></div></article>`;
      }).join('')}</div></section>`;
  }

  function reverseEntryForFriend(friend) {
    const location = resolveFriendLocation(friend);
    if (!location || location === 'offline') return null;
    return renderedInstanceIndex ? renderedInstanceIndex.get(location) || null : state.instances.find((entry) => entry.location === location) || null;
  }

  function friendLocationLabel(friend, entry = reverseEntryForFriend(friend)) {
    const status = onlineStatusInfo(friend);
    if (!friendIsOnline(friend)) return 'Offline';
    if (status.className === 'online-website') return 'OtherPlatform';
    const location = resolveFriendLocation(friend);
    const permission = entry?.permission || classifyPermission(location);
    if (permission === PERMISSIONS.PRIVATE || location === 'private') return 'Private';
    const worldName = entry?.world?.name || entry?.instanceData?.world?.name || '';
    if (worldName) return worldName;
    if (entry?.instanceFetchFailed || entry?.worldFetchFailed) return t('情報取得不可');
    if (entry?.worldId && entry.worldId !== 'offline' && entry.worldId !== 'private') return t('ワールド情報を取得中…');
    return permissionLabel(permission);
  }

  function friendLocationSortKey(friend) {
    const entry = reverseEntryForFriend(friend);
    const status = onlineStatusInfo(friend);
    const location = resolveFriendLocation(friend);
    const permission = entry?.permission || classifyPermission(location);

    // Instances, Private, OtherPlatform, then Offline.
    if (!friendIsOnline(friend)) return '3\u0000Offline';
    if (status.className === 'online-website') {
      return '2\u0000OtherPlatform';
    }
    if (permission === PERMISSIONS.PRIVATE || location === 'private') {
      return '1\u0000Private';
    }

    const label = friendLocationLabel(friend, entry);
    return `0\u0000${label}\u0000${location}`;
  }

  function sortReverseFriends(friends) {
    const rows = [...(friends || [])];
    if (state.friendViewSort === FRIEND_VIEW_SORTS.LOCATION) {
      const keys=new Map(rows.map(friend=>[friend.id,friendLocationSortKey(friend)]));
      return rows.sort((a,b)=>keys.get(a.id).localeCompare(keys.get(b.id),'ja') || compareOfflineFriends(a,b) || compareFriendNames(a,b));
    }
    return rows.sort((a,b)=>compareOfflineFriends(a,b) || compareFriendNames(a,b));
  }

  function getReverseFriendGroups() {
    const showOtherPlatform = elements.showOnWebsite?.checked !== false;
    const onlineFriends = state.friends.filter((friend) => {
      if (!friendIsOnline(friend) && !elements.showOffline?.checked) return false;
      if (!showOtherPlatform && onlineStatusInfo(friend).className === 'online-website') return false;
      return true;
    });
    const groupsByName = new Map(state.favoriteGroups.map((group) => [group.name, group]));
    const ordered = ['group_0', 'group_1', 'group_2'].map((name, index) => {
      const group = groupsByName.get(name);
      return {
        id: name,
        label: group?.displayName || `Favorite List ${index + 1}`,
        memberIds: group?.memberIds instanceof Set ? group.memberIds : new Set(),
        friends: [],
      };
    });
    const ungrouped = { id: 'ungrouped', label: t('その他'), memberIds: new Set(), friends: [] };

    // A friend can theoretically appear in more than one Favorite List. To keep
    // the reverse view duplicate-free, use the first/highest Favorite List just
    // like the existing Favorite List sort does.
    for (const friend of onlineFriends) {
      const group = ordered.find((candidate) => candidate.memberIds.has(friend.id));
      (group || ungrouped).friends.push(friend);
    }

    const sections = [...ordered, ungrouped];
    sections.forEach((section) => { section.friends = sortReverseFriends(section.friends); });
    return sections;
  }

  function renderFriendLocationPlaceholderIcon({ isPrivate = false, isWebsite = false } = {}) {
    if (isPrivate) {
      return `<svg class="friend-location-placeholder-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
    }
    if (isWebsite) {
      return `<svg class="friend-location-placeholder-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21M12 3C9.5 5.5 8.2 8.5 8.2 12S9.5 18.5 12 21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>`;
    }
    return '<span class="friend-location-placeholder-ellipsis" aria-hidden="true">…</span>';
  }

  function renderFriendLocationItem(friend) {
    if (!friend) return '';
    const name = friend.displayName || friend.username || friend.id;
    const status = onlineStatusInfo(friend);
    const location = resolveFriendLocation(friend);
    const entry = reverseEntryForFriend(friend);
    const permission = entry?.permission || classifyPermission(location);
    const isWebsite = status.className === 'online-website';
    const isPrivate = permission === PERMISSIONS.PRIVATE || location === 'private';
    const isOffline = !friendIsOnline(friend);
    const lastActivityText = isOffline ? formatActivityDateTime(friend.last_activity) : '';
    const lastActivity = lastActivityText
      ? `<time class="friend-location-last-activity" datetime="${escapeHtml(friend.last_activity)}" title="${escapeHtml(uiText('lastActivity'))}">${escapeHtml(lastActivityText)}</time>`
      : '';
    const simpleActivity = lastActivityText
      ? `<time datetime="${escapeHtml(friend.last_activity)}" aria-label="${escapeHtml(uiText('lastActivity')+' '+lastActivityText)}"><span>${escapeHtml(lastActivityText.split(' ')[0])}</span><span>${escapeHtml(lastActivityText.split(' ')[1])}</span></time>`
      : escapeHtml(t('最終アクティブ日時不明'));
    const avatarUrl = friendAvatarUrl(friend);
    const avatar = avatarUrl
      ? `<img class="friend-location-avatar avatar-fallback" data-image-src="${escapeHtml(avatarUrl)}" loading="lazy" decoding="async" alt="${escapeHtml(name)}">`
      : '<img class="friend-location-avatar friend-location-avatar-empty avatar-fallback" src="user-placeholder.svg" alt="" decoding="async">';
    const profileUrl = CONFIG.DEBUG_MODE ? '' : buildUserProfileUrl(friend.id);
    const framed=renderFramedAvatar(friend,avatar);
    const avatarContent = profileUrl
      ? lt`<a class="friend-location-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(name)} / ${escapeHtml(t('公式プロフィールを開く'))}">${framed}</a>`
      : framed;

    const worldName = friendLocationLabel(friend, entry);
    const groupName = entry?.groupName || entry?.instanceData?.group?.name || entry?.instanceData?.groupName || '';
    const launchUrl = entry && !isPrivate && !isWebsite ? buildInstanceLaunchUrl(entry) : '';
    const worldUrl = entry && !isPrivate && !isWebsite ? buildWorldUrl(entry) : '';
    const permissionClass = permissionBadgeClass(isOffline ? PERMISSIONS.OFFLINE : permission);
    const region = entry?.region ? regionLabel(entry.region) : '';
    const locationTitle = groupName ? `${worldName} / ${groupName}` : worldName;

    let countText = '';
    if (entry && !isPrivate && !isWebsite) {
      const userCount = effectiveInstanceUserCount(entry, friendMap());
      const capacity = entry.world?.capacity ?? entry.capacity ?? entry.world?.hardCapacity;
      const friendCount = uniqueUsers(entry.friends).length;
      countText = `${friendCount}/${userCount}/${Number.isFinite(capacity) ? capacity : '-'}`;
    }

    const thumb = entry && !isPrivate && !isWebsite
      ? displayImageUrl(entry.world?.thumbnailImageUrl || entry.instanceData?.world?.thumbnailImageUrl || entry.instanceData?.world?.imageUrl || '', 'world')
      : '';
    const thumbContent = thumb
      ? `<img class="friend-location-thumb" data-image-src="${escapeHtml(thumb)}" loading="lazy" decoding="async" alt="">`
      : `<div class="friend-location-thumb friend-location-thumb-placeholder">${renderFriendLocationPlaceholderIcon({ isPrivate, isWebsite })}</div>`;
    const simpleStatusText = isOffline
      ? 'Offline'
      : isWebsite
      ? 'OtherPlatform'
      : isPrivate
        ? 'Private'
        : permissionLabel(permission);
    const simpleCountText = !isWebsite && !isPrivate && countText ? countText : '';
    const thumbOverlay = `
    <div class="friend-location-thumb-simple-meta">
      <span class="friend-state friend-location-thumb-simple-status ${permissionClass}">${escapeHtml(simpleStatusText)}</span>
      ${simpleCountText ? lt`<span class="friend-location-thumb-simple-count" title="フレンド数 / 参加人数 / 最大人数">${escapeHtml(simpleCountText)}</span>` : ''}
    </div>
    <div class="friend-location-thumb-simple-title${isOffline ? ' friend-location-simple-activity' : ''}"${isOffline ? '' : ` title="${escapeHtml(locationTitle)}"`}>${isOffline ? simpleActivity : escapeHtml(locationTitle)}</div>`;
    const thumbWrapped = worldUrl
      ? lt`<a class="friend-location-thumb-link" href="${escapeHtml(worldUrl)}" target="_blank" rel="noopener noreferrer" title="ワールドページを開く">${thumbContent}${thumbOverlay}</a>`
      : `<div class="friend-location-thumb-link">${thumbContent}${thumbOverlay}</div>`;

    const locationMeta = isOffline
      ? `<span class="friend-state friend-location-permission ${permissionClass}">Offline</span>`
      : isWebsite
      ? `<span class="friend-state friend-location-permission ${permissionClass}">OtherPlatform</span>`
      : isPrivate
        ? `<span class="friend-state friend-location-permission ${permissionClass}">Private</span>`
        : `<span class="friend-state friend-location-permission ${permissionClass}">${escapeHtml(permissionLabel(permission))}</span>${region ? `<span class="friend-location-region">${escapeHtml(region)}</span>` : ''}${countText ? lt`<span class="friend-location-count" title="フレンド数 / 参加人数 / 最大人数">${escapeHtml(countText)}</span>` : ''}`;


    const locationName = launchUrl
      ? lt`<a class="friend-location-world-link" href="${escapeHtml(launchUrl)}" target="_blank" rel="noopener noreferrer" title="公式Launchページを開く">${escapeHtml(locationTitle)}</a>`
      : `<span class="friend-location-world-name" title="${escapeHtml(locationTitle)}">${escapeHtml(locationTitle)}</span>`;

    const nameContent = profileUrl
      ? `<a class="friend-location-name" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(name)}">${escapeHtml(name)}</a>`
      : `<span class="friend-location-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
    const statusDot = `<span class="online-dot ${status.className}" title="${escapeHtml(status.label)}" aria-label="${escapeHtml(status.label)}">●</span>`;
    const locationData = entry?.location && !isPrivate ? ` data-location="${escapeHtml(entry.location)}"` : '';
    const previewDisabledClass = !friendIsOnline(friend) || isPrivate || isWebsite ? ' friend-location-no-preview' : '';
    const markup = `
    <article class="friend-location-item${!friendIsOnline(friend) ? ' friend-offline' : ''}${entry && needsHydration(entry) ? ' friend-location-loading' : ''}${previewDisabledClass}" data-friend-id="${escapeHtml(friend.id)}"${locationData}>
      <div class="friend-location-avatar-wrap">
        ${avatarContent}
        <span class="friend-location-online-dot">${statusDot}</span>
        <div class="friend-location-avatar-name"><span class="friend-location-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span></div>
        ${renderFavoriteActionButton(friend.id, 'friend-location-favorite')}
      </div>
      <div class="friend-location-copy">
        <div class="friend-location-name-line">
          ${statusDot}${nameContent}
        </div>
        <div class="friend-location-world-line">${locationName}${lastActivity}</div>
        <div class="friend-location-meta">${locationMeta}</div>
      </div>
      ${thumbWrapped}
      ${entry && !isPrivate && !isOffline && !isWebsite ? renderInstanceFeedback(entry) : ''}
    </article>`;
    // Keep the original labels for restoring Normal tips without rebuilding cards.
    // Favorite controls retain their native tooltip in either display format.
    return markup.replace(/<[^>]+>/g, tag => {
      if (tag.includes('data-favorite-user-id=') || tag.includes('data-instance-retry=')) return tag;
      return tag.replace(/ title="([^"]*)"/g, (_, label) =>
        ` data-friend-tip="${label}"${state.instanceDisplay === 'normal' ? ` title="${label}"` : ''}`);
    });
  }

  function renderFavoriteGroupEditor(group) {
    const editor = state.favoriteGroupEditor;
    if (editor?.groupName !== group.id) return '';
    const disabled = editor.saving ? ' disabled' : '';
    return lt`<form class="favorite-group-editor" data-group-editor="${escapeHtml(group.id)}">
    <label class="favorite-group-editor-label">グループ名
      <input class="favorite-group-name-input" name="displayName" type="text" autocomplete="off"
        aria-label="Favoriteグループ名" maxlength="${CONFIG.FAVORITE_GROUP_NAME_MAX_LENGTH}" aria-describedby="favorite-group-name-help" value="${escapeHtml(editor.draft)}" required${disabled}>
    </label>
    <div class="favorite-group-editor-actions">
      <span class="favorite-group-name-count">${editor.draft.length} / ${CONFIG.FAVORITE_GROUP_NAME_MAX_LENGTH}</span>
      <button class="favorite-group-save" type="submit"${editor.saving || editor.outcomeUnknown ? ' disabled' : ''}>保存</button>
      <button class="favorite-group-cancel" type="button" data-group-edit-cancel${disabled}>キャンセル</button>
    </div>
    <p class="favorite-group-save-status" role="status"${editor.saving ? '' : ' hidden'}>${editor.saving ? escapeHtml(t('リスト名を保存しています…')) : ''}</p>
    <p class="favorite-group-editor-help" id="favorite-group-name-help">最大20文字。一部の絵文字は2文字分として数えます。</p>
    <p class="favorite-group-editor-error" role="alert"${editor.error ? '' : ' hidden'}>${escapeHtml(editor.error || '')}</p>
  </form>`;
  }

  function renderFriendLocationView() {
    renderedInstanceIndex=new Map(state.instances.map(entry=>[entry.location,entry]));
    try {
    const groups = getReverseFriendGroups();
    const sections = groups.map((group, index) => {
      const isFavoriteGroup = index < 3;
      const collapsed = state.collapsedFriendGroups.has(group.id);
      const icon = isFavoriteGroup ? '★' : '●';
      const regularFriends = group.id === 'ungrouped' ? group.friends.filter(friendIsOnline) : group.friends;
      const offlineFriends = group.id === 'ungrouped' ? group.friends.filter(friend => !friendIsOnline(friend)) : [];
      const rows = collapsed
        ? ''
        : regularFriends.length
          ? limitedMarkup(regularFriends, group.id, renderFriendLocationItem)
          : group.id === 'ungrouped' && offlineFriends.length ? '' : t('<div class="friend-location-section-empty">該当するフレンドはいません</div>');
      return lt`
      <section class="friend-location-section${collapsed ? ' is-collapsed' : ''}" data-favorite-group="${escapeHtml(group.id)}">
        <div class="friend-location-section-heading">
        <button class="friend-location-section-header" type="button"
                data-friend-group-toggle="${escapeHtml(group.id)}"
                aria-expanded="${String(!collapsed)}"
                title="${collapsed ? t('展開') : t('折り畳む')}">
          <span class="friend-location-section-title">
            <span class="friend-location-section-chevron" aria-hidden="true">${collapsed ? '▶' : '▼'}</span>
            <span class="friend-location-section-icon${isFavoriteGroup ? ' is-favorite' : ''}" aria-hidden="true">${icon}</span>
            <span class="friend-location-section-label" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
          </span>
          <span class="friend-location-section-count">${group.friends.length}人</span>
        </button>
        ${isFavoriteGroup ? lt`<button class="favorite-group-edit-button" type="button" data-group-edit="${escapeHtml(group.id)}" aria-label="${escapeHtml(group.label)}の名前を編集" title="名前を編集"${state.favoriteGroupEditor?.saving ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z"/></svg>
        </button>` : ''}
        </div>
        ${renderFavoriteGroupEditor(group)}
        ${collapsed ? '' : `${rows ? `<div class="friend-location-grid">${rows}</div>` : ''}${group.id === 'ungrouped' && elements.showOffline?.checked ? renderUngroupedOfflineSection(offlineFriends) : ''}`}
      </section>`;
    }).join('');

    return `<div class="friend-location-view">${sections}</div>`;
    } finally { renderedInstanceIndex=null; }
  }

  function renderUngroupedOfflineSection(friends) {
    const collapsed = state.collapsedFriendGroups.has('ungrouped-offline');
    return lt`<section class="friend-location-offline-section${collapsed ? ' is-collapsed' : ''}" data-offline-section>
    <button class="friend-location-section-header" type="button" data-friend-group-toggle="ungrouped-offline" aria-expanded="${String(!collapsed)}" aria-controls="ungroupedOfflineFriends" title="${collapsed ? t('展開') : t('折り畳む')}">
      <span class="friend-location-section-title"><span class="friend-location-section-chevron" aria-hidden="true">${collapsed ? '▶' : '▼'}</span><span class="friend-location-section-icon" aria-hidden="true">○</span>Offline</span>
      <span class="friend-location-section-count">${friends.length}人</span>
    </button>
    ${collapsed ? '' : `<div id="ungroupedOfflineFriends" class="friend-location-grid">${friends.length ? limitedMarkup(friends, 'ungrouped-offline', renderFriendLocationItem) : t('<div class="friend-location-section-empty">Offlineのフレンドはいません</div>')}</div>`}
  </section>`;
  }

  function buildInstanceLaunchUrl(entry) {
    const worldId = entry?.worldId;
    const instanceId = entry?.instanceId;
    if (!worldId || !instanceId || worldId === 'offline' || worldId === 'private') return '';
    return `${CONFIG.LAUNCH_PAGE}?worldId=${encodeURIComponent(worldId)}&instanceId=${encodeURIComponent(instanceId)}`;
  }

  function buildWorldUrl(entry) {
    if (!entry?.worldId?.startsWith('wrld_')) return '';
    return `${CONFIG.WORLD_PAGE_BASE}/${encodeURIComponent(entry.worldId)}/info`;
  }

  function buildUserProfileUrl(userId) {
    if (typeof userId !== 'string' || !/^usr_[0-9a-f-]+$/i.test(userId)) return '';
    return `https://vrchat.com/home/user/${encodeURIComponent(userId)}`;
  }

  function renderSummaryPeopleIcon(kind) {
    if (kind === 'world') {
      return `<svg class="summary-people-icon summary-people-icon-world" viewBox="0 0 24 18" aria-hidden="true" focusable="false">
      <circle cx="12" cy="5" r="3" fill="currentColor"/>
      <circle cx="5" cy="7" r="2.5" fill="currentColor"/>
      <circle cx="19" cy="7" r="2.5" fill="currentColor"/>
      <path d="M7.2 16c.3-4 2-6.1 4.8-6.1s4.5 2.1 4.8 6.1H7.2Z" fill="currentColor"/>
      <path d="M.8 16c.2-3.3 1.6-5 4.2-5 1.2 0 2.2.4 3 1.2-.8 1-1.3 2.3-1.5 3.8H.8Z" fill="currentColor"/>
      <path d="M17.5 16c-.2-1.5-.7-2.8-1.5-3.8.8-.8 1.8-1.2 3-1.2 2.6 0 4 1.7 4.2 5h-5.7Z" fill="currentColor"/>
    </svg>`;
    }
    return `<svg class="summary-people-icon summary-people-icon-friends" viewBox="0 0 22 18" aria-hidden="true" focusable="false">
    <circle cx="7" cy="6" r="3" fill="currentColor"/>
    <circle cx="15" cy="6" r="3" fill="currentColor"/>
    <path d="M1 17c.2-4.3 2.2-6.5 6-6.5 1.7 0 3 .5 4 1.5-1.2 1.2-1.8 2.9-2 5H1Z" fill="currentColor"/>
    <path d="M13 17c-.2-2.1-.8-3.8-2-5 1-1 2.3-1.5 4-1.5 3.8 0 5.8 2.2 6 6.5h-8Z" fill="currentColor"/>
  </svg>`;
  }

  function ownerDisplayState() {
    return state.viewMode === VIEW_MODES.INSTANCES ? state : {...state, tab:TABS.ALL};
  }

  function renderParticipantList(entry, { showAll = false } = {}) {
    const participantState = showAll ? { ...state, tab: TABS.ALL } : state;
    const participants = sortParticipants(
      entry,
      participantsForEntry(entry, participantState, friendMap()),
      state,
    );
    const extraOwner = nonFriendOwnerForEntry(entry, ownerDisplayState(), friendMap());
    const renderUser = (user, ownerInfo=false) => {
      const name = user.displayName || user.username || user.id;
      const src = displayImageUrl(
        user.profilePicOverride
          || user.currentAvatarThumbnailImageUrl
          || user.userIcon
          || user.iconUrl
          || user.imageUrl
          || '',
      );
      const profileUrl = buildUserProfileUrl(user.id);
      const avatar = src
        ? `<img class="participant-avatar avatar-fallback" data-image-src="${escapeHtml(src)}" loading="lazy" decoding="async" alt="${escapeHtml(name)}">`
        : '<img class="participant-avatar participant-avatar-empty avatar-fallback" src="user-placeholder.svg" alt="" decoding="async">';
      const framed=renderFramedAvatar(user,avatar);
      const avatarLink = profileUrl
        ? lt`<a class="participant-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="公式プロフィールを開く">${framed}</a>`
        : framed;
      const isOwner = Boolean(instanceOwnerId(entry) === user.id);
      const isFriend = friendMap().has(user.id);
      const ownerBadge = isOwner
        ? `<span class="owner-badge${ownerInfo?' owner-badge-reference':''}" title="${escapeHtml(ownerInfo?t('インスタンスオーナー（参加中とは限りません）'):'Instance Owner')}">Owner</span>`
        : '';
      const favoriteBadge = isFriend
        ? renderFavoriteActionButton(user.id, 'favorite-badge-participant')
        : '';

      return `
      <div class="participant" title="${escapeHtml(name)}">
        <div class="participant-avatar-wrap">
          ${avatarLink}${ownerBadge}${favoriteBadge}
        </div>
        <div class="participant-name">${escapeHtml(name)}</div>
      </div>`;
    };
    const empty = !showAll && state.tab === TABS.FAVORITE_ONLY
      ? t('表示対象のFavoriteフレンドはいません') : t('表示対象のユーザーはいません');
    const people = participants.length ? `<div class="participant-list">${participants.map(user=>renderUser(user)).join('')}</div>`
      : `<div class="participant-empty">${escapeHtml(empty)}</div>`;
    const ownerFrame = extraOwner ? `<section class="non-friend-owner-info" aria-label="${escapeHtml(t('インスタンスオーナー'))}">${renderUser(extraOwner,true)}</section>` : '';
    return ownerFrame ? `<div class="participant-list has-owner">${ownerFrame}${participants.map(user=>renderUser(user)).join('') || `<div class="participant-empty">${escapeHtml(empty)}</div>`}</div>` : people;
  }

  function renderPrivateInstance(entry, { showAll = false } = {}) {
    const favoriteMode = !showAll && (state.tab === TABS.FAVORITE_PLUS || state.tab === TABS.FAVORITE_ONLY);
    const visibleFriends = showAll
      ? entry.friends
      : favoriteMode
        ? entry.friends.filter((friend) => state.favorites.has(friend.id))
        : entry.friends;

    const collapsible = !showAll && state.viewMode !== VIEW_MODES.FRIENDS && state.tab === TABS.ALL;
    const header = collapsible ? lt`<button type="button" class="friend-location-section-header" data-private-toggle="true" aria-expanded="${!state.privateCollapsed}" aria-controls="privateInstanceUsers"><span class="friend-location-section-chevron" aria-hidden="true">${state.privateCollapsed ? '▶' : '▼'}</span><span class="friend-location-section-title">Private</span><span class="friend-location-section-count">${visibleFriends.length}人</span></button>` : '';
    if (collapsible && state.privateCollapsed) return `<section class="friend-location-section private-instance-section is-collapsed" data-location="${escapeHtml(entry.location)}">${header}</section>`;
    const body = `
    <article class="private-card${instanceIsHighlighted(entry) ? ' instance-highlight' : ''}" data-location="${escapeHtml(entry.location)}" aria-label="Private">
      <div class="private-label">Private</div>
      <div class="private-users">
        ${visibleFriends.map((friend) => {
            const name = friend.displayName || friend.username || friend.id;
            const src = friendAvatarUrl(friend);
            const profileUrl = CONFIG.DEBUG_MODE ? '' : buildUserProfileUrl(friend.id);
            const privateAvatar = src
              ? `<img class="private-avatar avatar-fallback" data-image-src="${escapeHtml(src)}" loading="lazy" decoding="async" alt="${escapeHtml(name)}">`
              : `<img class="private-avatar private-avatar-empty avatar-fallback" src="user-placeholder.svg" alt="${escapeHtml(name)}" decoding="async">`;
            const framed=renderFramedAvatar(friend,privateAvatar);
            const privateAvatarLink = profileUrl
              ? lt`<a class="private-profile-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" title="公式プロフィールを開く">${framed}</a>`
              : framed;
            return `
            <div class="private-user" title="${escapeHtml(name)}">
              <div class="private-avatar-wrap">
                ${privateAvatarLink}
                ${renderFavoriteActionButton(friend.id, 'private-favorite-badge')}
              </div>
              <div class="private-user-name">${escapeHtml(name)}</div>
            </div>`;
          }).join('')}
        ${visibleFriends.length === 0 ? `<div class="private-empty">${favoriteMode ? t('Favoriteフレンドはいません') : t('表示対象のユーザーはいません')}</div>` : ''}
      </div>
    </article>`;
    return collapsible ? `<section class="friend-location-section private-instance-section" data-location="${escapeHtml(entry.location)}">${header}<div id="privateInstanceUsers">${body}</div></section>` : body;
  }

  function renderInstanceFeedback(entry, {preview = false} = {}) {
    if (!entry || (!entry.instanceFetchFailed && !entry.worldFetchFailed)) return '';
    const {pending, attempts} = getInstanceRetryState(entry);
    const limited = attempts >= CONFIG.MAX_INSTANCE_MANUAL_RETRIES;
    const reason = entry.instanceFetchFailed ? t('インスタンス情報を取得できませんでした。') : t('ワールド情報を取得できませんでした。');
    return `<div class="instance-load-feedback"><span title="${escapeHtml(reason)}">${escapeHtml(t(pending?'取得中…':'一部取得失敗'))}</span>${preview?'':`<button type="button" data-instance-retry="${escapeHtml(entry.location)}" title="${escapeHtml(t(limited?'次の更新で再試行できます。':'このインスタンスの情報を再取得'))}" aria-label="${escapeHtml(reason+' '+t('再取得'))}"${pending||limited?' disabled':''}${pending?' aria-busy="true"':''}>${escapeHtml(t(pending?'取得中…':'再取得'))}</button>`}</div>`;
  }

  function renderInstanceCard(entry, { preview = false } = {}) {
    if (entry.permission === PERMISSIONS.PRIVATE) return renderPrivateInstance(entry, { showAll: preview });

    const worldName = entry.world?.name
      || entry.instanceData?.world?.name
      || entry.worldId
      || 'World information unavailable';
    const thumb = displayImageUrl(
      entry.world?.thumbnailImageUrl
        || entry.instanceData?.world?.thumbnailImageUrl
        || '',
      'world',
    );
    const worldUrl = entry.debug ? '' : buildWorldUrl(entry);
    const launchUrl = entry.debug ? '' : buildInstanceLaunchUrl(entry);
    const groupName = entry.groupName
      || entry.instanceData?.group?.name
      || entry.instanceData?.groupName
      || (entry.groupId ? t('グループ名取得中…') : '');
    const userCount = effectiveInstanceUserCount(entry, friendMap());
    const capacity = entry.world?.capacity ?? entry.capacity ?? entry.world?.hardCapacity;
    const allFriends = uniqueUsers(entry.friends);
    const allFriendCount = allFriends.length;
    const favoriteFriendCount = allFriends.filter((friend) => state.favorites.has(friend.id)).length;
    const friendCount = preview
      ? allFriendCount
      : state.tab === TABS.FAVORITE_ONLY
        ? favoriteFriendCount
        : allFriendCount;
    const userCountText = Number.isFinite(capacity) ? `${userCount} / ${capacity}` : `${userCount}`;
    const thumbnailCountText = `${allFriendCount}/${userCount}/${Number.isFinite(capacity) ? capacity : '-'}`;
    const permissionClass = permissionBadgeClass(entry.permission);
    const regionBadge = ''; 
    const hydrated = Boolean(entry.instanceData || entry.world);

    return lt`
    <article class="card${hydrated ? '' : ' card-loading'}${instanceIsHighlighted(entry) ? ' instance-highlight' : ''}" data-location="${escapeHtml(entry.location)}">
      <div class="thumb-wrap${worldUrl ? ' thumb-clickable' : ''}">
      ${worldUrl ? lt`<a class="world-page-link" href="${escapeHtml(worldUrl)}" target="_blank" rel="noopener noreferrer" title="ワールドページを開く">` : '<div class="world-page-link">'}
        ${thumb
            ? `<img class="thumb" data-image-src="${escapeHtml(thumb)}" loading="eager" decoding="async" alt="">`
            : '<div class="thumb thumb-placeholder"></div>'}
        <div class="badges">
          <span class="badge ${permissionClass}">${escapeHtml(permissionLabel(entry.permission))}</span>${regionBadge}
        </div>
        <div class="people-count" title="フレンド数 / 参加人数 / 最大人数">
          <span class="people-count-normal">${escapeHtml(thumbnailCountText)}</span>
          <span class="people-count-simple">${escapeHtml(thumbnailCountText)}</span>
        </div>
        <div class="overlay-title" title="${escapeHtml(worldName)}">${escapeHtml(worldName)}</div>
      ${worldUrl ? '</a>' : '</div>'}
      </div>
      <button class="invite-me-button invite-me-button-simple" type="button" data-location="${escapeHtml(entry.location)}" title="このインスタンスのInviteMeを送信" ${entry.debug || state.pendingInvites.has(entry.location) || !entry.worldId || !entry.instanceId ? 'disabled' : ''}>InviteMe</button>

      <div class="info-panel">
        <div class="instance-title-line">
          ${launchUrl
              ? lt`<a class="instance-title-name instance-title-name-link" href="${escapeHtml(launchUrl)}" target="_blank" rel="noopener noreferrer" title="公式Launchページを開く">${escapeHtml(worldName)}</a>`
              : `<span class="instance-title-name" title="${escapeHtml(worldName)}">${escapeHtml(worldName)}</span>`}
          ${entry.groupId ? `<span class="instance-title-separator">/</span><span class="instance-title-group" title="${escapeHtml(groupName)}">${escapeHtml(groupName)}</span>` : ''}
        </div>

        <div class="summary-row">
          <div class="summary-item permission-summary"><svg class="summary-globe" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M2.8 10h14.4M10 2.5c2.1 2 3.2 4.5 3.2 7.5S12.1 15.5 10 17.5M10 2.5C7.9 4.5 6.8 7 6.8 10s1.1 5.5 3.2 7.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg><span class="summary-value">${escapeHtml(permissionLabel(entry.permission))}${entry.region ? ` / ${escapeHtml(regionLabel(entry.region))}` : ''}</span></div>
          <div class="summary-item">${renderSummaryPeopleIcon('world')}<span class="summary-value">${escapeHtml(userCountText)}</span></div>
          <div class="summary-item friend-count-summary">${renderSummaryPeopleIcon('friends')}<span class="summary-value">${escapeHtml(String(friendCount))}</span><button class="invite-me-button invite-me-button-normal" type="button" data-location="${escapeHtml(entry.location)}" title="このインスタンスのInviteMeを送信" ${entry.debug || state.pendingInvites.has(entry.location) || !entry.worldId || !entry.instanceId ? 'disabled' : ''}>InviteMe</button></div>
        </div>

        ${renderParticipantList(entry, { showAll: preview })}
      </div>
      ${renderInstanceFeedback(entry, {preview})}
    </article>`;
  }

  return {
    renderFriendSidebarLocationThumbnail,
    renderFriendSidebarItem,
    renderRecentWorlds,
    reverseEntryForFriend,
    friendLocationLabel,
    friendLocationSortKey,
    sortReverseFriends,
    getReverseFriendGroups,
    renderFriendLocationPlaceholderIcon,
    renderFriendLocationItem,
    renderFavoriteGroupEditor,
    renderFriendLocationView,
    renderUngroupedOfflineSection,
    buildInstanceLaunchUrl,
    buildWorldUrl,
    buildUserProfileUrl,
    renderSummaryPeopleIcon,
    ownerDisplayState,
    renderParticipantList,
    renderPrivateInstance,
    renderInstanceCard
  };
}
