; Downlee のインストーラー（electron-builder の NSIS に組み込む。package.json の build.nsis.include）
; Rakuform の build/installer.nsh と同じ作法で、新規インストールとアップデートを分けて最初の画面の見出しと説明を変える。
; 設定・履歴・ツールは AppData に保存しているため、アップデートでは消えない（deleteAppDataOnUninstall: false）。

!ifndef BUILD_UNINSTALLER
  Var dlInstalledDir
  Var dlInstalledVersion
  Var dlWelcomeTitle
  Var dlWelcomeText

  !macro customInit
    ReadRegStr $dlInstalledDir HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $dlInstalledVersion HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    ${if} $dlInstalledDir != ""
      StrCpy $dlWelcomeTitle "Downlee をアップデートします"
      StrCpy $dlWelcomeText "インストール済みの Downlee（ver.$dlInstalledVersion）を ver.${VERSION} に更新します。$\r$\n$\r$\n設定・履歴はそのまま残ります。$\r$\n更新の前に Downlee を閉じてください（ダウンロード中のものは、次の起動で続きから再開できます）。$\r$\n$\r$\n更新する場所：$\r$\n$dlInstalledDir$\r$\n$\r$\n［次へ］を押すと更新を始めます。"
    ${else}
      StrCpy $dlWelcomeTitle "Downlee をインストールします"
      StrCpy $dlWelcomeText "Downlee ver.${VERSION} を、このパソコンに新しくインストールします。$\r$\n$\r$\nこのパソコンを使う利用者ごとのインストールです（管理者の権限は不要です）。$\r$\nインストール後、デスクトップとスタートメニューの「Downlee」から起動できます。$\r$\n$\r$\n［次へ］を押すとインストールを始めます。"
    ${endif}
  !macroend

  !macro customWelcomePage
    !define MUI_WELCOMEPAGE_TITLE "$dlWelcomeTitle"
    !define MUI_WELCOMEPAGE_TEXT "$dlWelcomeText"
    !insertmacro MUI_PAGE_WELCOME
  !macroend
!endif
