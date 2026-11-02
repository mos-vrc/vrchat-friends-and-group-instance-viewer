# VRChat Viewer Mobile（非公式ユーザースクリプト）

iPhone（Safari）で VRChat の Favorite フレンドの居場所を確認するための、読み取り専用のユーザースクリプトです。Chrome 拡張機能版の「Favorite+」相当の表示をスマホ向けにしたもので、VRChat のログイン状態を使うだけです。ID・パスワードを集めることはありません。

利用は自己責任でお願いします。

## 用意するもの

- iPhone + Safari
- 「Userscripts」アプリ（App Store、無料）

## 導入方法

1. App Store で「Userscripts」を入れる
2. 拡張機能を許可する
   設定 → アプリ → Safari → 拡張機能 → Userscripts をオンにして、「すべてのWebサイト」を許可する
3. 保存先フォルダを決める
   Userscripts アプリを開いて、保存先を「このiPhone内」のフォルダにする（iCloud Drive でなくて大丈夫です）
4. スクリプトファイルをダウンロードする
   Safari で [vrc-viewer-mobile.user.js](vrc-viewer-mobile.user.js) を開き、画面右上の「↓」ボタンを押す
5. ファイルを保存先フォルダへ移す
   「ファイル」アプリ → ダウンロード → ファイルを長押し →「移動」→ 手順3のフォルダを選んで「移動」
6. Safari で vrchat.com にログインして、右下に出る「フレンド」ボタンで開く（最初は Favorite+ が表示されます）

## ハマりどころ（先に読んでください）

- ホーム画面に直接追加すると、URL の `#vrcviewer` が消えてしまいます。ショートカットアプリで「URLを開く」を作ってから、それをホーム画面に追加してください
  開く URL はこちらです： `https://vrchat.com/home#vrcviewer`
- ショートカットで Chrome が開いてしまうときは、URL の先頭を `x-safari-https://` に変えると Safari で開きます
  例： `x-safari-https://vrchat.com/home#vrcviewer`

## 注意

- 非公式のユーザースクリプトです。利用は自己責任でお願いします
- VRChat のログイン状態を使うだけの読み取り専用です。ID・パスワードは集めません
- 表示されるデータは端末の中だけで完結し、外部に送信しません

## ファイル

- [vrc-viewer-mobile.user.js](vrc-viewer-mobile.user.js)（バージョン 0.5.4）
- 動作確認： iPhone SE（第3世代）+ Safari + Userscripts アプリ
