param([switch]$BuildOnly,[switch]$CheckUi,[switch]$Release)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if(-not(Test-Path -LiteralPath $vswhere)){throw 'Install Visual Studio Build Tools with the C++ desktop workload first.'}
$installation=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if(-not $installation){throw 'MSVC C++ Build Tools were not found. Complete the C++ desktop workload installation.'}
& (Join-Path $installation 'Common7/Tools/Launch-VsDevShell.ps1') -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
$cargoHome=if($env:CARGO_HOME){$env:CARGO_HOME}else{Join-Path $env:USERPROFILE '.cargo'}
$cargo=Join-Path $cargoHome 'bin/cargo.exe'
if(-not(Test-Path -LiteralPath $cargo)){throw 'Install the Rust stable MSVC toolchain with rustup first.'}
$env:Path=(Join-Path $cargoHome 'bin')+';'+$env:Path
$env:CARGO_INCREMENTAL='1'
Remove-Item Env:PEKO_TYPECHECK -ErrorAction SilentlyContinue
Push-Location $root
try{
  & node (Join-Path $PSScriptRoot 'build-frontend.mjs')
  if($LASTEXITCODE -ne 0){throw 'React frontend build failed.'}
  $arguments=@('build','-p','pekopet','--locked')
  if($Release){$arguments+='--release'}
  & $cargo @arguments
  if($LASTEXITCODE -ne 0){throw 'Native development build failed.'}
  if($CheckUi){
    & node (Join-Path $PSScriptRoot 'check-ui.mjs')
    if($LASTEXITCODE -ne 0){throw 'Offscreen UI checks failed.'}
    return
  }
  if(-not $BuildOnly){
    $env:PEKO_ROOT=$root
    $configuration=if($Release){'release'}else{'debug'}
    & (Join-Path $root ('target/'+$configuration+'/pekopet.exe'))
    if($LASTEXITCODE -ne 0){throw "PekoPet exited with code $LASTEXITCODE"}
  }
}finally{Pop-Location}
