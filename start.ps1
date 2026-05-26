$ErrorActionPreference = "Stop"

$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (Test-Path $bundledNode) {
  $node = $bundledNode
} else {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js was not found. Install Node.js or run this inside Codex with workspace dependencies available."
  }
  $node = $nodeCommand.Source
}

Set-Location $PSScriptRoot
& $node server.js
