@echo off
title Family Web Stream - Interface TV & Web
cd /d "%~dp0"

echo ==============================================================
echo       FAMILY WEB STREAM - Interface TV, PC & Mobile
echo ==============================================================
echo.
echo Demarrage du serveur local haute performance...

set "NODE_EXE=node"
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    ) else (
        echo [ERREUR] Node.js n'a pas ete trouve sur votre ordinateur.
        echo Veuillez installer Node.js pour lancer le simulateur.
        pause
        exit /b
    )
)

"%NODE_EXE%" tools/preview-server.js
pause

