$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
node .\node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173 *> .\vite-dev.log
