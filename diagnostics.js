// Allowlisted summaries only. Never retain API bodies, messages, IDs or URLs.
const operations = new Set(['api', 'instance-details', 'instance-world', 'friends', 'groups', 'offline', 'worlds', 'recent', 'worldFavorites', 'notifications-load', 'notifications-bulk', 'notifications-read', 'notifications-accept', 'notifications-decline', 'notifications-hide', 'notifications-reply', 'notifications-invite', 'notifications-verify', 'notifications-messages', 'favorite-write', 'list-rename', 'invite-me', 'cache-clear', 'ui']);
const codes = new Set(['TIMEOUT', 'NETWORK_ERROR', 'READ_CANCELLED', 'RUNTIME_ERROR', 'RUNTIME_TIMEOUT', 'INVALID_URL', 'API_HEADERS_UNAVAILABLE']);
export function diagnosticEndpoint(path) {
  // The returned value is a literal template, never a captured substring.
  const p = typeof path === 'string' ? path.split('?')[0] : '';
  if (p === '/auth/user') return '/auth/user';
  if (/^\/auth\/user\/notifications\/(?:not|frq)_[A-Za-z0-9_-]+\/(?:accept|hide)$/.test(p)) return '/auth/user/notifications/{id}/{action}';
  if (p === '/auth/user/notifications') return '/auth/user/notifications';
  if (p === '/notifications') return '/notifications';
  if (/^\/notifications\/not_[A-Za-z0-9_-]+\/respond$/.test(p)) return '/notifications/{id}/respond';
  if (/^\/message\/usr_[A-Za-z0-9_-]+\/(?:response|requestResponse)(?:\/\d+)?$/.test(p)) return '/message/{user}/{type}/{slot}';
  if (/^\/invite\//.test(p)) return '/invite/{target}';
  if (/^\/auth\/user\/friends$/.test(p)) return '/auth/user/friends';
  if (/^\/favorites(?:\/|$)|^\/favorite\/group\//.test(p)) return '/favorites/{resource}';
  if (/^\/worlds\//.test(p)) return '/worlds/{id}';
  if (/^\/instances\//.test(p)) return '/instances/{world}/{instance}';
  if (/^\/users\/[^/]+\/instances\/groups$/.test(p)) return '/users/{id}/instances/groups';
  if (/^\/users\//.test(p)) return '/users/{id}';
  if (/^\/groups\//.test(p)) return '/groups/{id}/{resource}';
  return 'other';
}
export function diagnosticReason(error) {
  if (error?.notificationUncertain || error?.outcomeUnknown || error?.favoriteOutcomeUnknown) return 'outcome_unknown';
  if (error?.apiOriginRejected) return 'origin_rejected';
  if (error?.apiHeadersUnavailable) return 'headers_unavailable';
  if (codes.has(error?.code)) return error.code.toLowerCase();
  if (/^"?You cannot respond to your own invites[.․]"?$/.test(error?.apiMessage || '')) return 'self_invite_response';
  if (/^Cannot unsubscribe someone else[.․]$/.test(error?.apiMessage || '')) return 'unsubscribe_other_user';
  if (error?.code === 'ACCOUNT_CHANGED') return 'account_changed';
  if (error?.status === 401) return 'authentication_required';
  if (error?.status === 403) return 'forbidden';
  if (error?.status === 404) return 'not_found';
  if (error?.status === 429) return 'rate_limited';
  if (error?.status >= 500) return 'server_error';
  if (error?.status >= 400) return 'request_rejected';
  if (error?.name === 'AbortError') return 'cancelled';
  if (error?.message === 'Reply cooldown') return 'reply_cooldown';
  if (error?.message === 'No current instance') return 'no_current_instance';
  if (/^Invalid (?:notifications|group notifications|messages|instance details|group instances)$/.test(error?.message || '')) return 'invalid_response';
  if (error?.message === 'Repeated notifications page') return 'repeated_page';
  return 'unspecified';
}
const number = value => Number.isFinite(value) ? Math.max(0, Math.min(50000, Math.round(value))) : 0;
export class DiagnosticLog {
  constructor() { this.events = []; }
  clear() { this.events = []; }
  record(operation, error, {path, method} = {}) {
    if (error?.name === 'AbortError') return;
    const event={operation: operations.has(operation) ? operation : 'ui', endpoint: diagnosticEndpoint(path), method: ['GET','POST','PUT','DELETE'].includes(method) ? method : 'none', status: Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : 0, reason: diagnosticReason(error)};
    if(JSON.stringify(this.events.at(-1))===JSON.stringify(event))return;
    this.events.push(event);
    if (this.events.length > 10) this.events.shift();
  }
  snapshot({version, language, theme, view, counts = {}, groups = {}} = {}) {
    return {format: 'vrchat-viewer-diagnostics-v1', version: /^\d+(?:\.\d+){1,3}$/.test(version || '') ? version : 'unknown', language: ['ja','en'].includes(language) ? language : 'unknown', theme: ['light','sand','mist','ash','dark-blue','dark'].includes(theme) ? theme : 'unknown', view: ['instances','friends','recent'].includes(view) ? view : 'unknown', counts: {friends: number(counts.friends), instances: number(counts.instances), notifications: number(counts.notifications)}, groups: {total:number(groups.total),summaryOnly:number(groups.summaryOnly),detailsLoaded:number(groups.detailsLoaded),detailFailed:number(groups.detailFailed),worldFailed:number(groups.worldFailed),pendingRetries:number(groups.pendingRetries),detailBudgetUsed:number(groups.detailBudgetUsed),detailBudgetLimit:number(groups.detailBudgetLimit),listFailed:Boolean(groups.listFailed)}, errors: this.events.map(event => ({...event}))};
  }
}
export const diagnosticLog = new DiagnosticLog();

export function summarizeGroupInstances(entries, {pending = new Set(), attempts = new Set(), limit = 0, listFailed = false} = {}) {
  const groups = (Array.isArray(entries) ? entries : []).filter(entry => Boolean(entry?.groupId));
  return {total:groups.length, summaryOnly:groups.filter(e=>!e.instanceDetailsLoaded).length,
    detailsLoaded:groups.filter(e=>e.instanceDetailsLoaded).length,
    detailFailed:groups.filter(e=>e.instanceFetchFailed).length,
    worldFailed:groups.filter(e=>e.worldFetchFailed).length,
    pendingRetries:groups.filter(e=>pending.has(e.location)).length,
    detailBudgetUsed:attempts.size,detailBudgetLimit:limit,listFailed:Boolean(listFailed)};
}
