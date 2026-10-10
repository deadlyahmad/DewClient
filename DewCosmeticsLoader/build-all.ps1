param([string[]]$GradleArguments = @('build'))

$ErrorActionPreference = 'Stop'
$targets = @('1.21.4', '1.21.8', '1.21.11', '26.2', '26.3')

foreach ($target in $targets) {
    Write-Host "Building DewCosmetics for Minecraft $target..." -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot "$target\build.ps1") @GradleArguments
    if ($LASTEXITCODE -ne 0) {
        throw "DewCosmetics build failed for Minecraft $target."
    }
}

$manifest = Get-Content (Join-Path $PSScriptRoot 'versions.json') -Raw | ConvertFrom-Json
$referencedArtifacts = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($version in $manifest.versions.PSObject.Properties) {
    [void]$referencedArtifacts.Add([string]$version.Value.artifact)
    foreach ($dependency in $version.Value.dependencies) {
        [void]$referencedArtifacts.Add([string]$dependency.artifact)
    }
}

$outputDirectory = Join-Path $PSScriptRoot 'output-jars'
Get-ChildItem -LiteralPath $outputDirectory -File -Filter '*.jar' | ForEach-Object {
    $relativeArtifact = "output-jars/$($_.Name)"
    if (-not $referencedArtifacts.Contains($relativeArtifact)) {
        Remove-Item -LiteralPath $_.FullName -Force
    }
}

Write-Host 'All supported DewCosmetics targets built and recorded in versions.json.' -ForegroundColor Green
