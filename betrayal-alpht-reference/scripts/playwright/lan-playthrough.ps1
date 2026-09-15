[CmdletBinding()]
param(
  [string]$BaseUrl,
  [string]$Session = 'betrayal-lan-smoke',
  [string]$OutputDir = 'output/playwright',
  [switch]$Headed,
  [switch]$SkipServer
)

$ErrorActionPreference = 'Stop'
$worktree = (Get-Location).Path
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$codePath = Join-Path $scriptDir 'lan-playthrough.js'
$serverProcessPath = Join-Path $scriptDir 'server-process.js'
$outputPath = Join-Path $worktree $OutputDir
$serverProcess = $null

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw 'npx is required. Install Node.js/npm before running the Playwright smoke test.'
}
if (-not (Test-Path $codePath)) {
  throw "Playwright flow file is missing: $codePath"
}
if (-not $SkipServer -and -not (Test-Path $serverProcessPath)) {
  throw "Playwright server process file is missing: $serverProcessPath"
}

New-Item -ItemType Directory -Force $outputPath | Out-Null
if (-not $SkipServer) {
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $serverLogPath = Join-Path $outputPath 'lan-script-server.log'
  $serverErrorPath = Join-Path $outputPath 'lan-script-server.error.log'
  $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @($serverProcessPath) `
    -WorkingDirectory $worktree -RedirectStandardOutput $serverLogPath `
    -RedirectStandardError $serverErrorPath -WindowStyle Hidden -PassThru
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    Start-Sleep -Milliseconds 100
    if (Test-Path $serverLogPath) {
      $portLine = Select-String -Path $serverLogPath -Pattern '^PORT=(\d+)$' | Select-Object -Last 1
      if ($portLine) {
        $BaseUrl = "http://127.0.0.1:$($portLine.Matches[0].Groups[1].Value)"
        break
      }
    }
    if ($serverProcess.HasExited) {
      throw "Dedicated LAN server exited before reporting a port. See $serverErrorPath"
    }
  }
  if (-not $BaseUrl) {
    throw "Timed out waiting for the dedicated LAN server port. See $serverLogPath"
  }
} elseif (-not $BaseUrl) {
  throw '-BaseUrl is required when -SkipServer is used.'
}

try {
  Invoke-WebRequest -Uri "$BaseUrl/host" -Method Head -UseBasicParsing | Out-Null
} catch {
  throw "The LAN server is not reachable at $BaseUrl."
}

function Invoke-PlaywrightCli {
  param([Parameter(Mandatory)][string[]]$Arguments)

  $commandArguments = @('--yes', '--package', '@playwright/cli', 'playwright-cli', "-s=$Session") + $Arguments
  $cliOutput = @(& npx @commandArguments 2>&1)
  $cliOutput
  if ($LASTEXITCODE -ne 0) {
    throw "Playwright CLI failed with exit code $LASTEXITCODE.`n$($cliOutput -join [Environment]::NewLine)"
  }
}

try {
  $openArguments = @('open', "$BaseUrl/host")
  if ($Headed) { $openArguments += '--headed' }
  Invoke-PlaywrightCli -Arguments $openArguments | Out-Null
  Invoke-PlaywrightCli -Arguments @('snapshot') | Out-File (Join-Path $outputPath 'lan-script-initial.snapshot.txt')
  Invoke-PlaywrightCli -Arguments @('screenshot') | Out-File (Join-Path $outputPath 'lan-script-initial.screenshot.txt')

  $rawResult = Invoke-PlaywrightCli -Arguments @('--raw', 'run-code', '--filename', $codePath)
  $result = ($rawResult -join [Environment]::NewLine) | ConvertFrom-Json
  $result | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $outputPath 'lan-playthrough-result.json')

  @"
# Playwright LAN Smoke Test

- Base URL: $BaseUrl
- Session: $Session
- Coverage: $($result.coverage)
- Final revision: $($result.final.revision)
- Final phase: $($result.final.phase)
- Active player: $($result.final.activePlayerNumber)

## UI checks

- Host create-room control: $($result.ui.hostCreateControl)
- Player join control: $($result.ui.playerJoinControl)
- Player reconnect control: $($result.ui.playerReconnectControl)

## Steps

$(($result.steps | ForEach-Object { "- $($_.name): " + ($_ | ConvertTo-Json -Compress) }) -join [Environment]::NewLine)

## Rejected commands

$(if ($result.rejected.Count -eq 0) { '- None' } else { ($result.rejected | ForEach-Object { "- $($_.requestId): $($_.code) — $($_.message)" }) -join [Environment]::NewLine })

## Known issues recorded by this run

- The flow reports protocol-only coverage only when visible room creation or player join controls are missing.
- The reconnect-token input is visible and checked for each Player; physical two-device reconnect acceptance remains deferred.
- Console output is preserved in `lan-script-console-errors.txt`; classify missing static assets separately from gameplay failures.
"@ | Set-Content (Join-Path $outputPath 'lan-playthrough-report.md')

  $console = Invoke-PlaywrightCli -Arguments @('console', 'error')
  $console | Set-Content (Join-Path $outputPath 'lan-script-console-errors.txt')
  Write-Output ($result | ConvertTo-Json -Depth 20)
} finally {
  try { Invoke-PlaywrightCli -Arguments @('close') | Out-Null } catch { }
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
  }
}
