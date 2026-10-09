import { CONFIG } from './config.js';
import { worldIsUnavailable } from './world-catalog.js';
// World lists are separate from friend lists. Keep only a same-account memory
// snapshot; use the existing session client and request policy for every call.
const TYPES = new Set(['world', 'vrcPlusWorld']);
const validId = id => /^wrld_[A-Za-z0-9_-]+$/.test(id || '');
const validGroup = g => g && TYPES.has(g.type) && typeof g.name === 'string'
  && (g.type === 'world' ? /^worlds(?:0|[1-9]\d*)$/.test(g.name) : /^vrcPlusWorlds[1-9]\d*$/.test(g.name));
const signature = rows => JSON.stringify(rows.map(r => [r.type, [...new Set(r.tags)].sort()]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
export class WorldFavorites {
  constructor(api) { this.api=api; this.records=new Map(); this.groups=[]; this.ready=false; this.updatedAt=0; this.inflight=null; this.pending=false; }
  async load(force=false) {
    if (!force && this.ready && Date.now()-this.updatedAt<300000) return this;
    if (this.inflight) return this.inflight;
    this.inflight=this.read().finally(()=>{this.inflight=null});
    return this.inflight;
  }
  async refreshGroups() {
    if(this.inflight)await this.inflight;
    return this.read(false);
  }
  async read(includeRecords=true) {
    const groups=[],limits=new Map(),capacities=new Map();
    // The website's typed endpoint includes account-specific slot limits and
    // empty list metadata. Names are internal tags; labels never become tags.
    for(const type of TYPES) {
      try {
        const data=await this.api.fetchJson(`/favorites/groups/${type}`);
        if(!data || !Array.isArray(data.favoriteGroups)
          || !Number.isInteger(data.maxFavoriteGroups) || data.maxFavoriteGroups<0 || data.maxFavoriteGroups>100
          || !Number.isInteger(data.maxFavoritesPerGroup) || data.maxFavoritesPerGroup<0
          || data.favoriteGroups.some(g=>!validGroup({...g,type}) || (g.type&&g.type!==type))
          || new Set(data.favoriteGroups.map(g=>g.name)).size!==data.favoriteGroups.length
          || data.favoriteGroups.length>data.maxFavoriteGroups)throw new Error('World Favorite list response unavailable');
        limits.set(type,data.maxFavoriteGroups);capacities.set(type,data.maxFavoritesPerGroup);
        groups.push(...data.favoriteGroups.map(g=>({...g,type})));
      } catch(error) {
        if(type==='vrcPlusWorld' && error?.status===403){limits.set(type,0);continue}
        // Older servers may not support the typed endpoint. Do not mistake
        // authentication, rate limits, transient failures or malformed data
        // for an account without lists.
        if(![404,405,501].includes(error?.status))throw error;
        try {
          const rows=await this.api.fetchListPages(offset=>this.api.fetchJson(`/favorite/groups?type=${type}&n=100&offset=${offset}`),1000,
            g=>g && typeof g.name==='string' && g.type===type,g=>g.name);
          groups.push(...rows);
          limits.set(type,type==='world'?Math.max(4,rows.filter(validGroup).length):rows.some(validGroup)?Math.max(4,rows.filter(validGroup).length):0);
        }catch(legacyError){if(type==='vrcPlusWorld'&&[403,404].includes(legacyError?.status)){limits.set(type,0);continue}throw legacyError}
      }
    }
    const worldGroups=groups.filter(validGroup).map(g=>({type:g.type,name:g.name,label:g.displayName||g.display_name||g.name,key:`${g.type}:${g.name}`,capacity:capacities.get(g.type)}));
    const records=includeRecords?new Map():this.records;
    // Empty lists can be absent from metadata. Validate record tags by their
    // typed API names rather than requiring a metadata row for every tag.
    const types=[...TYPES].filter(type=>limits.get(type)>0);
    for(const type of includeRecords?types:[]) {
      const rows=await this.api.fetchListPages(offset=>this.api.fetchJson(`/favorites?type=${type}&n=${CONFIG.API_PAGE_SIZE}&offset=${offset}`),5000,
        r=>r && /^fvrt_[A-Za-z0-9_-]+$/.test(r.id||'') && validId(r.favoriteId) && (!r.type||r.type===type)
          && Array.isArray(r.tags) && r.tags.length>0 && r.tags.every(name=>validGroup({type,name})),r=>r.id);
      for(const row of rows){const list=records.get(row.favoriteId)||[];list.push({id:row.id,type,tags:[...new Set(row.tags)]});records.set(row.favoriteId,list)}
    }
    const recordGroups=[...records.values()].flat().flatMap(r=>r.tags.map(name=>({type:r.type,name})));
    const ensure=(type,name,label,synthetic=false)=>{
      if(!worldGroups.some(g=>g.type===type&&g.name===name))worldGroups.push({type,name,label,key:`${type}:${name}`,synthetic,capacity:capacities.get(type)});
    };
    // Server-confirmed lists/record tags take precedence. Fill only remaining
    // slots within the returned limit, never an extra fifth normal list just
    // because querying its contents returned an empty successful response.
    for(const g of recordGroups)ensure(g.type,g.name,g.name);
    for(const type of TYPES) {
      const limit=limits.get(type)||0;
      const slots=Array.from({length:limit},(_,i)=>i+1);
      for(const slot of slots){
        const count=worldGroups.filter(g=>g.type===type).length;
        if(count>=limit)break;
        const name=`${type==='world'?'worlds':'vrcPlusWorlds'}${slot}`;
        ensure(type,name,'',true);
      }
    }
    worldGroups.sort((a,b)=>(a.type==='world'?0:1)-(b.type==='world'?0:1)
      || Number(a.name.match(/\d+$/)[0])-Number(b.name.match(/\d+$/)[0]));
    worldGroups.forEach((g,i)=>{if(g.synthetic)g.label=`Favorite Worlds ${i+1}`});
    this.groups=worldGroups;this.records=records;if(includeRecords){this.ready=true;this.updatedAt=Date.now()}return this;
  }
  current(worldId) { return (this.records.get(worldId)||[]).map(r=>({...r,tags:[...r.tags]})); }
  members(key) {
    const group=this.groups.find(g=>g.key===key);
    return group ? [...this.records].filter(([,rows])=>rows.some(r=>r.type===group.type&&r.tags.includes(group.name))).map(([id])=>id) : [];
  }
  number(worldId) {
    return this.groups.findIndex(g=>this.current(worldId).some(r=>r.type===g.type&&r.tags.includes(g.name)))+1;
  }
  async rename(key, displayName, expectedLabel) {
    const name=typeof displayName==='string'?displayName.trim():'';
    if(this.pending || !/^usr_[A-Za-z0-9_-]+$/.test(this.account||'') || !name || name.length>20 || /[\r\n\u0000]/.test(name))throw new Error('Invalid world list name');
    this.pending=true;
    try {
      if(!this.ready)await this.load(true);else await this.refreshGroups();
      const group=this.groups.find(g=>g.key===key);
      if(!group || group.label!==expectedLabel){const e=new Error('World list changed elsewhere');e.favoriteConflict=true;throw e}
      if(group.label===name)return;
      await this.api.fetchJson(`/favorite/group/${group.type}/${group.name}/${encodeURIComponent(this.account)}`,{method:'PUT',body:JSON.stringify({displayName:name})});
      try{await this.refreshGroups()}catch(e){e.outcomeUnknown=true;throw e}
      if(this.groups.find(g=>g.key===key)?.label!==name){const e=new Error('World list rename unconfirmed');e.outcomeUnknown=true;throw e}
    } finally {this.pending=false}
  }
  async add(worldId, row) {
    let record;
    try{record=await this.api.fetchJson('/favorites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:row.type,favoriteId:worldId,tags:row.tags})})}
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
    if(!record || !/^fvrt_[A-Za-z0-9_-]+$/.test(record.id||'') || record.favoriteId!==worldId
      || (record.type&&record.type!==row.type) || !Array.isArray(record.tags) || signature([{type:row.type,tags:record.tags}])!==signature([row])){
      const error=new Error('World Favorite write response unavailable');error.outcomeUnknown=true;throw error;
    }
    return {id:record.id,type:row.type,tags:[...record.tags]};
  }
  async change(worldId, desired, expected) {
    if(!validId(worldId) || this.pending) throw new Error('World Favorite operation unavailable');
    this.pending=true;
    try {
      await this.load(true);
      const previous=this.current(worldId);
      if(signature(previous)!==signature(expected)) {const e=new Error('World Favorite changed elsewhere');e.favoriteConflict=true;throw e}
      if(desired.some(r=>!TYPES.has(r.type)||!r.tags.length||r.tags.some(tag=>!this.groups.some(g=>g.type===r.type&&g.name===tag))))throw new Error('World Favorite list unavailable');
      if(signature(previous)===signature(desired))return {previous,expected:previous,syncFailed:false};
      // Check fresh metadata before deleting any record for a move/restore.
      // Unavailable worlds cannot be re-added, so rollback is not a remedy.
      if(desired.length){
        let world;
        try{world=await this.api.fetchJson(`/worlds/${encodeURIComponent(worldId)}`)}catch(error){
          if([403,404].includes(error?.status))error.favoriteWorldUnavailable=true;
          error.favoriteNoMutation=true;throw error;
        }
        if(!world || world.id!==worldId || worldIsUnavailable(world)
          || (world.releaseStatus!=='public' && (!this.account || world.authorId!==this.account))){
          const error=new Error('World cannot be added to Favorites');error.favoriteWorldUnavailable=true;error.favoriteNoMutation=true;throw error;
        }
      }
      const deleted=[],created=[];
      try {
        for(const row of previous){await this.api.removeFavoriteRecord(row.id);deleted.push(row)}
        for(const row of desired){created.push(await this.add(worldId,row))}
      } catch(error) {
        if(error?.name==='AbortError'||error?.outcomeUnknown)throw error;
        // Roll back only confirmed rejected operations. Never replay an
        // uncertain POST/DELETE, including an uncertain rollback request.
        try {
          for(const row of created)await this.api.removeFavoriteRecord(row.id);
          for(const row of deleted)await this.add(worldId,row);
        }catch(rollback){error.favoriteRollbackFailed=true;error.outcomeUnknown=Boolean(rollback?.outcomeUnknown);}
        this.ready=false;this.updatedAt=0;
        throw error;
      }
      if(created.length)this.records.set(worldId,created);else this.records.delete(worldId);
      // DELETE succeeded and every POST response has been validated. Apply
      // those confirmed records to the fresh preflight snapshot rather than
      // downloading every account Favorite a second time. Failures still use
      // the existing single reconciliation path in the caller.
      this.updatedAt=Date.now();
      return {previous,expected:created,syncFailed:false,syncError:null};
    } finally {this.pending=false}
  }
}
