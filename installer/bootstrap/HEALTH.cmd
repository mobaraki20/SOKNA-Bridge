@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-Content $env:LOCALAPPDATA\SOKNA-Bridge-V2\config.json -Raw|ConvertFrom-Json;$b=@{id=('health-'+[guid]::NewGuid().ToString('N'));action='ping';params=@{}}|ConvertTo-Json -Compress;try{$r=Invoke-RestMethod -Uri ('http://127.0.0.1:'+ $c.port +'/api') -Method Post -Headers @{'X-Sokna-Token'=$c.token} -ContentType 'application/json' -Body $b -TimeoutSec 5;$r|ConvertTo-Json -Depth 6;exit 0}catch{Write-Host $_.Exception.Message -ForegroundColor Red;exit 1}"
pause
