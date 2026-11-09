param([Parameter(Mandatory=$true)][string]$SdkPath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$sdk=(Resolve-Path -LiteralPath $SdkPath).Path
$core=Join-Path $sdk 'Core'
$manifest=Join-Path $core 'RedistributableFiles.txt'
if(-not(Test-Path -LiteralPath $manifest)){throw '缺少 Core/RedistributableFiles.txt，请使用官方 Cubism Native 5-r.5 SDK。'}
$list=Get-Content -LiteralPath $manifest -Raw
$header=Join-Path $core 'include/Live2DCubismCore.h'
$libraryPath='lib/windows/x86_64/143/Live2DCubismCore_MD.lib'
$lib=Join-Path $core $libraryPath
if(-not(Test-Path -LiteralPath $lib)){throw 'SDK 中缺少 Windows x64 / v143 的 Live2DCubismCore_MD.lib。'}
$files=@(@{Source=$header;Relative='include/Live2DCubismCore.h';Target='include/Live2DCubismCore.h'},@{Source=$lib;Relative=$libraryPath;Target='lib/Live2DCubismCore_MD.lib'})
foreach($file in $files){
  $relative=$file.Relative
  $permitted=$false
  foreach($line in ($list -split "`r?`n")){
    $entry=$line.Trim().Replace('\','/').TrimStart('./')
    if($entry.StartsWith('Core/')){$entry=$entry.Substring(5)}
    if($entry -and (($relative -like $entry) -or $entry -eq ([IO.Path]::GetFileName($file.Source)))){$permitted=$true;break}
  }
  if(-not $permitted){throw "SDK 清单未明确列出 $relative，请先核对再分发许可，文件未导入。"}
}
$dest=Join-Path $root 'vendor/cubism-core'
foreach($file in $files){$to=Join-Path $dest $file.Target;New-Item -ItemType Directory -Force (Split-Path $to -Parent)|Out-Null;Copy-Item -LiteralPath $file.Source -Destination $to}
Copy-Item -LiteralPath $manifest -Destination (Join-Path $dest 'RedistributableFiles.txt')
Copy-Item -LiteralPath (Join-Path $core 'LICENSE.md') -Destination (Join-Path $dest 'LICENSE.md')
@{version='Cubism Native 5-r.5';platform='windows-x64-msvc143';files=@($files|ForEach-Object{$_.Target})}|ConvertTo-Json|Set-Content -Encoding utf8 (Join-Path $dest 'version.json')
Write-Output '已导入 SDK 清单允许的 Windows x64 必需文件，并保留许可。'
