$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../extension')
try {
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Extension dependency installation failed' }
    npm.cmd run package
    if ($LASTEXITCODE -ne 0) { throw 'Extension packaging failed' }
} finally { Pop-Location }
