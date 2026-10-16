// UI-only relative clock. Timestamps keep their original meaning and timezone.
const formatters=new Map();
export function elapsedUpdateLabel(timestamp, now=Date.now(), locale='ja') {
  if(!Number.isFinite(timestamp)||timestamp<=0)return '';
  const seconds=Math.max(0,Math.floor((now-timestamp)/1000));
  const language=locale==='en'?'en':'ja';
  if(seconds<60)return language==='en'?'Just now':'たった今';
  if(!formatters.has(language))formatters.set(language,new Intl.RelativeTimeFormat(language,{numeric:'always'}));
  const [value,unit]=seconds<3600?[Math.floor(seconds/60),'minute']:seconds<86400?[Math.floor(seconds/3600),'hour']:[Math.floor(seconds/86400),'day'];
  if(language==='ja')return `${value}${{minute:'分',hour:'時間',day:'日'}[unit]}前`;
  return formatters.get(language).format(-value,unit);
}
