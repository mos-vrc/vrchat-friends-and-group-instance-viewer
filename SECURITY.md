# Security / 通信仕様

このページは、VRChat Friends & Group Instance Viewer v1.5.4.23 の認証・通信仕様を確認しやすくするための補足資料です。

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

通常APIの送信先は引き続き `https://vrchat.com/api/1/` に限定しています。画像本文取得のため、`manifest.json` の `connect-src` とHost permissionでは `https://vrchat.com`、`https://api.vrchat.cloud`、`https://files.vrchat.cloud` を許可しています。

## 画像の読み込み先

表示用画像については `manifest.json` のCSPで以下を許可しています。

- `https://vrchat.com`
- `https://api.vrchat.cloud`
- `https://files.vrchat.cloud`

これらはVRChat関連コンテンツの表示用途です。`blob:`は取得済み画像データをローカルに表示するために許可します。

## 開発者サーバーへの送信

v1.5.4.23には、開発者独自サーバーへフレンド情報、インスタンス情報、認証情報等を送信する処理はありません。

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

各拡張機能ファイルのSHA-256は [SOURCE_FILES_SHA256.txt](./SOURCE_FILES_SHA256.txt) に記載しています。この動作確認用パッケージでは未作成のGitHub Release ZIPのハッシュは掲載しません。

## v1.5.4.23の通信制御

- APIはHTTPS・vrchat.comの標準ポート・/api/1/以下へ制限し、URL内の資格情報を拒否します。
- Workerは自身の拡張機能からのメッセージだけ受け付け、使用するGET/POST/DELETEと、名称変更専用のPUT以外のメソッドを拒否します。外部から渡された任意のヘッダーを転送せず、Acceptと必要なContent-Typeだけを設定します。
- fetchのリダイレクトを拒否します。1回の通信には本文読み取りも含め20秒のタイムアウトを設けます。
- 同一Workerが複数画面の開始間隔・同時実行・429/5xx待機をまとめて管理します。IndexedDBには待機期限の数値だけを保存します。認証情報は保存しません。
- GETの同じ実行中URLは共有し、同一アカウント内の詳細取得も統合します。キャッシュはアカウント単位です。
- 画面が非表示の間は新しいGETと自動更新・Hydrationを待機します。すでに送信したリクエストやユーザーが実行した変更の結果処理は継続する場合があります。
- 401時は左右一覧・プレビューを消去し、古い非同期処理を無効にします。

## Favorite変更操作

v1.5 では、ユーザーが明示的にFavoriteメニューを操作した場合に限り、VRChat APIの `POST /favorites` および `DELETE /favorites/{favoriteId}` を使用してFriend Favoriteを登録・移動・解除します。認証方式は他のAPI通信と同じで、Chromeの既存VRChatログインセッションを利用し、拡張機能JavaScriptからCookie値を読み取り・保存・手動送信しません。

Favorite List移動のロールバックは、削除後の再登録そのものが失敗した場合だけ実行します。変更成功後のFavorite一覧再同期が失敗した場合は、成功済みの変更を取り消さずローカル状態へ反映し、次回更新時に再同期します。


変更要求のタイムアウト・通信切断・5xx・不正な成功応答などでは、サーバー側で処理済みの可能性があります。その場合はPOST/DELETE/PUTの自動再送やFavorite移動の自動ロールバックを行いません。更新で状態を確認するよう案内します。明確な拒否応答で再登録に失敗した場合は、従来どおり元のFavorite Listの復元を試みます。

## Favorite List名の変更

明示的な保存操作でのみ `PUT /favorite/group/friend/{groupName}/{userId}` を使用します。対象は自身のアカウントのgroup_0〜group_2で、本文にはdisplayNameだけを送信します。WorkerはこのPUT経路以外と、不正な本文・空欄・20文字超過を拒否します。Favorite Listの公開範囲、所属、内部IDを変更しません。

成功後はFavorite Groupメタデータを1回取得して表示名を確認し、アカウントごとの既存Favoriteキャッシュを更新します。再確認だけが失敗した場合は保存済みの名前を保持します。保存要求の結果が不明な場合は自動再送せず、手動更新での確認を案内します。認証切れ・アカウント変更・キャッシュ削除後の遅い応答は表示とキャッシュへ反映しません。

## v1.5.4.23の画像取得

- images.jsは画像本体をGETで取得し、検証したPNG/JPEG/GIF/WebP/AVIFのバイト列をメモリ上のBlobとして共有。IndexedDB/localStorageへ画像本体や署名URLを新たに保存しない。
- URLはHTTPSのVRChat関連3ホストに限定し、URL内のユーザー名/パスワードを拒否。/api/以下は/api/1/image/または/api/1/file/だけ許可し、/auth等の認証APIへ画像としてアクセスしない。
- 画像のリダイレクトは配信先の解決に必要なため許可。ただしCSPで通信先を3ホストへ限定し、最終URLも再確認。通常APIのリダイレクト拒否は維持。
- vrchat.com/api.vrchat.cloudへの画像GETはChrome自身のCookie機構を使う。files.vrchat.cloudへの直接GETはcredentials:omit。Cookie値・認証トークンをJSから読む処理はない。
- 自身の拡張機能を開始元とするvrchat.com/api.vrchat.cloudの/api/1/通信にUser-Agentを付与。Cookieヘッダーの生成・変更はしない。
- 各Viewer画面で最大10並列、開始間隔50ms。画像本文を含む20秒で中断し、単一画像は8MiBまで。429はRetry-Afterに従ってその画面の次の画像取得を停止。タイムアウト・通信失敗・429で自動再送せず、サイズ指定URLの400/404/415だけ元URLへ1回フォールバック。
- 同じ取得URLの要求は1つの処理に統合し、複数imgへ同じBlob URLを設定。すべての利用者が消えた未完了要求をキャンセル。アカウント変更、認証切れ、キャッシュ削除で画像データを消去し、旧応答を破棄。
- 利用されていない画像を古い順に解放し、32MiBまたは256エントリを超えるキャッシュを整理。表示中の画像は参照があるため、この上限を超える場合もある。認証情報の永続保存は行わない。
- 従来のWorker/APIの2並列制限とは別枠。10並列の画像枠は複数Viewer画面全体で共有するものではない。

## Offline表示と操作の復元

Offline対象は認証済みユーザーのofflineFriendsに限定し、オンライン一覧/onlineFriends/activeFriendsを優先して除外。キャッシュされたプロフィールの在席状態を使用しません。不足する名前・画像URLをoffline=trueのフレンド一覧へ最大100件を要求し、実際の応答件数でoffsetを進めて取得し、選択したIDに対応する表示情報だけを既存アカウント別キャッシュへ保存します。応答形状が不正、IDが揃わない、APIが失敗した場合は名前検索の完了を宣言しません。個別プロフィール要求への大量フォールバックはしません。OFF/非表示/認証切れ/アカウント変更/キャッシュ削除後の遅い応答を表示へ反映しません。権限と認証方式は変更しません。

右側「その他」のOffline子セクションは折り畳み中にカード/画像要素を生成せず、展開時も画像本体は表示付近に限定します。名前一覧の取得は折り畳みと独立し、ユーザーの名前検索を可能にします。

「戻す」は最新の確定したFavorite所属操作を対象とし、復元前にライブ所属を検証します。所属が変わっていた場合やライブ確認が失敗した場合は書き込みません。復元中の重複を防止し、結果不明のPOST/DELETEを再送しません。確認と書き込みの間の他画面操作はサーバー側の原子的な排他を保証できません。期限切れ・認証切れ・アカウント変更・キャッシュ削除で復元情報を破棄します。

Offline一覧は公式Webサイトのパラメーター構成に合わせ、vパラメーターを使用しません。短いページでは終了せず、必要な名前が揃うか空ページに達するまで継続します。同一ページの繰り返しとページ上限で終了を保証します。不足時のConsole診断には人数・ページ数・offset・最後の件数・停止理由・HTTP状態・補完の試行/成功/情報取得不可/失敗件数・状態コード別件数だけを含め、ユーザーID・名前・認証情報は記録しません。

一覧終了時に未取得の名前が20人以内残った場合だけ、該当IDをGET /users/{userId}で順番に補完します。同時要求は共有し、Worker全体のAPI開始間隔250ms・最大2並列の制御を通します。補完は逐次実行し、名前・画像URL等の表示用フィールドだけを保存します。403は次のIDへ進み、404は参照不可として一覧と人数から除外して次のIDへ進み、それ以外の失敗はそこで補完を中断します。401はセッション失効処理を行います。取得失敗を成功として扱わず、次の更新時に再試行できます。残りが21人以上なら大量の個別取得は行いません。

404確認結果は表示用のアカウント別キャッシュへ、IDをキーにnull/status=404/cachedAtだけを保存して10分再利用します。404を理由にユーザーやFavoriteの登録データを変更・削除しません。参照不可の原因を推測したタグやBAN情報は保存しません。通信失敗・403・不正な200応答は参照不可として除外しません。

Offlineの日時表示用としてlast_activityのUTC文字列とローカル確認時刻lastActivityCheckedAtを表示用キャッシュへ保存します。日時の鮮度は10分で判定し、次の読み込み時に一括一覧を更新します。名前キャッシュが有効でも、日時が未確認・古い場合は追加の一覧通信が発生します。UTC値は保存時に書き換えず、表示時のみブラウザのタイムゾーンへ変換します。last_loginや認証情報はこの追加機能で保存しません。在席判定に最終アクティブ日時は使用しません。
