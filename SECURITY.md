# Security / 通信仕様

このページは、VRChat Friends & Group Instance Viewer v1.4.29 の認証・通信仕様を確認しやすくするための補足資料です。

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

v1.4.29には、開発者独自サーバーへフレンド情報、インスタンス情報、認証情報等を送信する処理はありません。

Google Analytics、Sentry、広告SDK等の外部分析・テレメトリも使用していません。

確認する場合は、主に以下のファイルをご覧ください。

- `manifest.json` — 権限、Host permission、CSP
- `background.js` — API URL制限、`credentials: 'include'`、Cookie/User-Agentヘッダー処理
- `session.js` — VRChat API URLの検証とService Workerへの通信
- `config.js` — API Base URL
- `api.js` — VRChat APIエンドポイントとリクエスト処理

## User-Agent

VRChat APIクライアントを識別できるよう、通常のChrome User-Agentへ以下を追記します。

`VRChatFriendsGroupInstanceViewer/<version> (contact @mos_vrc)`

この処理には `declarativeNetRequestWithHostAccess` を使用します。Cookieヘッダーを追加・変更するためには使用しません。

## 検証用ハッシュ

GitHub Release [v1.4.29](https://github.com/mos-vrc/vrchat-friends-and-group-instance-viewer/releases/tag/v1.4.29)（2026年10月1日公開）に添付した配布ZIP:

`vrchat_friends_and_group_instance_viewer_v1.4.29_release.zip`

SHA-256（GitHub Release API の `assets[].digest` と、ダウンロードしたZIPから計算した値が一致）:

`20cff2b5e25f20ab0c0ef9f801d8a211779ef7d21f0b04df558a83271f652d4c`

このハッシュは、Release の Assets に添付された上記配布ZIPを対象とします。GitHubが自動生成する `Source code (zip)` / `Source code (tar.gz)` のハッシュではありません。

リポジトリ上の各拡張機能ファイルのSHA-256は [SOURCE_FILES_SHA256.txt](./SOURCE_FILES_SHA256.txt) に記載しています。
