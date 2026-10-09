param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

$path='extension/chrome/browser_capture_map.js'
if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw 'R14_CAPTURE_SOURCE_MISSING'}
$text=[IO.File]::ReadAllText((Resolve-Path $path),[Text.Encoding]::UTF8).Replace("`r`n","`n")

# Keep generic edit as the last fallback without embedding locale text in this PowerShell source.
$text=[regex]::Replace($text,'C06:\[\["click",\["([^"]+)","([^"]+)","([^"]+)"\]\]\]','C06:[["click",["$2","$3","$1"]]]')
$text=[regex]::Replace($text,'C09:\[\["click",\["([^"]+)","([^"]+)","([^"]+)"\]\]\]','C09:[["click",["$2","$3","$1"]]]')

$lines=[System.Collections.Generic.List[string]]::new()
foreach($line in ($text -split "`n")){[void]$lines.Add($line)}
$found=$false
for($i=0;$i-lt$lines.Count;$i++){
  if($lines[$i].Contains('return /(^|\b)(open|click|select|toggle|type|switch|expand|choose|pick|edit)\b/i.test(a)')){
    $lines[$i]='  return /(^|\b)(open|click|select|toggle|type|switch|expand|choose|pick|edit)\b/i.test(a)||/(\u0628\u0627\u0632 \u06a9\u0646|\u0628\u0627\u0632\u06a9\u0631\u062f\u0646|\u06a9\u0644\u06cc\u06a9|\u0627\u0646\u062a\u062e\u0627\u0628|\u0648\u06cc\u0631\u0627\u06cc\u0634|\u062a\u063a\u06cc\u06cc\u0631 \u062a\u0645|\u062c\u0633\u062a\u062c\u0648)/i.test(a);'
    $found=$true
  }
}
if(-not$found){throw 'R14_INTERACTION_HANDLER_LINE_MISSING'}

$out=$lines -join "`n"
[IO.File]::WriteAllText((Resolve-Path $path),$out,[Text.UTF8Encoding]::new($false))
Write-Host 'R14_CAPTURE_NORMALIZE_OK'
