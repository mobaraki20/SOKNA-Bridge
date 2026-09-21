@echo off
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.sokna.bridge.v3" /f >nul 2>nul
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.sokna.bridge.v3" /f >nul 2>nul
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "SOKNA Bridge Agent" /f >nul 2>nul
echo SOKNA Bridge registry/startup entries removed. Workspaces were not modified.
pause
