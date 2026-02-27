# PowerShell bootstrap script for Windows users.
# Run from repository root:  .\install.ps1

param()

Push-Location $PSScriptRoot

function Ensure-PackageManager {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) { return 'pnpm' }
    if (Get-Command npm -ErrorAction SilentlyContinue) { return 'npm' }
    Write-Error 'Neither pnpm nor npm is installed. Install Node.js (which includes npm).' -ErrorAction Stop
}

$PM = Ensure-PackageManager

if ($PM -eq 'pnpm') {
    # try reading configured bin dir
    $bin = pnpm config get global-bin-dir 2>$null
    if ([string]::IsNullOrWhiteSpace($bin) -or $bin -eq "undefined") {
        $default = Join-Path $env:USERPROFILE "AppData\Roaming\npm"
        Write-Host "PNPM global bin directory is not set; defaulting PNPM_HOME to $default"
        $env:PNPM_HOME = $default
        [Environment]::SetEnvironmentVariable('PNPM_HOME',$default,'User')
        # ensure PATH includes it
        if (-not ($env:PATH -split ';' | Where-Object { $_ -eq $default })) {
            Write-Host "You may need to add $default to your PATH or restart your shell."
        }
    }
    try {
        pnpm setup | Out-Null
    } catch {
        Write-Warning "pnpm global bin directory is still not configured."
        Write-Warning "Set the PNPM_HOME environment variable and ensure it's on your PATH, e.g.:"
        Write-Warning "  `$env:PNPM_HOME = \"$env:USERPROFILE\AppData\Roaming\npm\""
        Write-Warning "Then re-run this script."
    }
}

& $PM install
& $PM run build

if ($PM -eq 'pnpm') {
    Push-Location packages\cli
    pnpm link -g
    Pop-Location
    Write-Host "`nThe 'solix' command is now available globally."
} else {
    Write-Host "`nTo link the CLI globally run:`n  cd packages\cli; npm install -g ."
}

Write-Host "Bootstrap complete. You can run 'solix agent list' or start the UI with 'pnpm --filter @solix/ui dev'."

Pop-Location
