# Privacy Policy
## VRChat Friends & Group Instance Viewer

最終更新日: 2026年10月4日

VRChat Friends & Group Instance Viewer（以下「本拡張機能」）は、VRChatのオンラインフレンドおよびFriend / Groupインスタンス情報を取得し、ブラウザ上で見やすく一覧表示するChrome拡張機能です。

本拡張機能は非公式のコミュニティ製ツールであり、VRChat Inc.によって制作、承認、または提供されているものではありません。

## 1. 取り扱う情報

本拡張機能は、機能を提供するためにVRChat APIから以下の情報を取得・処理する場合があります。

- VRChatユーザーID
- 表示名
- フレンド情報
- Favorite情報
- Group情報
- World情報
- Instance情報
- アバター画像やWorldサムネイル等、表示に必要なVRChat上のコンテンツ

これらの情報は、フレンドやインスタンスの一覧表示、フィルター、並べ替え、Invite Meなど、本拡張機能のユーザー向け機能を提供する目的でのみ使用します。

## 2. VRChatログインセッションについて

本拡張機能は、Chromeブラウザにすでに存在する有効なVRChatログインセッションを利用してVRChat APIへアクセスします。

本拡張機能は以下を行いません。

- VRChatのユーザー名やパスワードの入力を要求すること
- 認証トークンや認証Cookie値の入力を要求すること
- Chromeのcookies APIを使用すること
- 認証Cookie値をJavaScriptから読み取ること
- 認証Cookie値や認証トークンを保存すること
- 独自にCookieヘッダーを生成すること

VRChat APIへのリクエストでは、Chrome自身の通常のCookie処理により、適用可能なVRChatログインセッションが使用されます。

## 3. ローカル保存

表示性能の改善およびVRChat APIへの不要な繰り返しアクセスを減らすため、取得したフレンド、Favorite、Group、World、User、Instance等の情報の一部を、Chrome内の本拡張機能専用ストレージへ一時的または継続的にキャッシュする場合があります。

これらのデータは、ユーザーが拡張機能のデータを削除する、または本拡張機能をアンインストールすることにより削除できます。

## 4. 外部への送信

本拡張機能は、機能提供のためにVRChatの公式WebサイトおよびAPIと通信します。

本拡張機能が取り扱うユーザーデータを、開発者自身のサーバーへ送信することはありません。

また、以下のサービスや目的には使用しません。

- Google Analytics等のアクセス解析
- Sentry等の外部テレメトリ
- 広告SDK
- 広告配信
- ユーザーデータの販売
- データブローカーへの提供
- 信用力の評価や融資判断


## 5. Favorite登録・解除

Favorite操作をユーザーが明示的に実行した場合、選択したフレンドIDとFavorite List情報をVRChat公式APIへ送信し、VRChatアカウント上のFriend Favoriteを登録・移動・解除します。この操作のために開発者サーバーへデータを送信することはありません。

## 6. User-Agent

VRChat APIへのリクエストには、本拡張機能を識別するためのUser-Agent識別子を付加します。

形式:

`VRChatFriendsGroupInstanceViewer/<version> (contact @mos_vrc)`

この識別子には、個々のユーザーを識別する情報は含まれません。

## 7. セキュリティ

VRChatとの通信にはHTTPSを使用します。

本拡張機能は、認証Cookie値やパスワード等の認証情報を取得・保存せず、ユーザーのVRChatログインセッションの処理はChrome自身のCookie機構に委ねます。

## 8. Chrome Web Store User Data Policy

本拡張機能におけるユーザーデータの取り扱いは、Chrome Web Store Developer Program PoliciesおよびUser Data Policyの要件に従います。

本拡張機能は、ユーザーデータを本拡張機能の単一目的と無関係な用途に使用せず、承認されている場合を除き第三者へ販売または転送しません。

## 9. プライバシーポリシーの変更

本プライバシーポリシーは、本拡張機能の機能やデータの取り扱い方法の変更に応じて更新される場合があります。

変更した場合は、このページの「最終更新日」を更新します。

## 10. お問い合わせ

本拡張機能に関するお問い合わせは、開発者のXアカウント [@mos_vrc](https://x.com/mos_vrc) までお願いします。
