# Security / 通信仕様

このページは、VRChat Friends & Group Instance Viewer v1.5.2.1 の認証・通信仕様を確認しやすくするための補足資料です。

## VRChatログインセッション

本拡張機能は、Chromeにすでに存在する有効なVRChatログインセッションを利用してVRChat APIへアクセスします。

拡張機能自身は以下を行いません。

- VRChatのユーザー名・パスワードを要求する
- 認証Cookie値や認証トークンの入力を要求する
- `cookies` 権限を要求する
- `chrome.cookies` APIを使用する
- 認証Cookie値をJavaScriptから読み取る
- 認証Cookie値や認証トークンを保存する
- 独自に `Cookie` ヘッダーを生成する

`background.js` のAPIアクセスでは `credentials: 'include'` を使用し、Chrome自身の通常のCookie処理によりVRChatのCookieが適用されます。

## API通信先

APIリクエストは `background.js` と `session.js` の両方で `https://vrchat.com/api/1/` に制限しています。

`background.js` の `isAllowedApiUrl()` は以下を確認します。

- HTTPSであること
- ホスト名が `vrchat.com` であること
- パスが `/api/1/` から始まること

また `manifest.json` の `connect-src` は `https://vrchat.com` に限定しています。

## 画像の読み込み先

表示用画像については `manifest.json` のCSPで以下を許可しています。

- `https://vrchat.com`
- `https://api.vrchat.cloud`
- `https://files.vrchat.cloud`

これらはVRChat関連コンテンツの表示用途です。

## 開発者サーバーへの送信

v1.5.2.1には、開発者独自サーバーへフレンド情報、インスタンス情報、認証情報等を送信する処理はありません。

Google Analytics、Sentry、広告SDK等の外部分析・テレメトリも使用していません。

確認する場合は、主に以下のファイルをご覧ください。

- `manifest.json` — 権限、Host permission、CSP
- `background.js` — API URL制限、`credentials: 'include'`、User-Agentヘッダー処理
- `session.js` — VRChat API URLの検証とService Workerへの通信
- `config.js` — API Base URL
- `api.js` — VRChat APIエンドポイントとリクエスト処理

## User-Agent

VRChat APIクライアントを識別できるよう、通常のChrome User-Agentへ以下を追記します。

`VRChatFriendsGroupInstanceViewer/<version> (contact @mos_vrc)`

この処理には `declarativeNetRequestWithHostAccess` を使用します。Cookieヘッダーを追加・変更するためには使用しません。

## 検証用ハッシュ

GitHub Release に添付した v1.5.2.1 配布ZIPの SHA-256:

`5f302b1c6ec8ace9522eae11a94ff2b36fa9d84f1334c9cd1e79a2acb27707e8`

リポジトリ上の各拡張機能ファイルのSHA-256は [SOURCE_FILES_SHA256.txt](./SOURCE_FILES_SHA256.txt) に記載しています。


## Favorite変更操作

v1.5 では、ユーザーが明示的にFavoriteメニューを操作した場合に限り、VRChat APIの `POST /favorites` および `DELETE /favorites/{favoriteId}` を使用してFriend Favoriteを登録・移動・解除します。認証方式は他のAPI通信と同じで、Chromeの既存VRChatログインセッションを利用し、拡張機能JavaScriptからCookie値を読み取り・保存・手動送信しません。

Favorite List移動のロールバックは、削除後の再登録そのものが失敗した場合だけ実行します。変更成功後のFavorite一覧再同期が失敗した場合は、成功済みの変更を取り消さずローカル状態へ反映し、次回更新時に再同期します。