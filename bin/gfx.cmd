@echo off
rem gfx launcher: bundled node (<engine>\node\node.exe) if present, else node on PATH.
setlocal
set "GFX_ENGINE_DIR=%~dp0.."
if exist "%GFX_ENGINE_DIR%\node\node.exe" (
  "%GFX_ENGINE_DIR%\node\node.exe" "%GFX_ENGINE_DIR%\runner\cli.js" %*
) else (
  node "%GFX_ENGINE_DIR%\runner\cli.js" %*
)
exit /b %ERRORLEVEL%
