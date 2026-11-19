# Downlee 作業メモ（Claude 向け）

- 画面を追加・変更する前に `docs/ui-guidelines.md` を読む。説明文は画面に出さず `HelpButton`（`src/components/HelpButton.tsx`）か、設定の `SettingRow` の `hint` に入れる。
- Rakuform・RakuManual は参照のみ。変更・コミットしない。
- DRM（Widevine・PlayReady・FairPlay など）の解除・回避の処理は入れない。DRM の動画は「ダウンロードできません」と伝える。
- フォント（assets/fonts）・yt-dlp / ffmpeg の実行ファイル（vendor/）・ダウンロードした動画はコミットしない。
- cookie・パスワードをファイル・ログ・メモに残さない（専用ブラウザの cookie はダウンロード 1 件ごとの一時ファイルにし、終わったら消す）。
- 確認コマンド：`npm run typecheck`、`npm test`、`npm run build`。
