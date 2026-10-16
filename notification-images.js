// Durable pin images are independent of disposable network caches and memo input.
export class NotificationImages {
  constructor({indexedDB=globalThis.indexedDB,timeoutMs=3000}={}){this.indexedDB=indexedDB;this.timeoutMs=timeoutMs;this.database=null;this.opening=null;}
  async open(){
    if(this.database)return this.database;if(this.opening)return this.opening;if(!this.indexedDB)return null;
    this.opening=new Promise(resolve=>{
      let done=false;const finish=db=>{if(done){db?.close();return;}done=true;clearTimeout(timer);resolve(db);};
      const timer=setTimeout(()=>finish(null),this.timeoutMs);
      try{const r=this.indexedDB.open('vrc_viewer_saved_notification_images_v1',1);
        r.onupgradeneeded=()=>{const store=r.result.createObjectStore('images',{keyPath:'key'});store.createIndex('account','account');};
        r.onerror=r.onblocked=()=>finish(null);
        r.onsuccess=()=>{const db=r.result;if(!done){this.database=db;db.onversionchange=()=>{db.close();this.database=null;};}finish(db);};
      }catch{finish(null);}
    }).finally(()=>{this.opening=null;});return this.opening;
  }
  async transaction(mode,run,fallback){
    const db=await this.open();if(!db)return fallback;
    return new Promise(resolve=>{let tx,result=fallback,done=false;
      const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
      const timer=setTimeout(()=>{try{tx?.abort();}catch{}finish(fallback);},this.timeoutMs);
      try{tx=db.transaction('images',mode);tx.oncomplete=()=>finish(result);tx.onerror=tx.onabort=()=>finish(fallback);run(tx.objectStore('images'),value=>{result=value;});}catch{try{tx?.abort();}catch{}finish(fallback);}
    });
  }
  key(account,id,token){return JSON.stringify([account,id,token]);}
  load(account){return this.transaction('readonly',(store,result)=>{const r=store.index('account').getAll(account);r.onsuccess=()=>result(r.result);},null);}
  put(account,row){return this.transaction('readwrite',(store,result)=>{
    const key=this.key(account,row.id,row.token),request=store.get(key);
    request.onsuccess=()=>{
      // Concurrent migration must never replace an already repaired image.
      if(request.result?.thumbnailVersion===2){result(request.result);return;}
      const value={key,account,id:row.id,token:row.token,thumbnail:row.thumbnail,thumbnailVersion:row.thumbnailVersion};
      store.put(value);result(value);
    };
  },false);}
  remove(account,id,token){return this.transaction('readwrite',(store,result)=>{store.delete(this.key(account,id,token));result(true);},false);}
}
