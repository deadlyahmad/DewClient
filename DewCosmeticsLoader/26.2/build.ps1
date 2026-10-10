param([string[]]$GradleArguments = @('build'))

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$toolsDirectory = Join-Path $env:TEMP 'dewcosmetics-build-tools'
$jdkArchive = Join-Path $toolsDirectory 'temurin-25.zip'
$gradleArchive = Join-Path $toolsDirectory 'gradle-9.8.0-bin.zip'
$jdkDirectory = Join-Path $toolsDirectory 'jdk-25'
$gradleDirectory = Join-Path $toolsDirectory 'gradle-9.8.0'

New-Item -ItemType Directory -Force -Path $toolsDirectory | Out-Null

function Get-Sha256([string]$Path) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return [System.BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

function Ensure-VerifiedArchive([string]$Path, [string]$Uri, [string]$ExpectedHash) {
    if (Test-Path $Path) {
        try {
            $existingHash = Get-Sha256 $Path
        } catch {
            Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
            $existingHash = $null
        }
        if ($existingHash -eq $ExpectedHash) {
            return
        }
        if (Test-Path $Path) {
            Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        }
    }

    try {
        Invoke-WebRequest -Uri $Uri -OutFile $Path
    } catch {
        if (Test-Path $Path) {
            Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        }
        throw
    }

    try {
        $downloadedHash = Get-Sha256 $Path
    } catch {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        throw
    }

    if ($downloadedHash -ne $ExpectedHash) {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        throw "Downloaded archive SHA-256 mismatch: $([System.IO.Path]::GetFileName($Path))"
    }
}

function Reuse-VerifiedCachedArchive([string]$Destination, [string]$Pattern, [string]$ExpectedHash) {
    if (Test-Path $Destination) {
        try {
            $destinationHash = Get-Sha256 $Destination
            if ($destinationHash -eq $ExpectedHash) { return }
        } catch {}
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    }
    # Historical builds kept verified archives directly in this shared folder.
    # Limit lookup to files in that folder so it never crawls the extracted JDK/Gradle trees.
    $candidates = Get-ChildItem -Path $toolsDirectory -File -Filter $Pattern -ErrorAction SilentlyContinue
    foreach ($candidate in $candidates) {
        if ($candidate.FullName -eq $Destination -or $candidate.Length -le 0) { continue }
        try {
            $candidateHash = Get-Sha256 $candidate.FullName
        } catch {
            continue
        }
        if ($candidateHash -eq $ExpectedHash) {
            Copy-Item -LiteralPath $candidate.FullName -Destination $Destination
            return
        }
    }
}

$jdkHome = Get-ChildItem -Path $jdkDirectory -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'bin\javac.exe') } |
    Select-Object -First 1
if (-not $jdkHome) {
    Reuse-VerifiedCachedArchive $jdkArchive 'temurin-25-*.zip' '00c847d804f4a78e9f04f2683faf14fed898535b177b7fc704486cb0284e9283'
    Ensure-VerifiedArchive $jdkArchive 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jdk_x64_windows_hotspot_25.0.4.1_1.zip' '00c847d804f4a78e9f04f2683faf14fed898535b177b7fc704486cb0284e9283'
    Expand-Archive -Path $jdkArchive -DestinationPath $jdkDirectory -Force
    $jdkHome = Get-ChildItem -Path $jdkDirectory -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName 'bin\javac.exe') } |
        Select-Object -First 1
}

$gradleHome = Get-ChildItem -Path $gradleDirectory -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'bin\gradle.bat') } |
    Select-Object -First 1
if (-not $gradleHome) {
    Reuse-VerifiedCachedArchive $gradleArchive 'gradle-9.8.0-bin-*.zip' 'bafd5ce9cfaea0fbccfdc8439a1ac42fbd4cd9c89dc9a988228d8a2639a58e6c'
    Ensure-VerifiedArchive $gradleArchive 'https://services.gradle.org/distributions/gradle-9.8.0-bin.zip' 'bafd5ce9cfaea0fbccfdc8439a1ac42fbd4cd9c89dc9a988228d8a2639a58e6c'
    Expand-Archive -Path $gradleArchive -DestinationPath $gradleDirectory -Force
    $gradleHome = Get-ChildItem -Path $gradleDirectory -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName 'bin\gradle.bat') } |
        Select-Object -First 1
}

if (-not $jdkHome -or -not $gradleHome) {
    throw 'Could not locate the extracted Java 25 or Gradle installation.'
}

$env:JAVA_HOME = $jdkHome.FullName
$env:PATH = "$($jdkHome.FullName)\bin;$env:PATH"
& (Join-Path $gradleHome.FullName 'bin\gradle.bat') -p $PSScriptRoot @GradleArguments
if ($LASTEXITCODE -ne 0) {
    throw "Gradle build failed with exit code $LASTEXITCODE."
}
