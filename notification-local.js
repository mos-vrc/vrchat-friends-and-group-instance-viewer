import {notificationId} from './notifications.js';
import {NotificationImages} from './notification-images.js';
export const MEMO_MAX_LENGTH=200;
export const NOTIFICATION_LOCAL_KEY='vrc_viewer_notification_local_v1';
export function canPinNotification(row){
  return row?.version===2 && !['friendRequest','boop'].includes(row.type)
    && (String(row.type||'').startsWith('group.') || Boolean(row.data&&typeof row.data==='object'&&row.data.groupId));
}
const text=value=>{const s=typeof value==='string'?value.slice(0,MEMO_MAX_LENGTH):'';return /[\uD800-\uDBFF]$/.test(s)?s.slice(0,-1):s;};
const string=value=>typeof value==='string'?value:'';
const thumbnail=value=>typeof value==='string'&&value.length<=24000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)?value:'';
function snapshot(row){
  if(!canPinNotification(row)||!notificationId(row.id))return null;
  const data={};for(const key of ['groupId','groupName','announcementTitle','announcementText','text'])if(typeof row.data?.[key]==='string')data[key]=row.data[key];
  return {id:row.id,version:2,type:string(row.type),title:string(row.title),message:string(row.message),imageUrl:string(row.imageUrl),savedImageSource:string(row.savedImageSource),link:string(row.link),created_at:string(row.created_at||row.createdAt),data};
}
function cleanSaved(row){
  const saved=snapshot(row);if(!saved)return null;
  return {...saved,savedAt:string(row.savedAt),token:string(row.token),thumbnail:thumbnail(row.thumbnail),thumbnailVersion:row.thumbnailVersion===2?2:1};
}
export class NotificationLocal {
  constructor(storage,{images=new NotificationImages(),onChange=()=>{}}={}){this.storage=storage;this.imageStore=images;this.onChange=onChange;this.urls=new Map();this.images=new Map();this.select('');}
  select(account){
    this.releaseImages();this.epoch=(this.epoch||0)+1;this.account=typeof account==='string'?account:'';
    this.key=this.account?`${NOTIFICATION_LOCAL_KEY}:${encodeURIComponent(this.account)}`:'';this.memoKey=this.key?this.key+':memo':'';
    this.images.clear();this.saveError=false;this.imagesReady=false;
    const legacy=this.key?this.storage.get(this.key,{}):{};
    const memo=this.memoKey?this.storage.get(this.memoKey,null):null;
    this.memo=text((memo||legacy)?.memo);this.open=(memo||legacy)?.open===true;
    // Legacy data remains recoverable until each independent destination commits.
    if(this.memoKey&&!memo)this.storage.set(this.memoKey,{memo:this.memo,open:this.open});
    this.apply(this.read());this.ready=this.loadImages();
  }
  read(){
    const value=this.key?this.storage.get(this.key,{}):{};
    const pins=Array.isArray(value?.pins)?[...new Set(value.pins.filter(notificationId))].slice(0,5000):[],allowed=new Set(pins);
    const saved=Array.isArray(value?.saved)?value.saved.map(cleanSaved).filter(row=>row&&allowed.has(row.id)):[];
    return {pins,saved};
  }
  apply(value){this.pins=new Set(value.pins);this.saved=new Map(value.saved.map(row=>{const image=this.images.get(row.id);return [row.id,image?.token===row.token?{...row,thumbnail:image.thumbnail,thumbnailVersion:image.thumbnailVersion}:row];}));}
  reloadMemo(){if(this.saveError)return;const value=this.memoKey?this.storage.get(this.memoKey,null):null;if(value){this.memo=text(value.memo);this.open=value.open===true;}}
  reload(){this.releaseImages();this.apply(this.read());this.reloadMemo();this.ready=this.loadImages();}
  current(){return this.read();}
  write(change){
    if(!this.key)return false;
    const value={...this.current(),...change};
    // Memo storage must commit before removing its legacy copy.
    const memoSaved=this.storage.get(this.memoKey,null)!==null;
    const legacy=memoSaved?{}:this.storage.get(this.key,{});
    const ok=this.storage.set(this.key,memoSaved?value:{...legacy,...value});if(ok)this.apply(value);return ok;
  }
  async loadImages(){
    const account=this.account,epoch=this.epoch,key=this.key,load= this.imageLoad=(this.imageLoad||0)+1;if(!account){this.imagesReady=true;return;}
    this.imagesReady=false;
    const stored=await this.imageStore.load(account);
    if(epoch!==this.epoch||load!==this.imageLoad)return;
    if(stored===null){this.apply(this.read());this.imagesReady=true;this.onChange();return;}
    const selected=new Map(this.read().saved.map(r=>[r.id,r.token]));
    this.images=new Map((stored||[]).filter(r=>selected.get(r.id)===r.token&&thumbnail(r.thumbnail)).map(r=>[r.id,r]));
    const migrated=new Map();
    for(const row of this.read().saved){
      if(!row.thumbnail)continue;
      const prior=this.images.get(row.id);
      const candidate=prior?.token===row.token?prior:row;
      const committed=prior?.token===row.token?prior:await this.imageStore.put(account,candidate);
      if(committed){
        const image=typeof committed==='object'?committed:candidate;
        if(epoch!==this.epoch||load!==this.imageLoad)return;
        if(!this.read().saved.some(r=>r.id===row.id&&r.token===row.token)){void this.imageStore.remove(account,row.id,row.token);continue;}
        this.images.set(row.id,image);migrated.set(row.id,row.token);
      }
    }
    if(epoch!==this.epoch||load!==this.imageLoad)return;
    if(migrated.size){const current=this.read();this.write({saved:current.saved.map(row=>migrated.get(row.id)===row.token?{...row,thumbnail:''}:row)});}
    if(epoch!==this.epoch||load!==this.imageLoad||key!==this.key)return;
    this.apply(this.read());this.imagesReady=true;this.onChange();
  }
  isPinned(row){return canPinNotification(row)&&this.pins.has(row.id);}
  togglePin(row){
    if(!canPinNotification(row)||!notificationId(row.id)||!this.key)return false;
    const current=this.current(),pins=new Set(current.pins);let saved=current.saved,removed=null;
    if(pins.has(row.id)){pins.delete(row.id);removed=saved.find(r=>r.id===row.id);saved=saved.filter(r=>r.id!==row.id);}
    else {if(pins.size>=5000)return false;pins.add(row.id);saved=[...saved,{...snapshot(row),savedAt:new Date().toISOString(),token:crypto.randomUUID(),thumbnail:''}];}
    const ok=this.write({pins:[...pins],saved});if(ok){this.releaseImages();if(removed){this.images.delete(row.id);void this.imageStore.remove(this.account,row.id,removed.token);}}return ok;
  }
  removePin(id){const row=this.saved.get(id);return row?this.togglePin(row):this.write({pins:this.current().pins.filter(x=>x!==id)});}
  writeMemo(change){
    if(!this.memoKey)return false;
    const durable=this.storage.get(this.memoKey,{memo:this.memo,open:this.open});
    const value={...(this.saveError?{memo:this.memo,open:this.open}:durable),...change};
    const ok=this.storage.set(this.memoKey,value);this.memo=text(value.memo);this.open=value.open===true;this.saveError=!ok;return ok;
  }
  setMemo(value){return this.writeMemo({memo:text(value)});}
  setOpen(open){return this.writeMemo({open:Boolean(open)});}
  hasMemo(){return Boolean(this.memo.trim());}
  prune(rows){
    if(!this.key)return true;const current=this.current(),saved=new Map(current.saved.map(r=>[r.id,r])),pins=new Set(current.pins);let changed=false;
    for(const row of rows)if(pins.has(row.id)&&!saved.has(row.id)&&canPinNotification(row)){
      saved.set(row.id,{...snapshot(row),savedAt:new Date().toISOString(),token:crypto.randomUUID(),thumbnail:''});changed=true;
    }
    return !changed||this.write({saved:[...saved.values()]});
  }
  rows(live=[]){
    const byId=new Map(live.map(row=>[row.id,row]));
    for(const [id,saved] of this.saved){const source=byId.get(id);byId.set(id,{...source,...saved,responses:source?.responses||[],seen:source?.seen,__saved:true,__savedOnly:!source});}
    return [...byId.values()];
  }
  async setThumbnail(id,token,value){
    const image=thumbnail(value);if(!image)return false;
    const account=this.account,epoch=this.epoch,key=this.key;await this.ready;if(epoch!==this.epoch)return false;
    const row=this.current().saved.find(r=>r.id===id&&r.token===token),existing=this.images.get(id);
    if(!row||existing?.token===token&&existing.thumbnailVersion===2)return false;
    const record={id,token,thumbnail:image,thumbnailVersion:2};
    const committed=await this.imageStore.put(account,record);if(!committed)return false;
    const durable=this.storage.get(key,{});
    if(!durable.saved?.some(r=>r.id===id&&r.token===token)||!durable.pins?.includes(id)){void this.imageStore.remove(account,id,token);return false;}
    if(epoch===this.epoch){this.images.set(id,typeof committed==='object'?committed:record);this.apply(this.read());this.releaseImages();}
    // A tiny cross-document signal never carries image or notification content.
    this.storage.set(key+':image-event',{at:Date.now(),nonce:Math.random()});
    return true;
  }
  imageUrl(row){
    if(!row?.__saved||!thumbnail(row.thumbnail))return '';
    const cached=this.urls.get(row.id);if(cached?.thumbnail===row.thumbnail)return cached.url;
    if(cached)URL.revokeObjectURL(cached.url);
    try{const bytes=Uint8Array.from(atob(row.thumbnail.split(',')[1]),c=>c.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));this.urls.set(row.id,{thumbnail:row.thumbnail,url});return url;}catch{return '';}
  }
  releaseImages(){for(const value of this.urls?.values()||[])URL.revokeObjectURL(value.url);this.urls?.clear();}
}
