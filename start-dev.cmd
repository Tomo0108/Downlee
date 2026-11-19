@echo off
rem Downlee の画面確認用：開発サーバーを起動してブラウザで開きます（見本の動きで、実際のダウンロードはしません）。
rem 実際にダウンロードするときは npm run desktop:dev を使ってください。
rem 止めるときはこのウィンドウを閉じるか Ctrl+C を押してください。
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://localhost:5200
call npm run dev
pause
