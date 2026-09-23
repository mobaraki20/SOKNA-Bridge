param(
  [string[]]$Tags=@(),
  [string]$Text='',
  [ValidateSet('observed','confirmed','canonical','superseded','all')][string]$Status='all',
  [int]$Limit=20
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$path=Join-Path $root 'docs\knowledge\agent-lessons.jsonl'
if(-not(Test-Path $path -PathType Leaf)){throw 'KNOWLEDGE_BASE_MISSING'}
$items=@()
foreach($line in Get-Content $path -Encoding UTF8){
  if([string]::IsNullOrWhiteSpace($line)){continue}
  $x=$line|ConvertFrom-Json
  if($Status-ne'all' -and [string]$x.status-ne$Status){continue}
  if($Tags.Count){$xt=@($x.tags|ForEach-Object{([string]$_).ToLowerInvariant()});$hit=$true;foreach($t in $Tags){if($xt-notcontains([string]$t).ToLowerInvariant()){$hit=$false;break}};if(-not$hit){continue}}
  if(-not[string]::IsNullOrWhiteSpace($Text)){$hay=(@($x.id,$x.scope,$x.symptom,$x.root_cause,$x.preferred_pattern,$x.tags)-join' ').ToLowerInvariant();if(-not$hay.Contains($Text.ToLowerInvariant())){continue}}
  $items+=$x;if($items.Count-ge[Math]::Min([Math]::Max($Limit,1),100)){break}
}
@{ok=$true;count=$items.Count;lessons=$items}|ConvertTo-Json -Depth 12 -Compress
