@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$d='%LOCALAPPDATA%\SOKNA-Bridge-V2'; $p=Join-Path $d 'agent.pid'; if(Test-Path $p){$id=Get-Content $p -ErrorAction SilentlyContinue; if($id){Stop-Process -Id $id -Force -ErrorAction SilentlyContinue}}; $s=[Environment]::GetFolderPath('Startup'); Remove-Item (Join-Path $s 'SOKNA-Bridge-Agent.vbs') -Force -ErrorAction SilentlyContinue"
echo Agent stopped and autostart removed. Browser extension must be removed manually.
pause
