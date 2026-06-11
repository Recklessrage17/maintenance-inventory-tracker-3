@echo off
title MIT3 Website Update Puller
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-mit3-website.ps1"
pause
