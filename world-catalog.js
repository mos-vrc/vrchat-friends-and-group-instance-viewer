import { CONFIG } from './config.js';
// Selected-list details only. Discard this memory cache when the account changes.
const validWorld = (world, id) => world && world.id === id && typeof world.name === 'string';
const validGroup = group => group && (group.type === 'world' ? /^worlds(?:0|[1-9]\d*)$/.test(group.name) : group.type === 'vrcPlusWorld' && /^vrcPlusWorlds[1-9]\d*$/.test(group.name));
// The server can return a successful tombstone object instead of null/404.
// Keep its registration ID, but never use its black image or "???" labels.
export function worldIsUnavailable(world) {
  if(world?.pending || world?.loadFailed)return false;
  const name=typeof world?.name==='string'?world.name.trim():'';
  return Boolean(world?.unavailable || !name || /^[?？]+$/.test(name) || /^World Currently Unavailable$/i.test(name));
}
const catalogWorld = world => worldIsUnavailable(world) ? {id:world.id,unavailable:true} : world;
export class WorldCatalog {
  constructor(){this.worlds=new Map();this.inflight=new Map();this.groupInflight=new Map();this.unsupportedGroups=new Set();}
  seed(rows) {
    for(const world of rows) if(/^wrld_[A-Za-z0-9_-]+$/.test(world?.id||'') && validWorld(world,world.id)) this.worlds.set(world.id,catalogWorld(world));
  }
  async load(ids, api, {force=false, group=null, groupResponse=null, current=()=>true, shouldContinue=current, onProgress=()=>{}, onWorld=()=>{}}={}) {
    const unique=[...new Set(ids)].filter(id=>/^wrld_[A-Za-z0-9_-]+$/.test(id||''));
    const needed=unique.filter(id=>force || !this.worlds.has(id));
    if(!needed.length || !current() || !shouldContinue())return;
    const notify=()=>{if(current())onProgress()};
    const supplied=new Set();
    if(validGroup(group) && typeof api.fetchJson==='function' && !this.unsupportedGroups.has(group.key)){
      const key=`${group.type}:${group.name}`;
      let task=this.groupInflight.get(key);
      if(!task){
        task=(groupResponse?Promise.resolve(groupResponse):api.fetchJson(`/favorites/groups/${group.type}/${encodeURIComponent(group.name)}`)).finally(()=>this.groupInflight.delete(key));
        this.groupInflight.set(key,task);
      }
      try {
        const response=await task;
        if(!current())return;
        if(!response || !Array.isArray(response.favorites))this.unsupportedGroups.add(group.key);
        else {
          const allowed=new Set(needed);
          for(const row of response.favorites){
            const id=row?.favoriteId;
            if(!allowed.has(id) || (row.type && row.type!==group.type) || (row.tags && (!Array.isArray(row.tags) || !row.tags.includes(group.name))))continue;
            if(validWorld(row.world,id)){this.worlds.set(id,catalogWorld(row.world));onWorld(row.world);supplied.add(id)}
            else if(row.world===null){this.worlds.set(id,{id,unavailable:true});supplied.add(id)}
          }
          notify();
        }
      }catch(error){
        if(!current())return;
        // Never turn auth failures, rate limits or an outage into a storm of
        // individual requests. Only unsupported routes fall back automatically.
        if(![400,403,404,405,501].includes(error?.status))throw error;
        this.unsupportedGroups.add(group.key);
      }
    }
    const remaining=needed.filter(id=>!supplied.has(id));
    let cursor=0, failure=null;
    const fetchOne=async id=>{
      if(!force && this.worlds.has(id)){notify();return}
      let task=this.inflight.get(id);
      if(!task){
        task=(async()=>{
          let world;
          try {
            const data=await api.fetchWorld(id);
            if(!validWorld(data,id))throw new Error('Invalid world response');
            world=catalogWorld(data);
          }catch(error){
            // A transport failure or exhausted 429/5xx retry budget does not
            // establish that this world is unavailable. Stop this list load.
            if(![403,404].includes(error?.status))throw error;
            world={id,unavailable:true};
          }
          return world;
        })().finally(()=>this.inflight.delete(id));
        this.inflight.set(id,task);
      }
      const world=await task;
      if(current()){this.worlds.set(id,world);onWorld(world);notify()}
    };
    await Promise.all(Array.from({length:Math.min(CONFIG.API_READ_CONCURRENCY,remaining.length)},async()=>{
      while(!failure && cursor<remaining.length && current() && shouldContinue()) {
        try { await fetchOne(remaining[cursor++]); }
        catch(error) { failure ||= error; }
      }
    }));
    if(failure)throw failure;
  }
}
export function worldPlatforms(world) {
  if(!Array.isArray(world?.unityPackages))return null;
  const platforms=new Set(world.unityPackages.map(p=>p?.platform));
  return ['PC','Android'].filter(p=>platforms.has(p==='PC'?'standalonewindows':'android'));
}
