@echo off
title Publication vers Render via GitHub
cd /d "%~dp0"
set "PATH=C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;%PATH%"

echo ======================================================================
echo          PUBLICATION DE FAMILY WEB STREAM VERS RENDER
echo ======================================================================
echo.

echo Verification de la connexion GitHub...
gh auth status >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [CONNEXION GITHUB REQUISE]
    echo Votre session GitHub sur ce PC a expire.
    echo Une fenetre de navigateur va s'ouvrir pour vous connecter a GitHub...
    echo.
    gh auth login -h github.com -p https -w
    gh auth setup-git
)

echo.
echo Envoi des mises a jour vers GitHub (Render deploie automatiquement)...
git push origin main

if %errorlevel% equ 0 (
    echo.
    echo ======================================================================
    echo [SUCCES] Code publie avec succes sur GitHub !
    echo Render.com detecte automatiquement le push et deploie la mise a jour.
    echo Votre PWA responsive sera en ligne dans environ 1 minute.
    echo ======================================================================
) else (
    echo.
    echo ======================================================================
    echo [ATTENTION] L'envoi a echoue.
    echo Si vous utilisez un token GitHub (Personal Access Token) :
    echo Entrez votre token lorsqu'il vous est demande.
    echo ======================================================================
)

echo.
echo Appuyez sur une touche pour fermer cette fenetre...
pause >nul
