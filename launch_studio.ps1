param([switch]$NoBrowser, [switch]$PairOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$localPackages = Join-Path $PSScriptRoot '.runtime-packages'
if (Test-Path -LiteralPath $localPackages) { $env:PYTHONPATH = $localPackages }
$candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'),
    'D:\Python314\python.exe'
)
# Portable fallbacks for a fresh machine: any Python on PATH or via the py launcher.
foreach ($name in 'python', 'python3') {
    $found = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found -and $found.Source -notlike '*WindowsApps*') { $candidates += $found.Source }
}
if (Get-Command py -ErrorAction SilentlyContinue) {
    $pyPath = & py -3 -c 'import sys; print(sys.executable)' 2>$null
    if ($LASTEXITCODE -eq 0 -and $pyPath) { $candidates += $pyPath.Trim() }
}
$studioPython = $null
foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
        & $candidate -c 'import tkinter, serial' 2>$null
        if ($LASTEXITCODE -eq 0) { $studioPython = $candidate; break }
    }
}
if (-not $studioPython) { throw 'Python 3.12+ with Tkinter and pyserial is required to launch Studio. See SETUP.md.' }

function Get-ReadyStudio {
    try {
        $studioRuntime = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'studio_runtime.json') -Raw | ConvertFrom-Json
        $studioState = Invoke-RestMethod -Uri ($studioRuntime.url.Split('#')[0] + 'api/state') -Headers @{'X-Studio-Token'=$studioRuntime.token} -TimeoutSec 2
        if ($studioState.profiles.Count -eq 8) { return $studioRuntime }
    } catch { return $null }
    return $null
}

$readyStudio = Get-ReadyStudio
if (-not $readyStudio) {
    $studioProcess = Start-Process -FilePath $studioPython -ArgumentList '-u', 'twin_server.py', '--no-browser' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'studio-output.log') -RedirectStandardError (Join-Path $PSScriptRoot 'studio-error.log')
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(25)
    while (-not $readyStudio -and [DateTime]::UtcNow -lt $readyDeadline) {
        $studioProcess.Refresh()
        if ($studioProcess.HasExited) { throw 'Studio could not start. See studio-error.log.' }
        Start-Sleep -Milliseconds 200
        $readyStudio = Get-ReadyStudio
    }
    if (-not $readyStudio) { throw 'Studio did not become ready. See studio-error.log.' }
}
if ($PairOnly) {
    & $studioPython (Join-Path $PSScriptRoot 'pair_studio.py')
    if ($LASTEXITCODE -ne 0) { throw 'Could not create a Studio pairing code.' }
    return
}
if (-not $NoBrowser) {
    & $studioPython (Join-Path $PSScriptRoot 'open_studio.py')
    if ($LASTEXITCODE -ne 0) { throw 'Studio is ready, but its browser window could not open.' }
}
Write-Output 'Studio ready. Display modules can now load.'
