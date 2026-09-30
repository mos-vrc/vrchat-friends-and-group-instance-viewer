# VRChat Friends & Group Instance Viewer

VRChatのオンラインフレンドとFriend / Groupインスタンスを、Chrome上で見やすく一覧表示するManifest V3拡張機能です。

**Current version: v1.4.22**

> Chrome Web Store版は現在審査中です。審査完了までは、GitHub Releasesに添付したZIPから手動インストールできます。

本拡張機能は非公式のコミュニティ製ツールであり、VRChat Inc.によって制作、承認、または提供されているものではありません。

## 主な機能

- オンラインフレンドとFriend / Groupインスタンスの一覧表示
- `Favorite` / Favorite List 1〜3 / `Join Friends` によるフレンド絞り込み
- `Favorite List順` / `名前順` によるフレンド並べ替え
- `すべて` / `Favorite+` / `Favorite` / `Group` タブ
- `フレンドが多い順` / `人数が多い順` によるインスタンス並べ替え
- Public / Friends / Friends+ / Invite / Invite+ / Group / Group+ / Group Public / Private等の状態表示
- `Invite Me`
- ワールド名からVRChat公式Launchページを開く機能
- ユーザーアイコンからVRChat公式プロフィールを開く機能
- フレンド一覧の折り畳み
- インスタンスサイズ `小 / 中 / 大`
- テーマ `ライト / アッシュ / ダークブルー / ダーク`
- 自動更新 `なし / 10分 / 30分`

## 必要なもの

- Google Chrome
- 同じChromeブラウザに有効なVRChatログインセッション

VRChat公式サイトのタブを開いたままにする必要はありません。

## 手動インストール

Chrome Web Store公開前の暫定配布版は、GitHubの **Releases** からインストールできます。

1. ReleasesのAssetsから配布用ZIPをダウンロードします。
2. ZIPを任意のフォルダへ展開します。
3. Chromeで `chrome://extensions/` を開きます。
4. 右上の「デベロッパーモード」を有効にします。
5. 「パッケージ化されていない拡張機能を読み込む」を選択します。
6. 展開したフォルダ内の、`manifest.json` があるフォルダを指定します。
7. 拡張機能アイコンから起動します。

**注意:** GitHubが自動生成する `Source code (zip)` ではなく、ReleaseのAssetsに手動添付された配布用ZIPを使用してください。

Chrome Web Store版の公開後は、手動インストール版を削除してストア版へ移行することを推奨します。手動版とストア版では拡張機能IDが異なる場合があり、設定やローカルキャッシュが自動移行しないことがあります。

## 認証

本拡張機能は、Chromeにすでに存在するVRChatのブラウザログインセッションを利用します。

- APIリクエストは `https://vrchat.com/api/1` に送信します。
- Extension Service Workerから `credentials: include` でアクセスします。
- `cookies` 権限と `chrome.cookies` APIは使用しません。
- VRChatの認証Cookie値を拡張機能JavaScriptから読み取りません。
- Cookie値や認証トークンを拡張機能ストレージへ保存しません。
- 独自に `Cookie` ヘッダーを生成しません。
- Cookieの選択と送信はChromeの通常のCookie処理に任せます。

401が返った場合は、VRChat公式サイトへの再ログインを案内します。

## User-Agent

VRChat APIへのリクエストでは、Chromeの通常User-Agentを維持したまま、次の識別子を追記します。

`VRChatFriendsGroupInstanceViewer/<version> (contact @mos_vrc)`

`declarativeNetRequest` のセッションルールは、この識別子を `https://vrchat.com/api/1/` への拡張機能自身のAPIリクエストへ追記する目的だけに使用します。Cookieヘッダーの設定には使用しません。

## 権限

Manifest V3で以下を使用します。

- `declarativeNetRequestWithHostAccess`
- Host permission: `https://vrchat.com/*`

`declarativeNetRequestWithHostAccess` は、VRChat APIリクエストへ拡張機能のUser-Agent識別子を追記するために使用します。

`cookies` 権限、`scripting` 権限、content scriptは使用しません。

## データ取得・キャッシュ

Friends / Favorites / Group Instancesは通常ロード時にライブ取得を試みます。取得に失敗した場合のみ、同じVRChatアカウントの最後の成功データへフォールバックします。

詳細情報にはローカルキャッシュを利用します。

- Instance: 30秒
- World: 7日
- User: 24時間
- Group: 24時間
- Group取得失敗: 10分

APIリクエスト間には最低250msの間隔を設け、429応答時は `Retry-After` を考慮してバックオフしながら最大3回までリトライします。

## プライバシー

- ユーザー名・パスワードの入力を要求しません。
- 認証Cookie値や認証トークンを取得・保存しません。
- 取得したフレンド、Favorite、Instance、World、User、Group等の一部を、表示性能改善とAPI負荷低減のためChrome内にキャッシュします。
- 開発者サーバーへのユーザーデータ送信は行いません。
- Google Analytics、Sentry、広告SDK等の外部分析・テレメトリサービスは使用しません。

詳細は [Privacy Policy](./PRIVACY.md) を参照してください。


## お問い合わせ

X: [@mos_vrc](https://x.com/mos_vrc)
