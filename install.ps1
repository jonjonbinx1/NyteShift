# PowerShell bootstrap script for Windows users.
# Run from repository root:  .\install.ps1

param()

Push-Location $PSScriptRoot

# Ensure npm is available (ships with Node.js)
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error 'npm is not installed. Please install Node.js from https://nodejs.org' -ErrorAction Stop
}

Write-Host 'Installing dependencies...'
npm install

Write-Host 'Building all packages...'
npm run build

# Install the CLI globally for the current user (no admin needed)
$userNpm = "$env:USERPROFILE\npm"
if (-not (Test-Path $userNpm)) { New-Item -ItemType Directory -Path $userNpm | Out-Null }

# Repair user npm prefix if it looks wrong (common issue on Windows)
$currentPrefix = npm config get prefix --location=user 2>$null
if ([string]::IsNullOrWhiteSpace($currentPrefix) -or
    -not ($currentPrefix -match [regex]::Escape($env:USERPROFILE)) -or
    $currentPrefix -match '%USERPROFILE%') {
    npm config set prefix $userNpm --location=user
    Write-Host "Fixed npm user prefix -> $userNpm"
}

# Add user npm bin to current session PATH
if (-not ($env:PATH -split ';' | Where-Object { $_.TrimEnd('\') -eq $userNpm.TrimEnd('\') })) {
    $env:PATH = "$userNpm;$env:PATH"
}

# Persist to user PATH so new shells find it
$persistedPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (-not ($persistedPath -split ';' | Where-Object { $_.TrimEnd('\') -eq $userNpm.TrimEnd('\') })) {
    [Environment]::SetEnvironmentVariable('PATH', "$userNpm;$persistedPath", 'User')
    Write-Host "Added $userNpm to your user PATH (restart shell to pick it up in new windows)."
}

Push-Location packages\cli
npm install -g . --prefix $userNpm
Pop-Location

Write-Host "`nThe 'nyteshift' command is now available globally."
Write-Host "Bootstrap complete. You can run 'nyteshift agent list' or start the UI with 'npm run dev:ui'."

Pop-Location
