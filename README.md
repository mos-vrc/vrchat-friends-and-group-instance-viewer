# VRChat Friends & Group Instance Viewer

VRChatのオンラインフレンドと Friend / Group インスタンスを、Chrome上で見やすく一覧表示する Manifest V3 拡張機能です。

**Current version: v1.4.29**

- Chrome Web Store: https://chromewebstore.google.com/detail/vrchat-friends-group-inst/pncejiodjgmlklhgkpclcplgacbohbla
- Releases: https://github.com/mos-vrc/vrchat-friends-and-group-instance-viewer/releases
- Privacy Policy: [PRIVACY.md](./PRIVACY.md)
- Security / 通信仕様: [SECURITY.md](./SECURITY.md)

本拡張機能は非公式のコミュニティ製ツールであり、VRChat Inc.によって制作、承認、または提供されているものではありません。

## ソースコードについて

v1.4.29 の拡張機能本体ソースを公開用として管理しています。`manifest.json`、JavaScript、HTML、CSS、アイコンを確認できる構成です。

各ファイルの SHA-256 は [SOURCE_FILES_SHA256.txt](./SOURCE_FILES_SHA256.txt) に記載しています。

直近の GitHub Release（v1.4.28）に添付した配布ZIPの SHA-256:

`26b87d085ecbf8eec29f5c48434095bfb5474f324ecf5336d0acec8316e27b2d`

## 主な機能

- オンラインフレンドと Friend / Group インスタンスの一覧表示
- `Favorite` / Favorite List 1〜3 / `Join Friends` によるフレンド絞り込み
- `Favorite List順` / `名前順` によるフレンド並べ替え
- `すべて` / `Favorite+` / `Favorite` / `Group` タブ
- `フレンドが多い順` / `参加人数が多い順` によるインスタンス並べ替え
- Public / Friends / Friends+ / Invite / Invite+ / Group / Group+ / Group Public / Private 等のインスタンス公開範囲表示
- `Invite Me`
- ワールド名からVRChat公式Launchページを開く機能
- ユーザーアイコンからVRChat公式プロフィールを開く機能
- フレンド一覧の折り畳み
- インスタンスサイズ `小 / 中 / 大`
- インスタンス表示 `シンプル / ノーマル`
- テーマ `ライト / アッシュ / ダークブルー / ダーク`
- 自動更新 `なし / 10分 / 30分`


### インスタンス表示

オプションの「インスタンス表示」は `ノーマル` が初期値です。

- `ノーマル`：従来どおり、ワールド名・インスタンス公開範囲/リージョン・人数・フレンド数・Invite Me・参加ユーザーを表示します。サムネイル右上は `フレンド数 / 参加人数 / 最大人数` で表示します。
- `シンプル`：1段時はカードの高さを参加ユーザーのアバター高さまで圧縮します。参加ユーザーが増えるとカード自体は2段・3段…と必要な高さまで伸びますが、サムネイルはノーマル表示の高さを上限として上部固定で表示し、それ以上は拡大しません。
- `シンプル` のサムネイル上部にはインスタンス公開範囲、`Invite Me`、`フレンド数 / 参加人数 / 最大人数` を表示します。
- `シンプル` では通常インスタンスとPrivateの両方で、ユーザー名をアバター下部の半透明オーバーレイに表示します。Privateもアバター高さを基準にコンパクト化し、人数が多い場合は必要な段数だけ伸びます。
- `シンプル` でもインスタンスサイズ `小 / 中 / 大` は有効です。


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

- APIリクエストは `https://vrchat.com/api/1/` に限定しています。
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

APIリクエスト間には最低250msの間隔を設け、429応答時は `Retry-After` を考慮してバックオフしながら最大3回までリトライします。

## プライバシー

詳細は [Privacy Policy](./PRIVACY.md) を参照してください。

## 注意事項

本拡張機能は非公式ツールです。VRChat APIやWeb側の仕様変更等により、予告なく一時的または継続的に正常動作しなくなる可能性があります。

## お問い合わせ

X: [@mos_vrc](https://x.com/mos_vrc)
