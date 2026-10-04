param(
    [switch]$ConfigureCodex,
    [switch]$Launch,
    [switch]$ShowWindow
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$blenderRoot = Join-Path $projectRoot '.tools/blender-4.5.14-windows-x64'
$blenderExe = Join-Path $blenderRoot 'blender.exe'
$basePython = Join-Path $blenderRoot '4.5/python/bin/python.exe'
$venvRoot = Join-Path $projectRoot '.tools/blender-mcp-venv'
$venvPython = Join-Path $venvRoot 'Scripts/python.exe'
$mcpExe = Join-Path $venvRoot 'Scripts/mcp-for-blender.exe'
$profile = Join-Path $projectRoot '.tools/blender-profile'
$configDir = Join-Path $profile 'config'
$scriptsDir = Join-Path $profile 'scripts'
$addonsDir = Join-Path $scriptsDir 'addons'
if (-not (Test-Path -LiteralPath $basePython)) {
    $toolsDir = Join-Path $projectRoot '.tools'
    $zipName = 'blender-4.5.14-windows-x64.zip'
    $zipPath = Join-Path $toolsDir $zipName
    $shaPath = Join-Path $toolsDir 'blender-4.5.14.sha256'
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    Invoke-WebRequest -Uri 'https://download.blender.org/release/Blender4.5/blender-4.5.14.sha256' -OutFile $shaPath
    if (-not (Test-Path -LiteralPath $zipPath)) {
        Invoke-WebRequest -Uri ('https://download.blender.org/release/Blender4.5/' + $zipName) -OutFile $zipPath
    }
    $shaLine = Get-Content -LiteralPath $shaPath | Where-Object { $_ -match ('\s' + [regex]::Escape($zipName) + '$') }
    if (-not $shaLine) { throw 'Official Blender checksum entry missing.' }
    $expectedHash = ($shaLine -split '\s+')[0]
    if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Blender ZIP checksum mismatch.' }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $toolsDir -Force
    if (-not (Test-Path -LiteralPath $basePython)) { throw 'Portable Blender extraction failed.' }
}
if (-not (Test-Path -LiteralPath $venvPython)) {
    & $basePython -m venv $venvRoot
    if ($LASTEXITCODE -ne 0) { throw 'Independent Python environment creation failed.' }
}
$installed = & $venvPython -c "import importlib.metadata; print(importlib.metadata.version('mcp-for-blender'))" 2>$null
if ($LASTEXITCODE -ne 0 -or $installed -ne '2.1.3') {
    & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'blender-mcp-requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Pinned MCP package installation failed.' }
}
New-Item -ItemType Directory -Path $configDir,$addonsDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $venvRoot 'Lib/site-packages/blender_mcp/bundled/addon.py') -Destination (Join-Path $addonsDir 'blender_mcp.py') -Force
$variables = @{
    BLENDER_USER_CONFIG = $configDir
    BLENDER_USER_SCRIPTS = $scriptsDir
    BLENDERMCP_ADDONS_DIR = $addonsDir
    BLENDERMCP_NO_UPDATE_CHECK = '1'
    BLENDER_MCP_SAFE_MODE = '1'
    DISABLE_TELEMETRY = 'true'
    BLENDER_HOST = 'localhost'
    BLENDER_PORT = '9876'
    XDG_CONFIG_HOME = (Join-Path $projectRoot '.tools/blender-mcp-profile')
}
$previous = @{}
try {
    foreach ($key in $variables.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $variables[$key], 'Process')
    }
    & $blenderExe --background --python (Join-Path $PSScriptRoot 'enable-blender-mcp.py')
    if ($LASTEXITCODE -ne 0) { throw 'Blender profile setup failed.' }
    if ($ConfigureCodex) {
        $codex = (Get-Command codex -ErrorAction Stop).Source
        $existing = & $codex mcp get blender --json 2>$null
        if ($LASTEXITCODE -eq 0) {
            $entry = $existing | ConvertFrom-Json
            if ($entry.transport.command -ne $mcpExe) { throw 'A different blender MCP entry exists; it has been preserved.' }
            Write-Host 'Project blender MCP is already configured.'
        } else {
            $codexArgs = @('mcp', 'add', 'blender')
            foreach ($key in $variables.Keys) { $codexArgs += @('--env', "$key=$($variables[$key])") }
            $codexArgs += @('--', $mcpExe)
            & $codex @codexArgs
            if ($LASTEXITCODE -ne 0) { throw 'Codex MCP registration failed.' }
        }
    }
    if ($Launch) {
        $pidFile = Join-Path $projectRoot '.tools/blender-mcp.pid'
        $running = $null
        if (Test-Path -LiteralPath $pidFile) {
            $running = Get-Process -Id ([int](Get-Content -LiteralPath $pidFile)) -ErrorAction SilentlyContinue
        }
        if ($running -and $running.Path -eq $blenderExe) {
            Write-Host "Project Blender is already running (PID $($running.Id))."
        } else {
            $window = if ($ShowWindow) { 'Normal' } else { 'Hidden' }
            $blendFile = Join-Path $projectRoot 'assets/right-arm.blend'
            $process = Start-Process -FilePath $blenderExe -ArgumentList ('"' + $blendFile + '"') -WorkingDirectory $projectRoot -WindowStyle $window -PassThru
            Set-Content -LiteralPath $pidFile -Value $process.Id
            Write-Host "Started project Blender (PID $($process.Id)); bridge: localhost:9876."
        }
    }
} finally {
    foreach ($key in $variables.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
}
Write-Host 'MCP for Blender 2.1.3 ready. Restart Codex to load a newly registered server. The web app only needs the exported GLB.'
