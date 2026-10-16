import {notificationThumbnail} from './notification-snapshot.js';
// At most two captures at once. Failed jobs retry only on an explicit refresh,
// with three total attempts per pin/document; rendering never retries failures.
export class NotificationImageSaver {
  constructor({local,pool,imageUrl,onError=()=>{},onChange=()=>{}}){Object.assign(this,{local,pool,imageUrl,onError,onChange});this.jobs=new Map();this.queue=[];this.active=0;this.epoch=0;}
  clear(){this.epoch++;this.jobs.clear();this.queue=[];}
  save(row,{retry=false}={}){
    if(!this.local.imagesReady)return;
    const saved=this.local.saved.get(row.id),account=this.local.account;
    if(!account||!saved||saved.thumbnail&&saved.thumbnailVersion===2||!(saved.savedImageSource||saved.imageUrl))return;
    const key=account+':'+saved.id+':'+saved.token,old=this.jobs.get(key);
    if(old&&(!retry||old.status!=='failed'||old.attempts>=3))return;
    const job={key,saved,account,epoch:this.epoch,status:'queued',attempts:(old?.attempts||0)+1,retry};
    this.jobs.set(key,job);this.queue.push(job);this.pump();
  }
  retry(){for(const row of this.local.saved.values())this.save(row,{retry:true});}
  current(job){return job.epoch===this.epoch&&job.account===this.local.account&&this.local.saved.get(job.saved.id)?.token===job.saved.token;}
  pump(){
    while(this.active<2&&this.queue.length){const job=this.queue.shift();if(!this.current(job))continue;
      this.active++;job.status='pending';
      void this.run(job).finally(()=>{this.active--;this.pump();});
    }
  }
  async run(job){
    try{
      const saved=job.saved,url=this.imageUrl(saved.savedImageSource||saved.imageUrl,saved.imageUrl?'world':'avatar');
      if(job.retry)this.pool.retryFailed(url);
      const value=await notificationThumbnail(this.pool,url);
      if(!this.current(job))return;
      if(!value||!await this.local.setThumbnail(saved.id,saved.token,value))throw new Error('Thumbnail save failed');
      job.status='saved';
    }catch{job.status='failed';if(this.current(job))this.onError();}
    finally{if(this.current(job))this.onChange();}
  }
}
