param([string]$p,[string]$m,[string]$b='dev/bootstrap-v2.5')
$p=@($p -split ',' | Where-Object { $_ })
$ErrorActionPreference='Stop'
& tools/ci/Test-WindowsAdversarialPreflight.ps1;if(!$?){throw 'P'}
git diff --check;if(!$?){throw 'D'}
$c=@(git diff --name-only;git ls-files --others --exclude-standard)|Sort-Object -Unique
if(@(Compare-Object $c $paths).Count){throw 'F'}
git add -- $paths
git diff --cached --check;if(!$?){throw 'S'}
git commit -m $m;if(!$?){throw 'C'}
git push origin $b;if(!$?){throw 'U'}
git rev-parse HEAD
