; gfx studio NSIS hooks (docs/INSTALL.md §1), included through bundle.windows.nsis.installerHooks by build-installer.sh.
; The two installers (Windows engine / WSL engine) share one app folder; the uninstaller written last only lists its own
; installer's files, so a full uninstall also removes whatever engine the other installer added. Upgrades run the old
; uninstaller first too, which is intended: an engine older than the app has to be reinstalled anyway ("versions match").
; WSL engines inside a distro are not touched here (Settings → Engine & tools → Remove).
; The user PATH entry (Settings → "Add gfx to the Windows PATH") is edited by the app itself (NSIS strings stop at 1024
; characters): the uninstaller always removes it, and the installer adds it back when the app data still records the
; choice, so an upgrade keeps it and a full uninstall leaves nothing.
!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --path-hook install "$APPDATA\${BUNDLEID}"'
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --path-hook uninstall "$APPDATA\${BUNDLEID}"'
!macroend
!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$INSTDIR\engine"
  Delete "$INSTDIR\engine-wsl.tar.gz"
  RMDir "$INSTDIR"
!macroend
