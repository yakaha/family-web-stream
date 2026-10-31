@echo off
title Deploiement Family Web Stream sur Render.com
cd /d "%~dp0"

echo ======================================================================
echo          DEPLOYER FAMILY WEB STREAM SUR RENDER.COM
echo ======================================================================
echo.
echo Votre projet est deja pret avec package.json et render.yaml !
echo.
echo ETAPE 1 : Si vous n'avez pas encore cree le depot sur GitHub :
echo   1. Allez sur https://github.com/new
echo   2. Nommez le depot : family-web-stream
echo   3. Choisissez Public (ou Prive) et cliquez sur "Create repository"
echo.
echo ======================================================================
set /p REPO_URL="Entrez l'URL de votre depot GitHub (ex: https://github.com/yakaha/family-web-stream.git) : "

if "%REPO_URL%"=="" (
    echo Aucune URL saisie. Annulation.
    pause
    exit /b
)

set "PATH=C:\Program Files\Git\cmd;%PATH%"

git remote remove origin 2>nul
git remote add origin %REPO_URL%
git branch -M main

echo.
echo Envoi du code vers GitHub...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo [SUCCES] Code envoye avec succes sur GitHub !
    echo.
    echo ETAPE 2 : Sur Render.com :
    echo   1. Allez sur https://dashboard.render.com
    echo   2. Cliquez sur "New +" puis "Web Service"
    echo   3. Selectionnez votre depot GitHub "family-web-stream"
    echo   4. Cliquez sur "Deploy Web Service"
    echo.
    echo Votre application sera en ligne en 1 minute avec son proxy integre !
) else (
    echo.
    echo [ATTENTION] La commande git push a echoue. Verifiez vos identifiants GitHub.
)

pause

