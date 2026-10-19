#requires -version 5.1
<#
.SYNOPSIS
  Collect bounded, metadata-only evidence for the standalone SOKNA Bridge.
.DESCRIPTION
  Read only: never installs, repairs, restarts, stops, prints, or accesses an application database.
  Excludes command lines, tokens, URLs, environment variables, logs, and user content.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [string]$InstallRoot = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($OutputPath) -or -not [IO.Path]::IsPathRooted($OutputPath)) {
  throw 'OUTPUT_PATH_MUST_BE_ABSOLUTE'
}
$destination = [IO.Path]::GetFullPath($OutputPath)
if (-not [string]::Equals([IO.Path]::GetExtension($destination),'.json',[StringComparison]::OrdinalIgnoreCase)) {
  throw 'OUTPUT_MUST_BE_JSON'
}
if (Test-Path -LiteralPath $destination) { throw 'OUTPUT_ALREADY_EXISTS_REFUSING_OVERWRITE' }
$services = @()
foreach ($svc in @(Get-Service -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -like 'Sokna.Agent*' -or $_.Name -like 'Sokna.Bridge*' -or
  $_.DisplayName -like 'SOKNA Bridge*' -or $_.DisplayName -like 'SOKNA Agent*'
})) {
  $services += [ordered]@{ name = [string]$svc.Name; status = [string]$svc.Status; start_type = [string]$svc.StartType }
}
$installed = @()
$uninstallRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
foreach ($key in $uninstallRoots) {
  foreach ($item in @(Get-ItemProperty -Path $key -ErrorAction SilentlyContinue)) {
    $name = ''
    $version = ''
    if ($null -ne $item.PSObject.Properties['DisplayName']) { $name = [string]$item.DisplayName }
    if ($null -ne $item.PSObject.Properties['DisplayVersion']) { $version = [string]$item.DisplayVersion }
    if ($name -match '^SOKNA(?: |-|$)' -and $name.Length -le 160 -and $name -match '(?i)Bridge|Agent') {
      $installed += [ordered]@{ display_name=$name; display_version=$version }
    }
  }
}
$hashes = @()
if (-not [string]::IsNullOrWhiteSpace($InstallRoot)) {
  if (-not [IO.Path]::IsPathRooted($InstallRoot)) { throw 'INSTALL_ROOT_MUST_BE_ABSOLUTE' }
  $root = [IO.Path]::GetFullPath($InstallRoot)
  foreach ($file in @('Sokna.Agent.Maintenance.exe','Sokna.Agent.Launcher.exe','Sokna.Bridge.ControlCenter.exe',
                     'native-host\sokna-bridge-native-host.exe','browser\sokna-browser-qa.exe')) {
    $absolute = Join-Path $root $file
    if (Test-Path -LiteralPath $absolute -PathType Leaf) {
      $sha=[Security.Cryptography.SHA256]::Create()
      $stream=$null
      try {
        $stream=[IO.File]::OpenRead([IO.Path]::GetFullPath($absolute))
        $hash=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()
      } finally {
        if($null-ne$stream){$stream.Dispose()}
        $sha.Dispose()
      }
      $hashes += [ordered]@{ file=$file; sha256=$hash }
    }
  }
}
$report = [ordered]@{
  schema='sokna-bridge-windows-inventory-v1'
  evidence_kind='read_only_metadata_snapshot'
  real_uat_qualified=$false
  timestamp_utc=[DateTime]::UtcNow.ToString('o')
  host_os=[Environment]::OSVersion.VersionString
  services=$services
  installed_entries=$installed
  executable_hashes=$hashes
  exclusions=@('No service mutation','No secrets or command lines','No target application/network/print test','No install qualification')
}
$parent = [IO.Path]::GetDirectoryName($destination)
if (-not (Test-Path -LiteralPath $parent -PathType Container)) { [void](New-Item -ItemType Directory -Path $parent -Force) }
$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $destination -Encoding UTF8
Write-Output 'READ_ONLY_INVENTORY_WRITTEN'
