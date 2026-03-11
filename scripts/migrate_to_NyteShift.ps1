Param([switch]$Run)

Write-Host "Current remotes:"
git remote -v

if (-not $Run) {
    Write-Host "\nThis script only shows recommended commands by default. Re-run with -Run to execute them.\n"

    Write-Host "Recommended (GitHub CLI - creates repo and pushes):"
    Write-Host "gh repo create jonjonbinx1/NyteShift --public --source=. --remote=nyteshift --push --confirm\n"

    Write-Host "Recommended (manual git):"
    Write-Host "git remote add nyteshift https://github.com/jonjonbinx1/NyteShift.git"
    Write-Host "git push nyteshift --all"
    Write-Host "git push nyteshift --tags"
    Write-Host "# Optionally make this the new origin:"
    Write-Host "git remote remove origin"
    Write-Host "git remote rename nyteshift origin"
    Write-Host "git push -u origin --all"
    Write-Host "git push -u origin --tags"
    exit 0
}

# Execution path
if (Get-Command gh -ErrorAction SilentlyContinue) {
    Write-Host "Found gh — creating repo and pushing..."
    gh repo create jonjonbinx1/NyteShift --public --source=. --remote=nyteshift --push --confirm
} else {
    Write-Host "gh not found — adding remote and pushing with git..."
    git remote add nyteshift https://github.com/jonjonbinx1/NyteShift.git
    git push nyteshift --all
    git push nyteshift --tags
    Write-Host "To make nyteshift the new origin, run:" 
    Write-Host "  git remote remove origin"
    Write-Host "  git remote rename nyteshift origin"
    Write-Host "  git push -u origin --all"
    Write-Host "  git push -u origin --tags"
}

Write-Host "Done. Verify the new remote with 'git remote -v' and check GitHub."