param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory([IO.Path]::GetFullPath($Source),[IO.Path]::GetFullPath($Destination),[IO.Compression.CompressionLevel]::Fastest,$true)
