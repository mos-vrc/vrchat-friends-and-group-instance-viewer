import { requireAccount } from './account-session.js';
// Image-less event notices have no avatar column, including older saved pins
// whose snapshots predate the category field.
export function isImagelessEventNotification(row) {
  return row?.version===2 && (row.category==='event' || !row.category&&String(row.type||'').startsWith('group.event.')) && !row.imageUrl;
}
// Account-scoped memory only. Notification text is rendered as text, never HTML.
export const notificationId = value => /^(?:not|frq)_[A-Za-z0-9_-]+$/.test(value || '');
export const userId = value => /^usr_[A-Za-z0-9_-]+$/.test(value || '');
export function notificationDetails(row) {
  try { const d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details; return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; } catch { return {}; }
}
export function notificationLocation(row) {
  const d = notificationDetails(row);
  const value = d.worldId || d.location || '';
  return typeof value === 'string' && /^wrld_[0-9a-f-]+:[^\s<>?#]{1,1500}$/i.test(value) ? value : '';
}
// Resolve only the event target supplied by V2; never interpolate arbitrary URLs/HTML.
export function notificationEventUrl(row) {
  if (row?.version !== 2 || typeof row.link !== 'string') return '';
  const id='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const event=row.link.match(new RegExp(`^event:(grp_${id}),(cal_${id})$`,'i'));
  const web=row.link.match(new RegExp(`^https://vrchat\\.com/home/group/(grp_${id})/calendar/(cal_${id})/?$`,'i'));
  const match=event||web;
  return match?`https://vrchat.com/home/group/${match[1]}/calendar/${match[2]}`:'';
}
// Follow the notification's official group target; do not invent post IDs.
export function notificationContentUrl(row) {
  const event=notificationEventUrl(row);if(event)return event;
  if(row?.version!==2||typeof row.link!=='string')return '';
  const id='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const group=row.link.match(new RegExp(`^group:(grp_${id})$`,'i'));
  if(group)return `https://vrchat.com/home/group/${group[1]}`;
  // Preserve explicit official group/post destinations supplied by the API.
  try {
    const url=new URL(row.link);
    if(url.origin!=='https://vrchat.com'||url.username||url.password)return '';
    if(!new RegExp(`^/home/group/grp_${id}(?:/posts(?:/(?:not|post)_${id})?)?/?$`,'i').test(url.pathname))return '';
    return url.href;
  }catch{return '';}
}
export function notificationReadResponse(row){
  // Official web UI acknowledges V2 notifications with a delete response.
  // This is POST /respond, not HTTP DELETE, and does not accept invitations.
  return row.version===2?{type:'delete',data:''}:null;
}
const hasPendingAction=row=>row.type==='friendRequest'||['invite','requestInvite'].includes(row.type)||(Array.isArray(row.responses)&&row.responses.some(r=>['accept','decline'].includes(r?.type))&&!notificationReadResponse(row));
export const REPLY_MAX_LENGTH=64;
export function canReply(row,account){return row?.version!==2&&row?.type==='requestInvite'&&userId(row.senderUserId)&&row.senderUserId!==account;}
export function replySlot(rows,text){
  const same=rows.find(r=>r.message===text);if(same)return {slot:same,update:false};
  const editable=rows.filter(r=>r.slot>0&&r.canBeUpdated===true&&!(Number(r.remainingCooldownMinutes)>0)).sort((a,b)=>Number(Boolean(a.message))-Number(Boolean(b.message))||b.slot-a.slot);
  return editable.length?{slot:editable[0],update:true}:null;
}
export function bulkNotificationAction(row) {
  // Approval requests remain actionable. Informative V2 accept metadata is not a join request.
  if (row.type === 'friendRequest' || row.type === 'group.invite' || row.type === 'group.joinRequest') return null;
  if (row.version === 2 && row.type !== 'group.informative' && Array.isArray(row.responses) && row.responses.some(r => ['accept','decline'].includes(r?.type))) return null;
  return row.version === 2 ? 'read' : 'hide';
}
export class NotificationStore {
  constructor(api, account) { this.api=api;this.account=account;this.rows=[];this.v1=[];this.v2=[];this.v2Error=null;this.ready=false;this.loading=false;this.error=null;this.more=false;this.v1More=false;this.v2More=false;this.v1Verified=false;this.v2Verified=false;this.disposed=false;this.updatedAt=0;this.controller=null;this.inflight=null;this.messages=new Map();this.failures=new Map();this.blocked=new Set();this.dismissed=new Map(); }
  dispose() { this.disposed=true;this.controller?.abort(); this.controller=null; }
  load(force=false) {
    if(this.disposed)return Promise.reject(new DOMException('Disposed','AbortError'));
    if(this.inflight)return this.inflight;
    if(!force&&this.ready&&Date.now()-this.updatedAt<30000)return Promise.resolve();
    const controller=this.controller=new AbortController();this.loading=true;this.error=null;this.v1Verified=false;this.v2Verified=false;
    this.inflight=(async()=>{
      await requireAccount(this.api,this.account);
      if(controller.signal.aborted)return;
      const v1Task=(async()=>{
        const rows=new Map();let complete=false;
        for(let offset=0;offset<2000;){
          const page=await this.api.fetchJson(`/auth/user/notifications?n=${Math.min(100,2000-offset)}&offset=${offset}&hidden=false`,{signal:controller.signal});
          if(!Array.isArray(page))throw new Error('Invalid notifications');
          if (!page.length) { complete=true; break; }
          let added=0;
          for(const row of page.slice(0,2000-offset)) if(notificationId(row?.id) && !rows.has(row.id)) { rows.set(row.id,{...row,version:1}); added++; }
          if(!added)throw new Error('Repeated notifications page');
          offset += page.length;
        }
        return {rows:[...rows.values()].filter(row=>!row.hidden),more:!complete};
      })();
      const v2Task=this.api.fetchJson('/notifications?limit=100',{signal:controller.signal}).then(page=>{
        if(!Array.isArray(page))throw new Error('Invalid group notifications');
        const rows=new Map();for(const row of page)if(notificationId(row?.id))rows.set(row.id,{...row,version:2,created_at:row.createdAt||row.created_at});
        return {rows:[...rows.values()],more:page.length>=100};
      });
      const [v1,v2]=await Promise.allSettled([v1Task,v2Task]);if(controller.signal.aborted)return;
      this.v1Verified=v1.status==='fulfilled';this.v2Verified=v2.status==='fulfilled';
      this.error=v1.status==='rejected'?v1.reason:null;this.v2Error=v2.status==='rejected'?v2.reason:null;
      if(v1.status==='fulfilled'){this.v1=v1.value.rows;this.v1More=v1.value.more;}
      if(v2.status==='fulfilled'){this.v2=v2.value.rows;this.v2More=v2.value.more;}
      this.more=this.v1More||this.v2More;
      this.merge();this.ready=v1.status==='fulfilled'||v2.status==='fulfilled';this.updatedAt=this.error||this.v2Error?0:Date.now();
      // Do not silently make uncertain sending operations replayable after reload.
    })().catch(e=>{if(!controller.signal.aborted)this.error=e;}).finally(()=>{this.loading=false;this.inflight=null;});
    return this.inflight;
  }
  merge(){const rows=new Map();for(const row of [...this.v1,...this.v2])if(this.dismissed.get(row.id)!==String(row.type||'')&&(row.version===2||row.seen!==true||hasPendingAction(row)))rows.set(row.id,row);this.rows=[...rows.values()].sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));}
  async replyMessages(row,force=false) {
    if(!canReply(row,this.account))throw new Error('Self invite');
    const type=row.type==='requestInvite'?'requestResponse':'response';
    if(!force&&this.messages.has(type))return this.messages.get(type);
    const rows=await this.api.fetchJson(`/message/${encodeURIComponent(this.account)}/${type}`);
    if(!Array.isArray(rows))throw new Error('Invalid messages');
    const usable=rows.filter(r=>Number.isInteger(r.slot)&&r.slot>=0&&r.slot<=11&&typeof r.message==='string');
    this.messages.set(type,usable);return usable;
  }
  async bulkAct(row){
    const action=bulkNotificationAction(row);if(!action||this.blocked.has(row.id))return {skipped:true};
    await this.act(row,action);return {action};
  }
  async verifyOutcome(row) {
    if (!this.blocked.has(row.id)) return {resolved:false};
    const me = await requireAccount(this.api,this.account);
    await this.load(true);
    const failed = row.version === 2 ? this.v2Error : this.error;
    const more = row.version === 2 ? this.v2More : this.v1More;
    const source = row.version === 2 ? this.v2 : this.v1;
    // A missing row in a partial/failed list does not prove successful mutation.
    if (this.disposed || !(row.version===2?this.v2Verified:this.v1Verified) || failed || more || source.some(r => r.id === row.id)) return {resolved:false};
    this.dismissed.set(row.id,String(row.type||''));this.blocked.delete(row.id);this.merge();
    return {resolved:true};
  }
  async readAct(row){
    // Reading is strictly a response, never deletion or hiding.
    await this.act(row,'read');return {action:'read'};
  }
  async act(row,action,value) {
    if(!this.rows.some(r=>r.id===row.id)||this.blocked.has(row.id))throw new Error('Notification unavailable');
    const me=await requireAccount(this.api,this.account);
    const base=`/auth/user/notifications/${encodeURIComponent(row.id)}`;
    let sent=false;
    try {
      if(row.version===2){
        const path=`/notifications/${encodeURIComponent(row.id)}`;
        if(action==='read'){
          const response=notificationReadResponse(row);
          if(!response)throw new Error('Unsupported response');
          const body={responseType:response.type,responseData:typeof response.data==='string'?response.data:''};
          const result=await this.api.fetchJson(path+'/respond',{method:'POST',body:JSON.stringify(body)});
          if(result?.error){const error=new Error(String(result.error.message||'Notification response rejected'));error.status=Number(result.error.status_code)||400;error.apiMessage=error.message;throw error;}
        }else if(['accept','decline'].includes(action)){
          const response=Array.isArray(row.responses)?row.responses.find(r=>r?.type===action):null;
          if(!response)throw new Error('Unsupported response');
          const body={responseType:action};if(typeof response.data==='string')body.responseData=response.data;
          await this.api.fetchJson(path+'/respond',{method:'POST',body:JSON.stringify(body)});
        }else throw new Error('Unsupported action');
      }else if(action==='accept'&&row.type==='friendRequest')await this.api.fetchJson(base+'/accept',{method:'PUT'});
      else if(action==='hide')await this.api.fetchJson(base+'/hide',{method:'PUT'});
      else if(action==='reply'&&canReply(row,this.account)){
        if(typeof value!=='string'||!value.trim()||value.length>REPLY_MAX_LENGTH||value.includes('\u0000'))throw new Error('Invalid reply');
        const messages=await this.replyMessages(row,true),choice=replySlot(messages,value);if(!choice)throw new Error('Reply cooldown');
        const slot=choice.slot.slot;
        if(choice.update){
          const type=row.type==='requestInvite'?'requestResponse':'response';
          await this.api.fetchJson(`/message/${encodeURIComponent(this.account)}/${type}/${slot}`,{method:'PUT',body:JSON.stringify({message:value})});
          this.messages.delete(type);
        }
        await this.api.fetchJson(`/invite/${encodeURIComponent(row.id)}/response`,{method:'POST',body:JSON.stringify({responseSlot:slot})});sent=true;
        await this.api.fetchJson(base+'/hide',{method:'PUT'});
      }else if(action==='invite'&&row.type==='requestInvite'&&userId(row.senderUserId)){
        const location=notificationLocation({details:{worldId:me.location}});if(!location)throw new Error('No current instance');
        await this.api.fetchJson(`/invite/${encodeURIComponent(row.senderUserId)}`,{method:'POST',body:JSON.stringify({instanceId:location})});sent=true;
        await this.api.fetchJson(base+'/hide',{method:'PUT'});
      }else throw new Error('Unsupported action');
      this.dismissed.set(row.id,String(row.type||''));this.updatedAt=0;
      this.rows=this.rows.filter(r=>r.id!==row.id);this.v1=this.v1.filter(r=>r.id!==row.id);this.v2=this.v2.filter(r=>r.id!==row.id);
    }catch(e){if(sent||e.outcomeUnknown){this.blocked.add(row.id);e.notificationUncertain=true;}throw e;}
  }
}
// Exact, shared write allowlist for the native viewer and compatibility worker.
export function allowedNotificationWrite(path,method,text) {
  if(method==='PUT'&&/^\/api\/1\/auth\/user\/notifications\/(?:not|frq)_[A-Za-z0-9_-]+\/(?:accept|hide)$/.test(path))return text==null||text==='';
  if(method==='PUT'&&/^\/api\/1\/message\/usr_[A-Za-z0-9_-]+\/(?:response|requestResponse)\/(?:[1-9]|1[01])$/.test(path)){
    let body;try{body=JSON.parse(text);}catch{return false;}
    return body&&Object.keys(body).length===1&&typeof body.message==='string'&&body.message.trim().length>0&&body.message.length<=REPLY_MAX_LENGTH&&!body.message.includes('\u0000');
  }
  if(method!=='POST')return false;
  let body;try{body=JSON.parse(text);}catch{return false;}
  if(!body||typeof body!=='object'||Array.isArray(body))return false;
  if(/^\/api\/1\/notifications\/not_[A-Za-z0-9_-]+\/respond$/.test(path))return Object.keys(body).every(k=>['responseType','responseData'].includes(k))&&['accept','decline','acknowledge','read','delete'].includes(body.responseType)&&(body.responseType!=='delete'||body.responseData==='')&&(body.responseData===undefined||(typeof body.responseData==='string'&&body.responseData.length<=4096));
  if(Object.keys(body).length!==1)return false;
  if(/^\/api\/1\/invite\/(?:not|frq)_[A-Za-z0-9_-]+\/response$/.test(path))return Number.isInteger(body.responseSlot)&&body.responseSlot>=0&&body.responseSlot<=11;
  if(/^\/api\/1\/invite\/usr_[A-Za-z0-9_-]+$/.test(path))return Boolean(notificationLocation({details:{worldId:body.instanceId}}));
  return false;
}
