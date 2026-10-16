// Leave room below the closed panel so opening the memo never shrinks the list.
export const MEMO_PANEL_HEIGHT=84;
export function notificationPanelMaxHeight(available,open){
  const total=Math.max(0,Math.min(620,available));
  return Math.max(0,total-(open?0:MEMO_PANEL_HEIGHT));
}
