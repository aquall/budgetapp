$ErrorActionPreference = "Stop"
$appRoot = $PSScriptRoot
$appUrl = "http://localhost:3000/"
$healthUrl = "http://127.0.0.1:3000/api/health"

function Get-BudgetAppServerState {
  try {
    $request = [System.Net.HttpWebRequest]::Create($healthUrl)
    $request.Method = "GET"
    $request.Timeout = 1000
    $request.Proxy = $null
    $response = $request.GetResponse()
    $statusCode = [int]$response.StatusCode
    $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
    $health = $reader.ReadToEnd() | ConvertFrom-Json
    $reader.Close()
    $response.Close()
    if ($statusCode -eq 200 -and $health.persistentPlaidStorage) { return "ready" }
    return "legacy"
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      $_.Exception.Response.Close()
      if ($statusCode -eq 405) { return "legacy" }
    }
    return "stopped"
  }
}

function Show-LaunchError([string]$message) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($message, "Budget App", "OK", "Error") | Out-Null
}

$serverState = Get-BudgetAppServerState
if ($serverState -eq "legacy") {
  Show-LaunchError "An older Budget App server is already running on port 3000. Stop that Node.js server once, then double-click Start Budget App.vbs again to enable saved Plaid connections."
  exit 1
}

if ($serverState -ne "ready") {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
  if (-not $node) {
    Show-LaunchError "Node.js was not found. Install Node.js, then double-click Start Budget App.vbs again."
    exit 1
  }

  $logDirectory = Join-Path $env:LOCALAPPDATA "BudgetApp"
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $stdoutLog = Join-Path $logDirectory "server.out.log"
  $stderrLog = Join-Path $logDirectory "server.err.log"
  $previousPort = $env:PORT
  try {
    $env:PORT = "3000"
    Start-Process -FilePath $node.Source `
      -ArgumentList @("server.js") `
      -WorkingDirectory $appRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog | Out-Null
  } catch {
    Show-LaunchError "The Budget App server could not start. Check the logs in $logDirectory."
    exit 1
  } finally {
    if ($null -eq $previousPort) { Remove-Item Env:PORT -ErrorAction SilentlyContinue }
    else { $env:PORT = $previousPort }
  }

  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $deadline -and (Get-BudgetAppServerState) -ne "ready") {
    Start-Sleep -Milliseconds 500
  }
  if ((Get-BudgetAppServerState) -ne "ready") {
    Show-LaunchError "The Budget App server did not become ready. Check the logs in $logDirectory."
    exit 1
  }
}

Start-Process $appUrl
