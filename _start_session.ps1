$headers = @{
    'X-Api-Key' = 'mywahakey'
}
$body = @{
    name = 'test_session'
} | ConvertTo-Json

$result = Invoke-RestMethod -Uri 'http://localhost:3000/api/sessions/start' -Method Post -ContentType 'application/json' -Headers $headers -Body $body
$result | ConvertTo-Json -Depth 5
