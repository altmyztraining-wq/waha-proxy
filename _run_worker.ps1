# _run_worker.ps1 - PowerShell script to run the campaign worker in the background
$minDelay = 3
$maxDelay = 8

Write-Host "Starting WAHA Campaign Background Worker Loop..." -ForegroundColor Green
Write-Host "This script will continuously poll the local Next.js API queue and process messages." -ForegroundColor Gray
Write-Host "Press Ctrl+C to stop the worker at any time.`n" -ForegroundColor DarkYellow

while ($true) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3001/api/campaign/worker" -Method Post
        if ($null -ne $response.error) {
            Write-Warning "Worker Error: $($response.error)"
        } elseif ($response.message -eq "Queue is empty.") {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Queue is empty. Waiting 10 seconds..." -ForegroundColor Gray
            Start-Sleep -Seconds 10
            continue
        } else {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Successfully processed job ID: $($response.processedJobId) | Status: $($response.status)" -ForegroundColor Cyan
        }
    } catch {
        $errorMessage = $_.Exception.Message
        if ($_.Exception.InnerException) {
            $errorMessage += " -> " + $_.Exception.InnerException.Message
        }
        Write-Warning "[$(Get-Date -Format 'HH:mm:ss')] Connection to Next.js server failed or returned error: $errorMessage"
        Write-Host "Make sure Next.js is running (npm run dev) on port 3001." -ForegroundColor Gray
        Start-Sleep -Seconds 15
        continue
    }

    # Random sleep to simulate human interval between tasks
    $delay = Get-Random -Minimum $minDelay -Maximum ($maxDelay + 1)
    Write-Host "Sleeping for $delay seconds before next check..." -ForegroundColor DarkGray
    Start-Sleep -Seconds $delay
}
