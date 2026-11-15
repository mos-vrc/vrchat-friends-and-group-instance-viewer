import { CONFIG } from './config.js';
// Selected-list details only. Discard this memory cache when the account changes.
const validAvatar = (avatar, id) => avatar && avatar.id === id && typeof avatar.name === 'string';
const validGroup = group => group && group.type === 'avatar' && /^avatars[1-9]\d*$/.test(group.name);
// The server can return a successful tombstone object instead of null/404.
// Keep its registration ID, but never use its black image or "???" labels.
export function avatarIsUnavailable(avatar) {
  if(avatar?.pending || avatar?.loadFailed)return false;
  const name=typeof avatar?.name==='string'?avatar.name.trim():'';
  return Boolean(avatar?.unavailable || !name || /^[?？]+$/.test(name) || /^Avatar Currently Unavailable$/i.test(name));
}
const catalogAvatar = avatar => avatarIsUnavailable(avatar) ? {id:avatar.id,unavailable:true} : avatar;
export class AvatarCatalog {
  constructor(){this.avatars=new Map();this.inflight=new Map();this.groupInflight=new Map();this.unsupportedGroups=new Set();}
  seed(rows) {
    for(const avatar of rows) if(/^avtr_[A-Za-z0-9_-]+$/.test(avatar?.id||'') && validAvatar(avatar,avatar.id)) this.avatars.set(avatar.id,catalogAvatar(avatar));
  }
  async load(ids, api, {force=false, group=null, groupResponse=null, current=()=>true, shouldContinue=current, onProgress=()=>{}, onAvatar=()=>{}}={}) {
    const unique=[...new Set(ids)].filter(id=>/^avtr_[A-Za-z0-9_-]+$/.test(id||''));
    const needed=unique.filter(id=>force || !this.avatars.has(id));
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
            if(validAvatar(row.avatar,id)){this.avatars.set(id,catalogAvatar(row.avatar));onAvatar(row.avatar);supplied.add(id)}
            else if(row.avatar===null){this.avatars.set(id,{id,unavailable:true});supplied.add(id)}
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
      if(!force && this.avatars.has(id)){notify();return}
      let task=this.inflight.get(id);
      if(!task){
        task=(async()=>{
          let avatar;
          try {
            const data=await api.fetchAvatar(id);
            if(!validAvatar(data,id))throw new Error('Invalid avatar response');
            avatar=catalogAvatar(data);
          }catch(error){
            // A transport failure or exhausted 429/5xx retry budget does not
            // establish that this avatar is unavailable. Stop this list load.
            if(![403,404].includes(error?.status))throw error;
            avatar={id,unavailable:true};
          }
          return avatar;
        })().finally(()=>this.inflight.delete(id));
        this.inflight.set(id,task);
      }
      const avatar=await task;
      if(current()){this.avatars.set(id,avatar);onAvatar(avatar);notify()}
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
export function avatarPlatforms(avatar) {
  if(!Array.isArray(avatar?.unityPackages))return null;
  const platforms=new Set(avatar.unityPackages.map(p=>p?.platform));
  return ['PC','Android','iOS'].filter(p=>platforms.has(p==='PC'?'standalonewindows':p==='Android'?'android':'ios'));
}
