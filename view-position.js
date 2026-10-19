// Preserve a visible card, rather than only a scroll offset, across reordering.
const cards = '.friend-item[data-friend-id],.friend-location-item[data-friend-id],.card[data-location],.recent-world-card[data-world-id]';
const identity = node => ['friendId','worldId','location'].map(key=>[key,node.dataset[key]]).find(([,value])=>value);
const visible = (node,pane) => {const a=node.getBoundingClientRect(),b=pane.getBoundingClientRect();return a.height>0&&a.width>0&&a.bottom>b.top&&a.top<b.bottom&&a.right>b.left&&a.left<b.right;};
export function captureStableView(panes, {attribute, value, anchor} = {}) {
  const snapshot={cancelled:false,panes:[],attribute,value,focusPane:0};
  const cancel=()=>{snapshot.cancelled=true;};
  const onKey=e=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Tab'].includes(e.key))cancel();};
  for(const pane of panes.filter(Boolean)){
    const rows=[...pane.querySelectorAll(cards)], shown=rows.filter(row=>visible(row,pane));
    const matches=[...pane.querySelectorAll(`[${attribute}]`)].filter(n=>n.getAttribute(attribute)===value&&visible(n,pane));
    const target=(anchor&&pane.contains(anchor)&&visible(anchor,pane)?anchor:matches[0])?.closest(cards);
    const primary=target||shown[0];
    const nearby=shown.filter(n=>n!==primary).sort((a,b)=>Math.abs(a.getBoundingClientRect().top-primary.getBoundingClientRect().top)-Math.abs(b.getBoundingClientRect().top-primary.getBoundingClientRect().top));
    const preferred=primary?[primary,...nearby]:[];
    const offset=pane.getBoundingClientRect().top;
    snapshot.panes.push({pane,scrollTop:pane.scrollTop,anchors:preferred.map(node=>({id:identity(node),top:node.getBoundingClientRect().top-offset}))});
    if(anchor&&pane.contains(anchor))snapshot.focusPane=snapshot.panes.length-1;
    pane.addEventListener('wheel',cancel,{passive:true});pane.addEventListener('touchmove',cancel,{passive:true});pane.addEventListener('pointerdown',cancel,{passive:true});pane.addEventListener('keydown',onKey);
  }
  snapshot.dispose=()=>{for(const {pane} of snapshot.panes){pane.removeEventListener('wheel',cancel);pane.removeEventListener('touchmove',cancel);pane.removeEventListener('pointerdown',cancel);pane.removeEventListener('keydown',onKey);}};
  return snapshot;
}
export function restoreStableView(snapshot, {focus=true} = {}) {
  if(!snapshot||snapshot.cancelled)return;
  const restored=[];
  for(const record of snapshot.panes){
    const {pane}=record;if(!pane.isConnected||!pane.getClientRects().length)continue;
    const rows=[...pane.querySelectorAll(cards)];let chosen;
    for(const item of record.anchors){const node=rows.find(n=>item.id&&n.dataset[item.id[0]]===item.id[1]);if(node){chosen={node,item};break;}}
    if(chosen){const scale=pane.getBoundingClientRect().height/pane.offsetHeight||1;pane.scrollTop+=(chosen.node.getBoundingClientRect().top-pane.getBoundingClientRect().top-chosen.item.top)/scale;}
    else pane.scrollTop=record.scrollTop;
    restored.push({pane,node:chosen?.node});
  }
  if(!focus)return;
  const preferred=snapshot.panes[snapshot.focusPane]?.pane;
  const record=restored.find(r=>r.pane===preferred)||restored[0];if(!record)return;
  const targets=[...record.pane.querySelectorAll(`[${snapshot.attribute}]`)].filter(n=>n.getAttribute(snapshot.attribute)===snapshot.value&&!n.disabled&&visible(n,record.pane));
  const fallback=snapshot.attribute.includes('favorite')?record.node?.querySelector('[data-favorite-user-id]:not(:disabled),[data-world-favorite-id]:not(:disabled)'):null;
  const target=targets[0]||fallback||record.node||record.pane;
  if(!target.matches('button,a[href],input,select,textarea,[tabindex]'))target.setAttribute('tabindex','-1');
  target.focus({preventScroll:true});
}
