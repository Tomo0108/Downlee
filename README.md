# Downlee（ダウンリー）

URL からウェブの動画を最高画質のままダウンロードする Windows デスクトップアプリです。
MP4・MKV・WebM・MOV・AVI・MP3・M4A・AAC・FLAC・WAV・Opus・OGG・GIF で保存でき、プレイリストの一括保存・区間の切り出し・字幕・手元のファイルの変換・ページ内の動画の検出ができます。
画面の構成・配色・フォント・UI 部品は Rakuform（RakuManual 由来）から流用しています。説明文は画面に出さず、? ボタン（ヘルプ）に入れています。

> DRM（著作権保護）がかかった動画は扱いません。保護を外す・回避する機能はありません。

## 必要なもの

- Node.js 22.x
- Windows 10 / 11 x64（配布物の作成・実行）。開発・テストは macOS / Linux でも可能です（yt-dlp と ffmpeg を PATH に入れてください）。
- ダウンロードには [yt-dlp](https://github.com/yt-dlp/yt-dlp) と [ffmpeg](https://ffmpeg.org/) を使います。Windows では初回に［設定］→［ツールを準備する］で自動取得するか、配布物に同梱します（`npm run fetch-tools`）。

## 開発

```bash
npm install
npm test             # エンジン（引数づくり・待ち行列・動画の検出・保存）と表示用の処理のテスト（node:test）
npm run typecheck
npm run dev          # ブラウザで画面だけ確認（http://localhost:5200）。見本の動きで、実際のダウンロードはしない
npm run desktop:dev  # ビルドして Electron で起動（実際にダウンロードする）
```

## 配布物の作成（Windows）

```bash
npm run desktop:build   # release/Downlee-Setup-<version>.exe（NSIS、ユーザー単位インストール。yt-dlp・ffmpeg を vendor/bin に取得して同梱）
```

| 項目 | Downlee | Rakuform（参考） |
|---|---|---|
| アプリID | `com.downlee.app` | `com.rakuten.rakuform` |
| ユーザーデータ | `%APPDATA%\Downlee\`（settings.json・history.json・queue.json・bin\） | `%APPDATA%\Rakuform\` |
| 開発サーバーのポート | 5200 | 5190 |

## 構成

```text
electron/main.cjs      メインプロセス（IPC・解析・完了通知・タスクバーの進捗）
electron/ytdlp.cjs     yt-dlp / ffmpeg の引数づくりと出力の読み取り（純粋な処理）
electron/manager.cjs   待ち行列（同時数・一時停止・再開・中止・再試行）
electron/tools.cjs     yt-dlp・ffmpeg の場所・自動取得・更新
electron/sniffer.cjs   ［見つける］の専用ブラウザ（ページが読み込む動画・音声の検出、ログイン状態の受け渡し）
electron/store.cjs     設定・履歴・待ち行列の保存
src/pages/             ダウンロード・見つける・変換・履歴・設定
src/components/        UI 部品（ui/ と HelpButton は Rakuform からコピー）
docs/                  機能の対応表・UI ガイドライン
```

機能の一覧と Video DownloadHelper との対応は [docs/features.md](docs/features.md) を参照してください。
