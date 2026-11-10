param([string]$DestinationPath,[switch]$Resume)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Push-Location $root
try{
  if(-not(Test-Path 'local/cubism-core/include/Live2DCubismCore.h')){throw '缺少 Cubism Core，请先执行 scripts/import-sdk.ps1。'}
  & (Join-Path $PSScriptRoot 'dev.ps1') -BuildOnly -Release
  if($LASTEXITCODE -ne 0){throw '原生构建失败，未创建交付包。'}
  if(-not $DestinationPath){$DestinationPath=Join-Path $root ('dist/PekoPet-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))}
  $destination=[IO.Path]::GetFullPath($DestinationPath)
  if((Test-Path -LiteralPath $destination) -and -not $Resume){throw "输出目录已存在：$destination"}
  New-Item -ItemType Directory -Force $destination|Out-Null
  Copy-Item -LiteralPath 'target/release/pekopet.exe','package.json','package-lock.json','start.bat','LICENSE','THIRD_PARTY.md','README.md' -Destination $destination
  foreach($folder in @('plugin','scripts','assets','node_modules')){
    & robocopy (Join-Path $root $folder) (Join-Path $destination $folder) /E /XJ /MT:16 /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if($LASTEXITCODE -gt 7){throw "复制 $folder 失败"}
  }
  foreach($folder in @('vendor/dsh-ui-chat','node_modules/@deepseek-ai/dsh-client-ui-chat')){
    & robocopy (Join-Path $root 'vendor/dsh-ui-chat') (Join-Path $destination $folder) /E /MT:16 /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    if($LASTEXITCODE -gt 7){throw "复制 dsh React 前端失败"}
  }
  $node=(Get-Command node.exe).Source
  Copy-Item -LiteralPath $node -Destination (Join-Path $destination 'node.exe')
  $nodeLicense=Join-Path (Split-Path $node -Parent) 'LICENSE'
  if(Test-Path $nodeLicense){Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $destination 'LICENSE-NODE')}
  else {
    $version=(& $node --version).Trim()
    $cached=Join-Path $root ('local/node-licenses/'+$version+'/LICENSE')
    if(-not(Test-Path -LiteralPath $cached)){
      New-Item -ItemType Directory -Force (Split-Path $cached -Parent)|Out-Null
      Invoke-WebRequest ('https://raw.githubusercontent.com/nodejs/node/'+$version+'/LICENSE') -UseBasicParsing -OutFile $cached
    }
    Copy-Item -LiteralPath $cached -Destination (Join-Path $destination 'LICENSE-NODE')
  }
  Copy-Item -LiteralPath 'scripts/PekoPet.cmd' -Destination (Join-Path $destination 'PekoPet.cmd')
  $licenses=Join-Path $destination 'licenses'
  New-Item -ItemType Directory -Force $licenses|Out-Null
  Copy-Item -LiteralPath 'vendor/cubism-framework/LICENSE.md' -Destination (Join-Path $licenses 'LICENSE-CUBISM-FRAMEWORK.md')
  Copy-Item -LiteralPath 'vendor/cubism-core/LICENSE.md' -Destination (Join-Path $licenses 'LICENSE-CUBISM-CORE.md')
  Copy-Item -LiteralPath 'vendor/cubism-core/RedistributableFiles.txt' -Destination (Join-Path $licenses 'CUBISM-REDISTRIBUTABLE-FILES.txt')
  $metadata=(& cargo metadata --format-version 1 --locked --filter-platform x86_64-pc-windows-msvc)|ConvertFrom-Json
  if($LASTEXITCODE -ne 0){throw '读取依赖许可清单失败。'}
  foreach($package in $metadata.packages){
    $source=Split-Path $package.manifest_path -Parent
    $files=@(Get-ChildItem -LiteralPath $source -File|Where-Object{$_.Name -match '^(LICEN[CS]E|COPYING|COPYRIGHT|NOTICE)([.-]|$)'})
    if($package.license_file){$files+=Get-Item -LiteralPath (Join-Path $source $package.license_file)}
    if($files.Count){
      $folder=Join-Path $licenses ('rust/'+$package.name+'-'+$package.version)
      New-Item -ItemType Directory -Force $folder|Out-Null
      foreach($file in $files){Copy-Item -LiteralPath $file.FullName -Destination $folder}
    }
  }
  $metadata.packages|Select-Object name,version,license,repository|ConvertTo-Json|Set-Content -Encoding utf8 (Join-Path $licenses 'rust-dependencies.json')
  & (Join-Path $PSScriptRoot 'archive.ps1') -Source $destination -Destination ($destination+'.zip')
  Write-Output "便携目录：$destination"
  Write-Output "ZIP：$destination.zip"
}finally{Pop-Location}
