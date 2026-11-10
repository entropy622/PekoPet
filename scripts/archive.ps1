param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourcePath=[IO.Path]::GetFullPath($Source).TrimEnd([IO.Path]::DirectorySeparatorChar)
$destinationPath=[IO.Path]::GetFullPath($Destination)
$prefix=(Split-Path $sourcePath -Leaf)+'/'
$archive=[IO.Compression.ZipFile]::Open($destinationPath,[IO.Compression.ZipArchiveMode]::Create)
try{
  foreach($item in Get-ChildItem -LiteralPath $sourcePath -Force){
    if($item.Name -in @('work','runtime','local','peko-pet','.env','.credentials.yaml')){continue}
    $files=if($item.PSIsContainer){[IO.Directory]::EnumerateFiles($item.FullName,'*',[IO.SearchOption]::AllDirectories)}else{@($item.FullName)}
    foreach($file in $files){
      $relative=$file.Substring($sourcePath.Length+1).Replace('\','/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file,$prefix+$relative,[IO.Compression.CompressionLevel]::Fastest)|Out-Null
    }
  }
}finally{$archive.Dispose()}
