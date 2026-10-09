import { t } from './i18n.js';

// Read failures share the toolbar refresh action. Never use this for writes:
// a failed/uncertain mutation needs its own outcome and recovery guidance.
const readFailures = Object.freeze({
  friends: 'フレンド情報を取得できませんでした。更新ボタンで再取得してください。',
  groups: '一部のGroup情報を取得できませんでした。更新ボタンで再取得してください。',
  offline: '一部のOffline情報を取得できませんでした。更新ボタンで再取得してください。',
  worlds: 'ワールドを取得できませんでした。更新ボタンで再取得してください。',
  recent: '訪問ワールドを取得できませんでした。更新ボタンで再取得してください。',
  worldFavorites: 'ワールドFavoriteを取得できませんでした。更新ボタンで再取得してください。',
});

export function readFailureMessage(kind, error) {
  if (error?.status === 429) {
    return t('アクセスが集中しています。少し時間をおいて更新ボタンで再取得してください。');
  }
  return t(readFailures[kind] || readFailures.friends);
}
