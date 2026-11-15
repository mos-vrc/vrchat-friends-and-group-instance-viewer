import { requireAccount } from './account-session.js';
import { CONFIG } from './config.js';
import { avatarIsUnavailable } from './avatar-catalog.js';
// Avatar lists are separate from friend/world lists. Keep only a same-account
// memory snapshot; use the existing session client and request policy for
// every call. Avatar lists use a single API type: how many lists the account
// may use (1 by default, more with VRC+) comes from the typed groups
// endpoint's account-specific limits, never from a hard-coded count.
const TYPES = new Set(['avatar']);
const validId = id => /^avtr_[A-Za-z0-9_-]+$/.test(id || '');
const validGroup = g => g && TYPES.has(g.type) && typeof g.name === 'string' && /^avatars[1-9]\d*$/.test(g.name);
const signature = rows => JSON.stringify(rows.map(r => [r.type, [...new Set(r.tags)].sort()]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
export class AvatarFavorites {
  constructor(api, user=null) { this.api=api; this.records=new Map(); this.groups=[]; this.ready=false; this.updatedAt=0; this.inflight=null; this.pending=false; this.previews=new Map(); this.progressRecords=new Map(); this.progressGroups=[]; this.onProgress=()=>{}; }
  async load(force=false) {
    if (!force && this.ready && Date.now()-this.updatedAt<300000) return this;
    if (this.inflight) return this.inflight;
    this.inflight=this.read().finally(()=>{this.inflight=null});
    return this.inflight;
  }
  async loadSelected(group, current=()=>true) {
    if(!validGroup(group))throw new Error('Avatar Favorite list unavailable');
    await requireAccount(this.api,this.account);
    const response=await this.api.fetchJson(`/favorites/groups/${group.type}/${encodeURIComponent(group.name)}`);
    await requireAccount(this.api,this.account);
    const rows=response?.favorites;
    if(!Array.isArray(rows) || !Number.isInteger(response.totalCount) || response.totalCount!==rows.length
      || rows.some(r=>!r || !/^fvrt_[A-Za-z0-9_-]+$/.test(r.id||'') || !validId(r.favoriteId)
        || (r.type && r.type!==group.type) || !Array.isArray(r.tags) || !r.tags.includes(group.name)
        || r.tags.some(name=>!validGroup({type:group.type,name})))
      || new Set(rows.map(r=>r.id)).size!==rows.length) {
      const error=new Error('Selected Avatar Favorite response unsupported');error.selectedListUnsupported=true;throw error;
    }
    // Display-only snapshot; never authorizes changes or marks the full store ready.
    if(current())this.previews.set(group.key,[...new Set(rows.map(r=>r.favoriteId))]);
    return response;
  }
  async refreshGroups() {
    if(this.inflight)await this.inflight;
    return this.read(false);
  }
  async read(includeRecords=true) {
    await requireAccount(this.api,this.account);
    const groups=[],limits=new Map(),capacities=new Map();
    // The website's typed endpoint includes account-specific slot limits and
    // empty list metadata. Names are internal tags; labels never become tags.
    const parallel=async tasks=>{
      const results=await Promise.allSettled(tasks);
      const failed=results.find(r=>r.status==='rejected');
      if(failed)throw failed.reason;
    };
    if(includeRecords){this.ready=false;this.progressRecords=new Map();this.progressGroups=[];}
    await parallel([...TYPES].map(async type=>{
      try {
        const data=await this.api.fetchJson(`/favorites/groups/${type}`);
        if(!data || !Array.isArray(data.favoriteGroups)
          || !Number.isInteger(data.maxFavoriteGroups) || data.maxFavoriteGroups<0 || data.maxFavoriteGroups>100
          || !Number.isInteger(data.maxFavoritesPerGroup) || data.maxFavoritesPerGroup<0
          || data.favoriteGroups.some(g=>!validGroup({...g,type}) || (g.type&&g.type!==type))
          || new Set(data.favoriteGroups.map(g=>g.name)).size!==data.favoriteGroups.length
          || data.favoriteGroups.length>data.maxFavoriteGroups)throw new Error('Avatar Favorite list response unavailable');
        limits.set(type,data.maxFavoriteGroups);capacities.set(type,data.maxFavoritesPerGroup);
        groups.push(...data.favoriteGroups.map(g=>({...g,type})));
      } catch(error) {
        // Older servers may not support the typed endpoint. Do not mistake
        // authentication, rate limits, transient failures or malformed data
        // for an account without lists.
        if(![404,405,501].includes(error?.status))throw error;
        try {
          const rows=await this.api.fetchListPages(offset=>this.api.fetchJson(`/favorite/groups?type=${type}&n=100&offset=${offset}`),1000,
            g=>g && typeof g.name==='string' && g.type===type,g=>g.name);
          groups.push(...rows);
          limits.set(type,Math.max(1,rows.filter(validGroup).length));
        }catch(legacyError){throw legacyError}
      }
    }));
    const buildGroups=records=>{
      const avatarGroups=groups.filter(validGroup).map(g=>({type:g.type,name:g.name,label:g.displayName||g.display_name||g.name,key:`${g.type}:${g.name}`,capacity:capacities.get(g.type)}));
      const recordGroups=[...records.values()].flat().flatMap(r=>r.tags.map(name=>({type:r.type,name})));
      const ensure=(type,name,label,synthetic=false)=>{
        if(!avatarGroups.some(g=>g.type===type&&g.name===name))avatarGroups.push({type,name,label,key:`${type}:${name}`,synthetic,capacity:capacities.get(type)});
      };
      // Server-confirmed lists/record tags take precedence. Fill only remaining
      // slots within the returned limit, never an extra list just because
      // querying its contents returned an empty successful response.
      for(const g of recordGroups)ensure(g.type,g.name,g.name);
      for(const type of TYPES) {
        const limit=limits.get(type)||0;
        const slots=Array.from({length:limit},(_,i)=>i+1);
        for(const slot of slots){
          const count=avatarGroups.filter(g=>g.type===type).length;
          if(count>=limit)break;
          const name=`avatars${slot}`;
          ensure(type,name,'',true);
        }
      }
      avatarGroups.sort((a,b)=>Number(a.name.match(/\d+$/)[0])-Number(b.name.match(/\d+$/)[0]));
      avatarGroups.forEach((g,i)=>{if(g.synthetic)g.label=`Favorite Avatars ${i+1}`});
      return avatarGroups;
    };
    const records=includeRecords?new Map():new Map([...this.records].map(([id,rows])=>[id,rows.filter(r=>TYPES.has(r.type))]).filter(([,rows])=>rows.length));
    // Empty lists can be absent from metadata. Validate record tags by their
    // typed API names rather than requiring a metadata row for every tag.
    const types=[...TYPES].filter(type=>limits.get(type)>0);
    let failure=null;
    const collect=(type,rows,target)=>{
      for(const row of rows){const list=target.get(row.favoriteId)||[];
        const record={id:row.id,type,tags:[...new Set(row.tags)]};
        target.set(row.favoriteId,[...list.filter(old=>old.id!==row.id),record]);}
    };
    const notify=()=>{try{this.onProgress()}catch{}};
    if(includeRecords){this.progressGroups=buildGroups(this.progressRecords);notify();}
    try {
      await parallel((includeRecords?types:[]).map(async type=>{
        try {
          const rows=await this.api.fetchListPages(offset=>{
            if(failure)throw failure;
            return this.api.fetchJson(`/favorites?type=${type}&n=${CONFIG.API_PAGE_SIZE}&offset=${offset}`);
          },5000,
            r=>r && /^fvrt_[A-Za-z0-9_-]+$/.test(r.id||'') && validId(r.favoriteId) && (!r.type||r.type===type)
              && Array.isArray(r.tags) && r.tags.length>0 && r.tags.every(name=>validGroup({type,name})),r=>r.id,
            rows=>{if(failure)return;collect(type,rows,this.progressRecords);
              this.progressGroups=buildGroups(this.progressRecords);notify();});
          collect(type,rows,records);
        }catch(error){failure ||= error;throw error;}
      }));
    }catch(error){
      this.progressRecords=new Map();this.progressGroups=[];notify();throw error;
    }
    await requireAccount(this.api,this.account);
    const avatarGroups=buildGroups(records);
    this.groups=avatarGroups;this.records=records;if(includeRecords){this.previews.clear();this.ready=true;this.updatedAt=Date.now();this.progressRecords=new Map();this.progressGroups=[];notify()}return this;
  }
  displayNumber(avatarId) {
    if(this.ready)return this.number(avatarId);
    const rows=this.progressRecords.get(avatarId)||[];
    return this.progressGroups.findIndex(g=>rows.some(r=>r.type===g.type&&r.tags.includes(g.name)))+1;
  }
  current(avatarId) { return (this.records.get(avatarId)||[]).map(r=>({...r,tags:[...r.tags]})); }
  members(key) {
    if(!this.ready && this.previews.has(key))return [...this.previews.get(key)];
    const group=this.groups.find(g=>g.key===key);
    return group ? [...this.records].filter(([,rows])=>rows.some(r=>r.type===group.type&&r.tags.includes(group.name))).map(([id])=>id) : [];
  }
  number(avatarId) {
    return this.groups.findIndex(g=>this.current(avatarId).some(r=>r.type===g.type&&r.tags.includes(g.name)))+1;
  }
  async rename(key, displayName, expectedLabel) {
    const name=typeof displayName==='string'?displayName.trim():'';
    if(this.pending || !/^usr_[A-Za-z0-9_-]+$/.test(this.account||'') || !name || name.length>20 || /[\r\n\u0000]/.test(name))throw new Error('Invalid avatar list name');
    this.pending=true;
    try {
      await requireAccount(this.api,this.account);
      if(!this.ready)await this.load(true);else await this.refreshGroups();
      const group=this.groups.find(g=>g.key===key);
      if(!group || group.label!==expectedLabel){const e=new Error('Avatar list changed elsewhere');e.favoriteConflict=true;throw e}
      if(group.label===name)return;
      await this.api.fetchJson(`/favorite/group/${group.type}/${group.name}/${encodeURIComponent(this.account)}`,{method:'PUT',body:JSON.stringify({displayName:name})});
      try{await this.refreshGroups()}catch(e){e.outcomeUnknown=true;throw e}
      if(this.groups.find(g=>g.key===key)?.label!==name){const e=new Error('Avatar list rename unconfirmed');e.outcomeUnknown=true;throw e}
    } finally {this.pending=false}
  }
  async add(avatarId, row) {
    let record;
    try{record=await this.api.fetchJson('/favorites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:row.type,favoriteId:avatarId,tags:row.tags})})}
    catch(error){
      // Only suggest initializing missing metadata for a confirmed rejection
      // of a synthesized destination. Never apply to uncertain writes,
      // authentication, throttling, deletion or known/full destinations.
      if(!error?.outcomeUnknown && [400,404].includes(error?.status) && row.tags.some(tag=>{
        const g=this.groups.find(g=>g.type===row.type&&g.name===tag);
        return g?.synthetic && (!Number.isInteger(g.capacity)||this.members(g.key).length<g.capacity);
      }))error.favoriteListSetupSuggested=true;
      throw error;
    }
    if(!record || !/^fvrt_[A-Za-z0-9_-]+$/.test(record.id||'') || record.favoriteId!==avatarId
      || (record.type&&record.type!==row.type) || !Array.isArray(record.tags) || signature([{type:row.type,tags:record.tags}])!==signature([row])){
      const error=new Error('Avatar Favorite write response unavailable');error.outcomeUnknown=true;throw error;
    }
    return {id:record.id,type:row.type,tags:[...record.tags]};
  }
  async refreshMembership(avatarId) {
    if(this.inflight)await this.inflight;
    const current=this.current(avatarId);
    if(!this.ready || !current.length || Date.now()-this.updatedAt>=300000){
      await this.load(true);return;
    }
    // Recheck only source lists before deletion. The API supports a tag filter;
    // do not invent an avatar-ID query filter. Snapshot timestamps are unchanged
    // because this does not refresh all lists or account entitlements.
    const scopes=[...new Map(current.flatMap(r=>r.tags.map(tag=>[`${r.type}:${tag}`,{type:r.type,tag}]))).values()];
    const rowsById=new Map();
    for(const {type,tag} of scopes){
      const rows=await this.api.fetchListPages(offset=>this.api.fetchJson(`/favorites?type=${type}&tag=${encodeURIComponent(tag)}&n=${CONFIG.API_PAGE_SIZE}&offset=${offset}`),5000,
        r=>r && /^fvrt_[A-Za-z0-9_-]+$/.test(r.id||'') && validId(r.favoriteId) && (!r.type||r.type===type)
          && Array.isArray(r.tags) && r.tags.includes(tag) && r.tags.every(name=>validGroup({type,name})),r=>r.id);
      for(const r of rows)rowsById.set(r.id,{...r,type,tags:[...new Set(r.tags)]});
    }
    const records=new Map([...this.records].map(([id,rows])=>[id,rows.filter(r=>!scopes.some(s=>s.type===r.type&&r.tags.includes(s.tag)))]));
    for(const r of rowsById.values()){
      const list=records.get(r.favoriteId)||[];
      records.set(r.favoriteId,[...list.filter(old=>old.id!==r.id),{id:r.id,type:r.type,tags:r.tags}]);
    }
    for(const [id,rows] of records)if(!rows.length)records.delete(id);
    this.records=records;
  }
  async change(avatarId, desired, expected) {
    if(!validId(avatarId) || this.pending) throw new Error('Avatar Favorite operation unavailable');
    this.pending=true;
    try {
      await requireAccount(this.api,this.account);
      try{await this.refreshMembership(avatarId)}catch(error){error.favoriteNoMutation=true;throw error}
      const previous=this.current(avatarId);
      if(signature(previous)!==signature(expected)) {const e=new Error('Avatar Favorite changed elsewhere');e.favoriteConflict=true;throw e}
      if(desired.some(r=>!TYPES.has(r.type)||!r.tags.length||r.tags.some(tag=>!this.groups.some(g=>g.type===r.type&&g.name===tag))))throw new Error('Avatar Favorite list unavailable');
      if(signature(previous)===signature(desired))return {previous,expected:previous,syncFailed:false};
      // Check fresh metadata before deleting any record for a move/restore.
      // Unavailable avatars cannot be re-added, so rollback is not a remedy.
      if(desired.length){
        let avatar;
        try{avatar=await this.api.fetchJson(`/avatars/${encodeURIComponent(avatarId)}`)}catch(error){
          if([403,404].includes(error?.status))error.favoriteAvatarUnavailable=true;
          error.favoriteNoMutation=true;throw error;
        }
        if(!avatar || avatar.id!==avatarId || avatarIsUnavailable(avatar)
          || (avatar.releaseStatus!=='public' && (!this.account || avatar.authorId!==this.account))){
          const error=new Error('Avatar cannot be added to Favorites');error.favoriteAvatarUnavailable=true;error.favoriteNoMutation=true;throw error;
        }
      }
      const deleted=[],created=[];
      try {
        for(const row of previous){await this.api.removeFavoriteRecord(row.id);deleted.push(row)}
        for(const row of desired){created.push(await this.add(avatarId,row))}
      } catch(error) {
        if(error?.apiOriginRejected || error?.apiHeadersUnavailable){
          // The same Origin/configuration rejection would also reject restoration.
          // Avoid more writes and a whole-account read storm; require explicit refresh.
          error.favoriteNoMutation = deleted.length === 0 && created.length === 0;
          error.favoriteNeedsManualRefresh = !error.favoriteNoMutation;
          this.ready=false;this.updatedAt=0;throw error;
        }
        if(error?.name==='AbortError'||error?.outcomeUnknown)throw error;
        // Roll back only confirmed rejected operations. Never replay an
        // uncertain POST/DELETE, including an uncertain rollback request.
        try {
          for(const row of created)await this.api.removeFavoriteRecord(row.id);
          for(const row of deleted)await this.add(avatarId,row);
        }catch(rollback){error.favoriteRollbackFailed=true;error.outcomeUnknown=Boolean(rollback?.outcomeUnknown);}
        this.ready=false;this.updatedAt=0;
        throw error;
      }
      if(created.length)this.records.set(avatarId,created);else this.records.delete(avatarId);
      // DELETE succeeded and every POST response has been validated. Apply
      // those confirmed records to the verified membership snapshot rather than
      // downloading every account Favorite a second time. Failures still use
      // the existing single reconciliation path in the caller.
      // Only this avatar was changed; do not extend whole-account freshness.
      return {previous,expected:created,syncFailed:false,syncError:null};
    } finally {this.pending=false}
  }
}
