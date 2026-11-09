param([string]$DestinationPath)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Push-Location $root
try{
  if(-not(Test-Path 'vendor/cubism-core/include/Live2DCubismCore.h')){throw '缺少 Cubism Core，请先执行 scripts/import-sdk.ps1。'}
  & cargo build --release -p pekopet --locked
  if($LASTEXITCODE -ne 0){throw '原生构建失败，未创建交付包。'}
  if(-not $DestinationPath){$DestinationPath=Join-Path $root ('dist/PekoPet-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))}
  $destination=[IO.Path]::GetFullPath($DestinationPath)
  if(Test-Path -LiteralPath $destination){throw "输出目录已存在：$destination"}
  New-Item -ItemType Directory -Force $destination|Out-Null
  Copy-Item -LiteralPath 'target/release/pekopet.exe','package.json','package-lock.json','LICENSE','THIRD_PARTY.md','README.md' -Destination $destination
  foreach($folder in @('plugin','scripts','node_modules')){
    & robocopy (Join-Path $root $folder) (Join-Path $destination $folder) /E /NFL /NDL /NJH /NJS /NP
    if($LASTEXITCODE -gt 7){throw "复制 $folder 失败"}
  }
  $node=(Get-Command node.exe).Source
  Copy-Item -LiteralPath $node -Destination (Join-Path $destination 'node.exe')
  $nodeLicense=Join-Path (Split-Path $node -Parent) 'LICENSE'
  if(Test-Path $nodeLicense){Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $destination 'LICENSE-NODE')}
  Compress-Archive -Path $destination -DestinationPath ($destination+'.zip')
  Write-Output "便携目录：$destination"
  Write-Output "ZIP：$destination.zip"
}finally{Pop-Location}
