param(
  [string]$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path,
  [string]$RuntimeVersion='2.7.1'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

function Fail([string]$Code,[string]$Detail=''){
  if([string]::IsNullOrWhiteSpace($Detail)){throw $Code}
  throw ($Code+': '+$Detail)
}
function Read-Utf8([string]$Path){return [IO.File]::ReadAllText($Path,[Text.Encoding]::UTF8)}

$runtime=Join-Path $RepoRoot ('native\runtime\v'+$RuntimeVersion)
if(-not(Test-Path -LiteralPath $runtime -PathType Container)){Fail 'WIN_ADV_RUNTIME_MISSING' $runtime}

# 1) Parse every shipped PowerShell file with the actual Windows PowerShell parser.
$parseErrors=@()
$psFiles=@(& git -C $RepoRoot ls-files '*.ps1' '*.psm1')
if($LASTEXITCODE-ne0){Fail 'WIN_ADV_GIT_LSFILES_FAILED'}
foreach($rel in $psFiles){
  $tokens=$null;$errs=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $RepoRoot $rel),[ref]$tokens,[ref]$errs)
  foreach($e in @($errs)){$parseErrors+=($rel+' :: '+$e.Message)}
  $ast.FindAll({param($n)$n -is [Management.Automation.Language.ParameterAst] -and $n.Name.VariablePath.UserPath -ieq 'args'},$true)|%{$parseErrors+=($rel+' :: automatic parameter collision: $args')}
}
if(@($parseErrors).Count-gt0){Fail 'WIN_ADV_PS51_PARSE' (($parseErrors|Select-Object -First 12)-join' | ')}

# 2) Reject keyword adjacency that PS5.1 can tokenize as a command instead of control flow.
$lexicalErrors=@()
$releasePs=@(
  Get-ChildItem -LiteralPath $runtime -File -Recurse | Where-Object { $_.Extension -in @('.ps1','.psm1') }
  Get-ChildItem -LiteralPath (Join-Path $RepoRoot 'tools\runtime\releases') -File -Recurse | Where-Object { $_.Extension -in @('.ps1','.psm1') }
)
$returnPattern='\breturn(?=[\$\[\("'+[char]39+'])'
$throwPattern='\bthrow(?=[\$"'+[char]39+'])'
foreach($f in $releasePs){
  $t=Read-Utf8 $f.FullName
  if($t -match $returnPattern){$lexicalErrors+=($f.FullName+' :: return adjacency')}
  if($t -match $throwPattern){$lexicalErrors+=($f.FullName+' :: throw adjacency')}
}
if(@($lexicalErrors).Count-gt0){Fail 'WIN_ADV_PS51_LEXICAL' (($lexicalErrors|Select-Object -First 12)-join' | ')}

# 3) Go ProviderResult uses omitempty. Under StrictMode, direct $r.optional_property is forbidden.
$modelPath=Join-Path $RepoRoot 'native\provider\model.go'
$providerModule=Join-Path $runtime 'Sokna.ArtifactProvider.psm1'
$model=Read-Utf8 $modelPath
$pm=Read-Utf8 $providerModule
$block=[regex]::Match($model,'type\s+ProviderResult\s+struct\s*\{(?<body>.*?)\r?\n\}',[Text.RegularExpressions.RegexOptions]::Singleline)
if(-not $block.Success){Fail 'WIN_ADV_PROVIDER_RESULT_MODEL_NOT_FOUND'}
$optional=@([regex]::Matches($block.Groups['body'].Value,'json:"(?<name>[^",]+),omitempty"')|ForEach-Object{$_.Groups['name'].Value}|Sort-Object -Unique)
if(@($optional).Count-lt1){Fail 'WIN_ADV_PROVIDER_OPTIONAL_FIELDS_EMPTY'}
$direct=@()
foreach($name in $optional){if($pm-match ('\$r\.'+[regex]::Escape($name)+'\b')){$direct+=$name}}
if(@($direct).Count-gt0){Fail 'WIN_ADV_PROVIDER_OPTIONAL_DIRECT_ACCESS' ($direct-join',')}

# Exercise helper semantics with omitted/null/zero/false/empty values under StrictMode.
$mod=Import-Module $providerModule -Force -PassThru
try{
  $obj=('{'+'"size":0,"signature_ok":false,"content_type":"","resumed_bytes":null'+'}'|ConvertFrom-Json)
  $shape=& $mod { param($o)
    [pscustomobject]@{
      missing=(Get-SoknaProviderOptional $o 'attempts' 77)
      nullv=(Get-SoknaProviderOptional $o 'resumed_bytes' 88)
      zero=(Get-SoknaProviderOptional $o 'size' 99)
      falsev=(Get-SoknaProviderOptional $o 'signature_ok' $true)
      empty=(Get-SoknaProviderOptional $o 'content_type' 'fallback')
    }
  } $obj
  if(@($shape).Count -ne 1){Fail 'WIN_ADV_PROVIDER_HELPER_PIPELINE_SHAPE' ([string](@($shape).Count))}
  if([int]$shape.missing -ne 77 -or [int]$shape.nullv -ne 88 -or [int]$shape.zero -ne 0 -or [bool]$shape.falsev -ne $false -or [string]$shape.empty -ne ''){Fail 'WIN_ADV_PROVIDER_HELPER_SEMANTICS' ($shape|ConvertTo-Json -Compress)}
}finally{Remove-Module Sokna.ArtifactProvider -ErrorAction SilentlyContinue}

# 4) Prove expected native failures can be observed under Windows PowerShell 5.1
# without ErrorActionPreference=Stop converting stderr into an early test-harness failure.
$nativeProbeExe=(Get-Command cmd.exe -ErrorAction Stop).Source
$savedEap=$ErrorActionPreference
$probeExit=$null;$probeOutput=@()
try{
  $ErrorActionPreference='Continue'
  $probeOutput=@(& $nativeProbeExe /d /c "echo EXPECTED_NATIVE_STDERR 1>&2 & exit /b 7" 2>&1)
  $probeExit=$LASTEXITCODE
}finally{$ErrorActionPreference=$savedEap}
if([int]$probeExit-ne7){Fail 'WIN_ADV_EXPECTED_NATIVE_FAILURE_EXIT' ([string]$probeExit)}
if((($probeOutput|Out-String).Trim())-notmatch 'EXPECTED_NATIVE_STDERR'){Fail 'WIN_ADV_EXPECTED_NATIVE_FAILURE_STDERR'}

# 5) Re-run the pure PowerShell Windows matrices that previously exposed PS5.1 shape/path bugs.
foreach($rel in @(
  'tools\runtime\releases\2.7.1\Test-ArtifactRoot271.ps1',
  'tools\runtime\releases\2.7.1\Test-Workspace271.ps1',
  'tools\runtime\releases\2.7.1\Test-AdvancedWorkspace271.ps1'
)){
  $path=Join-Path $RepoRoot $rel
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $path | Out-Null
  if($LASTEXITCODE-ne0){Fail 'WIN_ADV_PURE_MATRIX_FAILED' $rel}
}

[ordered]@{
  ok=$true
  schema='sokna-windows-adversarial-preflight-v1'
  runtime=$RuntimeVersion
  parsed_files=@($psFiles).Count
  provider_optional_fields=@($optional).Count
  expected_native_failure_probe=$true
  pure_windows_matrices=3
  powershell=$PSVersionTable.PSVersion.ToString()
}|ConvertTo-Json -Compress
