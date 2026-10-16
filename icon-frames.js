import {safeImageUrl,escapeHtml} from './domain.js';
export function frameAssets(item){
  const assets=Array.isArray(item?.metadata?.assets)?item.metadata.assets:[];
  const find=type=>safeImageUrl(assets.find(a=>a?.type===type)?.url||'');
  return {base:find('base'),main:find('mainAnimation')};
}
export class IconFrameCatalog {
  constructor(){this.reset();}
  reset(account=''){this.account=account;this.epoch=(this.epoch||0)+1;this.rows=new Map();this.ready=false;this.failed=false;this.inflight=null;}
  async load(api,account){
    if(account!==this.account)this.reset(account);
    if(!account||this.ready||this.failed)return;
    if(this.inflight)return this.inflight;
    const epoch=this.epoch;
    const task=(async()=>{try{
      const rows=await api.fetchJson('/cosmetics/index/iconFrame');
      if(epoch!==this.epoch)return;
      if(!Array.isArray(rows))throw Error('Invalid icon frame index');
      this.rows=new Map(rows.filter(r=>typeof r?.id==='string').map(r=>[r.id,frameAssets(r)]));this.ready=true;
    }catch(error){if(epoch===this.epoch)this.failed=true;throw error;}finally{if(epoch===this.epoch)this.inflight=null;}})();
    this.inflight=task;return task;
  }
  assets(id){return this.rows.get(id)||null;}
}
export function framedAvatar(markup,assets){
  if(!assets||!assets.base&&!assets.main)return markup;
  return `<span class="avatar-frame-wrap">${markup}<img class="avatar-icon-frame" data-frame-base="${escapeHtml(assets.base)}" data-frame-main="${escapeHtml(assets.main)}"${assets.base?` data-image-src="${escapeHtml(assets.base)}"`:''} alt="" aria-hidden="true" decoding="async"></span>`;
}
// GIF playback is native. Only visible frames use mainAnimation; hidden frames use base.
export class FrameAnimations {
  constructor(root=document.body){
    this.root=root;this.items=new Map();this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    this.observer=new IntersectionObserver(entries=>{for(const e of entries){this.items.set(e.target,e.isIntersecting);this.update(e.target);}});
    this.mutations=new MutationObserver(records=>{if(records.some(r=>r.type==='childList'||r.target.classList?.contains('avatar-icon-frame')))this.sync();});this.mutations.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-frame-main','data-frame-base','data-image-src']});
    document.addEventListener('visibilitychange',()=>{for(const image of this.items.keys())this.update(image);});
    this.reduced.addEventListener('change',()=>{for(const image of this.items.keys())this.update(image);});this.sync();
  }
  update(image){
    const animate=this.items.get(image)&&!document.hidden&&!this.reduced.matches;
    const url=animate?(image.dataset.frameMain||image.dataset.frameBase):image.dataset.frameBase;
    if((image.dataset.imageSrc||'')===url)return;
    image.removeAttribute('src');
    if(url)image.dataset.imageSrc=url;else delete image.dataset.imageSrc;
  }
  sync(){
    for(const image of this.items.keys())if(!image.isConnected){this.observer.unobserve(image);this.items.delete(image);}
    for(const image of this.root.querySelectorAll('.avatar-icon-frame')){if(!this.items.has(image)){this.items.set(image,false);this.observer.observe(image);}this.update(image);}
  }
}
