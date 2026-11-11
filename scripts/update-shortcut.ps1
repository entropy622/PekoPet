param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$IconPath)
$ErrorActionPreference='Stop'
$exe=(Resolve-Path -LiteralPath $Executable).Path
$icon=(Resolve-Path -LiteralPath $IconPath).Path
if([IO.Path]::GetFileName($exe) -ne 'PekoPet.exe'){throw 'Executable must be PekoPet.exe'}
$shell=New-Object -ComObject WScript.Shell
$folders=@([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'),"$env:APPDATA\Microsoft\Windows\Start Menu\Programs","$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar")
foreach($folder in $folders){
  if(-not (Test-Path -LiteralPath $folder)){continue}
  foreach($file in Get-ChildItem -LiteralPath $folder -Filter '*PekoPet*.lnk' -Recurse){
    $link=$shell.CreateShortcut($file.FullName)
    if([IO.Path]::GetFileNameWithoutExtension($link.TargetPath) -ne 'PekoPet'){continue}
    $link.TargetPath=$exe
    $link.WorkingDirectory=Split-Path -LiteralPath $exe
    $link.IconLocation=$icon+',0'
    $link.Save()
    Write-Output ('Updated '+$file.FullName)
  }
}
