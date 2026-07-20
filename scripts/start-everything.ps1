param([switch]$NoDialog)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot "docker-compose.waha.yml"
$environmentFile = Join-Path $projectRoot ".env.local"
$logsDirectory = Join-Path $projectRoot "logs"
$urlFile = Join-Path $projectRoot "NGROK_URL.txt"
$dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"

Add-Type -AssemblyName System.Windows.Forms

function Show-Result([string]$message, [string]$title, [System.Windows.Forms.MessageBoxIcon]$icon) {
    if ($NoDialog) {
        Write-Output "$title`: $message"
        return
    }
    [System.Windows.Forms.MessageBox]::Show(
        $message,
        $title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        $icon
    ) | Out-Null
}

function Wait-For-Docker {
    if (docker info 2>$null) { return }

    if (-not (Test-Path -LiteralPath $dockerDesktop)) {
        throw "Docker Desktop is not installed."
    }

    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        Start-Sleep -Seconds 2
        if (docker info 2>$null) { return }
    }

    throw "Docker Desktop did not become ready within 3 minutes."
}

function Get-NgrokUrl {
    try {
        $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2
        return ($tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -First 1).public_url
    } catch {
        return $null
    }
}

function Get-EnvironmentValue([string]$name) {
    $line = Get-Content -LiteralPath $environmentFile |
        Where-Object { $_ -match "^$([regex]::Escape($name))=" } |
        Select-Object -Last 1
    if (-not $line) { return $null }
    return $line.Substring($line.IndexOf("=") + 1).Trim()
}

try {
    if (-not (Test-Path -LiteralPath $environmentFile)) {
        throw ".env.local was not found in the project directory."
    }

    if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
        throw "ngrok is not installed or is not available in PATH."
    }

    New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null
    Wait-For-Docker

    Push-Location $projectRoot
    try {
        & docker compose --env-file $environmentFile -f $composeFile up -d
        if ($LASTEXITCODE -ne 0) { throw "Docker containers failed to start." }
    } finally {
        Pop-Location
    }

    $backendReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:3101/api/campaign/status" -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                $backendReady = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $backendReady) { throw "The backend container did not become ready." }

    $publicUrl = Get-NgrokUrl
    if (-not $publicUrl) {
        $ngrokLog = Join-Path $logsDirectory "ngrok.log"
        $ngrokErrorLog = Join-Path $logsDirectory "ngrok-error.log"
        Remove-Item -LiteralPath $ngrokLog, $ngrokErrorLog -Force -ErrorAction SilentlyContinue

        $ngrokArguments = @("http", "3101", "--log", "stdout")
        $ngrokDomain = Get-EnvironmentValue "NGROK_DOMAIN"
        if ($ngrokDomain) {
            $ngrokArguments += @("--url", $ngrokDomain)
        }

        Start-Process -FilePath "ngrok" `
            -ArgumentList $ngrokArguments `
            -WindowStyle Hidden `
            -RedirectStandardOutput $ngrokLog `
            -RedirectStandardError $ngrokErrorLog

        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Seconds 1
            $publicUrl = Get-NgrokUrl
            if ($publicUrl) { break }
        }
    }

    if (-not $publicUrl) {
        throw "ngrok did not provide a public URL. Check logs\ngrok-error.log."
    }

    Set-Content -LiteralPath $urlFile -Value $publicUrl -Encoding utf8
    Set-Clipboard -Value $publicUrl

    Show-Result `
        "Docker, WAHA backend, and ngrok are running.`n`nBackend URL:`n$publicUrl`n`nThe URL was copied to the clipboard and saved in NGROK_URL.txt." `
        "WAHA is running" `
        ([System.Windows.Forms.MessageBoxIcon]::Information)
} catch {
    Show-Result `
        "Startup failed:`n`n$($_.Exception.Message)" `
        "WAHA startup error" `
        ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit 1
}
