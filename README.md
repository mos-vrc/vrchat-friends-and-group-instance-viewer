# VRChat Friends & Group Instance Viewer

VRChatのオンラインフレンドと Friend / Group インスタンスを、Chrome上で見やすく一覧表示する Manifest V3 拡張機能です。

**Current version: v1.5.4.5**

- Chrome Web Store: https://chromewebstore.google.com/detail/vrchat-friends-group-inst/pncejiodjgmlklhgkpclcplgacbohbla
- Releases: https://github.com/mos-vrc/vrchat-friends-and-group-instance-viewer/releases
- Privacy Policy: [PRIVACY.md](./PRIVACY.md)
- Security / 通信仕様: [SECURITY.md](./SECURITY.md)

本拡張機能は非公式のコミュニティ製ツールであり、VRChat Inc.によって制作、承認、または提供されているものではありません。

## ソースコードについて

v1.5.4.5 の拡張機能本体ソースを公開用として管理しています。`manifest.json`、JavaScript、HTML、CSS、アイコンを確認できる構成です。

各ファイルの SHA-256 は [SOURCE_FILES_SHA256.txt](./SOURCE_FILES_SHA256.txt) に記載しています。

このZIPは v1.5.4.5 の配布用ソースパッケージです。Chrome Web Store提出用パッケージと拡張機能本体は共通です。撮影用パッケージは別途用意しています。

変更点は [CHANGELOG.md](./CHANGELOG.md) を参照してください。

## 主な機能

- オンラインフレンドと Friend / Group インスタンスの一覧表示
- `Favorite` / Favorite List 1〜3 / `Join Friends` によるフレンド絞り込み
- `Favorite List順` / `名前順` によるフレンド並べ替え
- `すべて` / `Favorite+` / `Favorite` / `Group` のインスタンス表示と、`フレンド` の逆引き表示
- `フレンドが多い順` / `参加人数が多い順` によるインスタンス並べ替え
- Public / Friends / Friends+ / Invite / Invite+ / Group / Group+ / Group Public / Private 等のインスタンス公開範囲表示
- `Invite Me`
- ワールド名からVRChat公式Launchページを開く機能
- ユーザーアイコンからVRChat公式プロフィールを開く機能
- 左フレンド一覧の `通常表示 → 今居るインスタンスも表示 → 非表示` の3段階切り替え
- 表示サイズ `小 / 中 / 大`
- 表示形式 `シンプル / ノーマル`
- テーマ `ライト / アッシュ / ダークブルー / ダーク`
- 自動更新 `なし / 10分 / 30分`（表示中のみ。非表示中に期限を迎えた場合は画面へ戻った際に1回更新）
- 手動の `更新` と、表示設定を残した `キャッシュを削除`
- 自動/手動更新の進行・結果、通常の操作案内は簡易メッセージに表示。初回読み込みと再ログインが必要な案内はステータス欄に表示
- 「すべて」のPrivateは初期状態で折り畳み、展開時に表示用の画像読込を開始
- ユーザー画像256px・World画像512pxを固定取得（認識可能な未署名VRChat画像URL）。同じURLの画像データを画面内で共有
- 画像取得は各Viewer画面で最大10並列・開始間隔50ms・本文を含む20秒上限。表示付近のみ取得


### フレンド表示

- フレンド表示の人数表記はノーマル/シンプルとも `フレンド数 / 参加人数 / 最大人数` です。
- ノーマルのホバープレビューは参加者が少なくても5人分程度の横幅を確保し、タイトルや人数情報を読みやすくします。シンプルは参加者数に応じたコンパクト幅のままです。

右上の `フレンド` で、通常の「インスタンス → フレンド」表示から「フレンド → 現在の居場所」表示へ切り替えられます。

- Favorite List 1〜3（ユーザーが変更したリスト名がある場合はその名称）と `その他` に分けて表示します。
- 各セクションはタイトルクリックで折り畳みできます。`その他` は起動時に折り畳まれ、折り畳み中はそのセクションのカードを生成しないためInstance / World詳細の不要なHydrationを抑えます。
- `Other Platformを表示` がOFFの場合、Other Platformのフレンドはこの表示からも除外します。
- 並び順は `名前順` / `居場所順` を切り替えられます。
- 設定の `表示サイズ` と `表示形式` はフレンド表示にも反映します。シンプルでは公開範囲・参加人数等をサムネイル上へまとめてカード幅を縮めます。リージョンはシンプル表示では省略します。
- Other Platformは `Other Platform` と表示し、サムネイルのプレースホルダーには白黒の地球アイコンを使用します。
- ユーザーカードへ約0.55秒カーソルを合わせると、そのインスタンスの既存カード相当のプレビューを表示します。プレビューでは把握できている参加者一覧を確認でき、Join可能なインスタンスでは `Invite Me` も利用できます。
- Private / Other Platform はホバープレビューを表示しません。プレビューはマウスポインタ右下付近に表示し、参加者は最大5列で折り返します。
- フレンドカードは画面幅に応じて均等に可変し、Favorite Listごとの人数差でカード幅が変わらないようにしています。
- 左フレンド一覧でも通常インスタンスのフレンドへ約0.55秒カーソルを合わせると、同じホバープレビューを表示します。Private / Other Platformでは表示しません。
- 左フレンド一覧の「今居るインスタンスも表示」では、公開範囲・`フレンド数 / 参加人数 / 最大人数`・ワールド名をサムネイル上へ表示します。リージョンは表示せず、画面内へ近づいたフレンドから既存のInstance / Worldキャッシュ・Hydration処理を再利用して取得します。

### Favorite登録・解除

オンラインフレンドのアバター右上にFavorite操作ボタンを表示します。Favorite済みは星、未登録は星なしの丸いボタンです。クリックすると現在のFavorite List名を使ったメニューが開き、Favorite List 1〜3相当への登録・移動、Favorite解除を行えます。Favorite List移動はVRChat API上で削除→再登録となるため、再登録そのものに失敗した場合は元のFavorite Listへの復元を試みます。変更後の再同期だけが失敗した場合は、成功済みの変更をロールバックせずローカル表示へ反映し、次回更新時に再確認します。Favorite List名の取得に一時的に失敗した場合は、前回取得済みのカスタム名を維持します。

Favorite操作と `Invite Me` の一時的な処理状況・結果は、一覧のレイアウトを押し下げない右上のトースト通知で表示します。

### 表示形式

オプションの「表示形式」は `ノーマル` が初期値です。

- `ノーマル`：従来どおり、ワールド名・インスタンス公開範囲/リージョン・人数・フレンド数・Invite Me・参加ユーザーを表示します。サムネイル右上は `フレンド数 / 参加人数 / 最大人数` で表示します。
- `シンプル`：1段時はカードの高さを参加ユーザーのアバター高さまで圧縮します。参加ユーザーが増えるとカード自体は2段・3段…と必要な高さまで伸びますが、サムネイルはノーマル表示の高さを上限として上部固定で表示し、それ以上は拡大しません。
- `シンプル` のサムネイル上部にはインスタンス公開範囲、`Invite Me`、`フレンド数 / 参加人数 / 最大人数` を表示します。
- `シンプル` では通常インスタンスとPrivateの両方で、ユーザー名をアバター下部の半透明オーバーレイに表示します。Privateもアバター高さを基準にコンパクト化し、人数が多い場合は必要な段数だけ伸びます。
- `シンプル` でも表示サイズ `小 / 中 / 大` は有効です。


## 必要なもの

- Google Chrome
- 同じChromeブラウザに有効なVRChatログインセッション

VRChat公式サイトのタブを開いたままにする必要はありません。

## インストール

通常は Chrome Web Store 版の利用を推奨します。

手動インストールする場合は、GitHub Releases の Assets に添付された配布用ZIPをダウンロードして展開し、`chrome://extensions/` で「デベロッパーモード」を有効にしたうえで「パッケージ化されていない拡張機能を読み込む」から `manifest.json` のあるフォルダを指定してください。

GitHubが自動生成する `Source code (zip)` ではなく、Release の Assets に手動添付された配布用ZIPを使用してください。

## 認証と通信

本拡張機能は、Chromeにすでに存在するVRChatのブラウザログインセッションを利用します。

- 通常APIリクエストは `https://vrchat.com/api/1/` に限定しています。画像本文取得は別経路で、VRChat関連3ホストだけに接続します。
- Extension Service Worker から `credentials: 'include'` でアクセスします。
- `cookies` 権限と `chrome.cookies` APIは使用しません。
- VRChatの認証Cookie値を拡張機能JavaScriptから読み取りません。
- Cookie値や認証トークンを拡張機能ストレージへ保存しません。
- 独自に `Cookie` ヘッダーを生成しません。
- Cookieの選択と送信はChromeの通常のCookie処理に任せます。
- 開発者独自サーバーへのユーザーデータ送信処理はありません。
- Google Analytics、Sentry、広告SDK等の外部分析・テレメトリは使用しません。

より詳しい確認ポイントは [SECURITY.md](./SECURITY.md) を参照してください。

## User-Agent

VRChat APIへのリクエストでは、Chromeの通常User-Agentを維持したまま、次の識別子を追記します。

`VRChatFriendsGroupInstanceViewer/<version> (contact @mos_vrc)`

`declarativeNetRequest` のセッションルールは、この識別子を `https://vrchat.com/api/1/` への拡張機能自身のAPIリクエストへ追記する目的だけに使用します。Cookieヘッダーの設定には使用しません。

## 権限

Manifest V3で以下を使用します。

- `declarativeNetRequestWithHostAccess`
- Host permission: `https://vrchat.com/*`

`cookies` 権限、`scripting` 権限、content scriptは使用しません。

## データ取得・キャッシュ

Friends / Favorites / Group Instances は通常ロード時にライブ取得を試みます。取得に失敗した場合のみ、同じVRChatアカウントの最後の成功データへフォールバックします。

詳細情報にはローカルキャッシュを利用します。

- Instance: 30秒
- World: 7日
- User: 24時間
- Group: 24時間
- Group取得失敗: 10分

APIリクエストはService Workerで複数のViewer画面をまとめて制御し、開始間隔を最低250ms、同時実行を最大2件に制限します。同じGET URLの実行中の要求は共有します。429と5xxの応答では他のAPI要求も待機し、Retry-Afterの秒数・HTTP日時を尊重します。待機時刻だけをIndexedDBに保存し、Workerの再起動後も維持します。

GETは429/5xxに対して最大3回再試行します。POST/DELETEは429以外では自動再送しません。1回の実通信は応答本文の読み取りを含め20秒でタイムアウトします。変更結果が不明なFavorite操作やInvite Meは、成功済みの可能性を考慮し自動再送・自動取り消しを避け、ユーザーへ確認を案内します。

取得データのキャッシュはWorld/Instance/User/Groupを含めアカウントごとに分離します。以前のアカウント共通の詳細キャッシュは引き継ぎません。オプションのキャッシュ削除は全アカウントの取得データを削除し、表示設定を保ったまま現在のアカウントを再取得します。通信の待機時刻は削除対象にせず、429待機を迂回しません。

詳細キャッシュへの書き込みは300ms単位でまとめ、画面を離れる際にも保存します。カード・画像は変更した部分だけ更新します。対応するVRChat画像URLだけをユーザー256px・World512pxへ固定し、サイズ指定先が400/404/415の場合だけ元URLへ1回戻します。署名付きURL等は書き換えません。

## プライバシー

詳細は [Privacy Policy](./PRIVACY.md) を参照してください。

## 注意事項

本拡張機能は非公式ツールです。VRChat APIやWeb側の仕様変更等により、予告なく一時的または継続的に正常動作しなくなる可能性があります。

## お問い合わせ

X: [@mos_vrc](https://x.com/mos_vrc)
