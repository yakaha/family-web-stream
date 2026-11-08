@echo off
title Deploiement Automatique vers Render via GitHub
cd /d "%~dp0"
set "PATH=C:\Program Files\Git\cmd;%PATH%"

echo ======================================================================
echo    ENVOI DES MISES A JOUR VERS RENDER (via GitHub)
echo ======================================================================
echo.
echo Envoi en cours vers https://github.com/yakaha/family-web-stream.git ...
git push origin main

if %errorlevel% equ 0 (
    echo.
    echo ======================================================================
    echo [SUCCES] Code envoye avec succes sur GitHub !
    echo Render.com detecte automatiquement le push et deploie la mise a jour.
    echo Votre PWA sera en ligne dans environ 1 minute.
    echo ======================================================================
) else (
    echo.
    echo [ATTENTION] La commande git push a echoue.
    echo Si GitHub vous demande de vous identifier dans la fenetre qui s'ouvre,
    echo validez votre connexion.
)

echo.
pause
