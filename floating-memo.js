import {t} from './i18n.js';

export const FLOATING_MEMO_KEY='vrc_viewer_floating_memo_v1';
export const FLOATING_MEMO_MAX_LENGTH=200;
function cleanText(value){
  const text=typeof value==='string'?value.slice(0,FLOATING_MEMO_MAX_LENGTH):'';
  return /[\uD800-\uDBFF]$/.test(text)?text.slice(0,-1):text;
}

// A separate, account-scoped note. No API requests or notification storage.
export class FloatingMemo {
  constructor({storage,root,main,list,backToTop,getEnabled,getAccount,onEditingEnd=()=>{}}){
    Object.assign(this,{storage,root,main,list,backToTop,getEnabled,getAccount,onEditingEnd});
    this.panel=root.querySelector('[data-floating-memo-panel]');
    this.toggle=root.querySelector('[data-floating-memo-toggle]');
    this.close=root.querySelector('[data-floating-memo-close]');
    this.input=root.querySelector('textarea');
    this.count=root.querySelector('[data-floating-memo-length]');
    this.status=root.querySelector('[data-floating-memo-status]');
    this.dot=root.querySelector('[data-floating-memo-dot]');
    this.account='';this.key='';this.memo='';this.open=true;this.composing=false;this.saveError=false;this.pendingRemote=false;this.compositionAccount='';
    this.input.addEventListener('compositionstart',()=>{this.composing=true;this.compositionAccount=this.account;});
    this.input.addEventListener('compositionend',()=>{
      const account=this.compositionAccount;this.composing=false;this.compositionAccount='';
      if(account!==this.account){this.render();return;}this.saveInput();
    });
    this.input.addEventListener('input',event=>this.saveInput(event.isComposing));
    this.input.addEventListener('blur',()=>{
      if(this.pendingRemote&&!this.composing&&!this.saveError){this.pendingRemote=false;this.read();this.render();}
      this.onEditingEnd();
    });
    this.toggle.addEventListener('click',()=>this.setOpen(true));
    this.close.addEventListener('click',()=>this.setOpen(false));
    root.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!event.isComposing&&!this.composing&&this.open){event.preventDefault();event.stopPropagation();this.setOpen(false);}
    });
    window.addEventListener('storage',event=>{
      if(!this.key||event.key!==this.key)return;
      if(document.activeElement===this.input||this.composing){this.pendingRemote=true;return;}
      if(!this.saveError){this.read();this.render();}
    });
    window.addEventListener('resize',()=>this.position());
    this.resizeObserver=new ResizeObserver(()=>this.position());
    this.resizeObserver.observe(main);this.resizeObserver.observe(list);this.resizeObserver.observe(root);
    this.render();
  }
  read(){
    const value=this.key?this.storage.get(this.key,null):null;
    this.memo=cleanText(value?.memo);this.open=value?.open!==false;
  }
  select(account){
    account=typeof account==='string'?account:'';
    if(this.account===account)return;
    this.account=account;this.key=account?`${FLOATING_MEMO_KEY}:${encodeURIComponent(account)}`:'';
    this.composing=false;this.saveError=false;this.pendingRemote=false;this.read();this.render();
  }
  sync(){this.select(this.getAccount()||'');this.render();}
  write(change){
    if(!this.key||this.account!==this.getAccount())return false;
    const current=this.saveError?{memo:this.memo,open:this.open}:this.storage.get(this.key,{memo:this.memo,open:this.open});
    const value={memo:cleanText(current?.memo),open:current?.open!==false,...change};
    this.memo=cleanText(value.memo);this.open=value.open!==false;
    this.saveError=!this.storage.set(this.key,{memo:this.memo,open:this.open});return !this.saveError;
  }
  saveInput(isComposing=false){
    if(isComposing&&this.compositionAccount!==this.account){this.render();return;}
    if(!this.account||this.account!==this.getAccount()||this.root.hidden)return;
    this.pendingRemote=false;this.write({memo:cleanText(this.input.value)});
    if(!isComposing&&!this.composing&&this.input.value!==this.memo)this.input.value=this.memo;
    this.render();
  }
  setOpen(open){
    if(!this.account||this.account!==this.getAccount()||!this.getEnabled())return;
    this.write({open:Boolean(open)});this.render();
    if(this.open)this.input.focus({preventScroll:true});else{this.toggle.focus({preventScroll:true});this.onEditingEnd();}
  }
  isEditing(){return !this.root.hidden&&(this.composing||document.activeElement===this.input);}
  render(){
    const enabled=Boolean(this.getEnabled()&&this.account&&this.account===this.getAccount());
    this.root.hidden=!enabled;this.panel.hidden=!this.open;this.toggle.hidden=this.open;
    this.toggle.setAttribute('aria-expanded',String(this.open));
    this.toggle.title=this.toggle.ariaLabel=t('メモを開く')+(this.memo.trim()?' / '+t('メモあり'):'');
    this.close.title=this.close.ariaLabel=t('メモを閉じる');
    this.panel.setAttribute('aria-label',t('メモ帳'));this.input.ariaLabel=t('右下のメモ帳');this.input.placeholder=t('メモ帳');
    if(!this.composing&&this.input.value!==this.memo){
      const start=this.input.selectionStart,end=this.input.selectionEnd;
      this.input.value=this.memo;
      if(document.activeElement===this.input)this.input.setSelectionRange(Math.min(start,this.memo.length),Math.min(end,this.memo.length));
    }
    this.count.textContent=`${this.memo.length} / ${FLOATING_MEMO_MAX_LENGTH}`;
    this.dot.hidden=!this.memo.trim();
    this.status.textContent=this.saveError?t('メモを保存できませんでした。'):'';
    this.position();
  }
  position(){
    if(!this.backToTop)return;
    if(this.root.hidden){this.backToTop.style.bottom='16px';return;}
    const bounds=this.main.getBoundingClientRect(),scale=bounds.height/this.main.offsetHeight||1;
    const available=(bounds.bottom-this.list.getBoundingClientRect().top)/scale;
    this.panel.style.maxHeight=`${Math.max(28,available-16-16-44)}px`;
    const height=this.root.getBoundingClientRect().height/scale;
    this.backToTop.style.bottom=`${16+height+8}px`;
  }
}
