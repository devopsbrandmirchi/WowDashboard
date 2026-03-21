# Deploy sync-microsoft-ads Edge Function and set all required secrets.
# Usage:
#   1. Get your Supabase Access Token from: https://app.supabase.com/account/tokens
#   2. Set all required env vars:
#        $env:SUPABASE_ACCESS_TOKEN = "sbp_xxxx..."
#        $env:MS_ADS_CLIENT_ID      = "your-azure-app-client-id"
#        $env:MS_ADS_CLIENT_SECRET  = "your-azure-app-client-secret"
#        $env:MS_ADS_DEVELOPER_TOKEN = "your-microsoft-ads-developer-token"
#        $env:MS_ADS_REFRESH_TOKEN  = "your-refresh-token"  (from get-ms-ads-token.ps1)
#   3. Run this script: .\scripts\deploy-microsoft-ads.ps1

param(
    [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN
)

if (-not $AccessToken) {
    Write-Error "Set SUPABASE_ACCESS_TOKEN first. Get it from: https://app.supabase.com/account/tokens"
    exit 1
}

$env:SUPABASE_ACCESS_TOKEN = $AccessToken
$projectRef = "icyrctjdskdezbtcoaez"

Write-Host "==> Deploying sync-microsoft-ads Edge Function..." -ForegroundColor Cyan
npx supabase functions deploy sync-microsoft-ads --project-ref $projectRef

Write-Host "`n==> Setting Microsoft Ads secrets..." -ForegroundColor Cyan

$required = @("MS_ADS_CLIENT_ID","MS_ADS_CLIENT_SECRET","MS_ADS_DEVELOPER_TOKEN","MS_ADS_REFRESH_TOKEN")
foreach ($v in $required) {
    if (-not (Get-Item "env:$v" -ErrorAction SilentlyContinue)) {
        Write-Error "$v is not set. See usage comments at the top of this script."
        exit 1
    }
}

npx supabase secrets set `
    MS_ADS_CLIENT_ID="$env:MS_ADS_CLIENT_ID" `
    MS_ADS_CLIENT_SECRET="$env:MS_ADS_CLIENT_SECRET" `
    MS_ADS_REFRESH_TOKEN="$env:MS_ADS_REFRESH_TOKEN" `
    MS_ADS_DEVELOPER_TOKEN="$env:MS_ADS_DEVELOPER_TOKEN" `
    MS_ADS_CUSTOMER_ID="254732580" `
    MS_ADS_ACCOUNT_ID="188313417" `
    --project-ref $projectRef

Write-Host "`n==> Done! Test the function with:" -ForegroundColor Green
Write-Host 'curl.exe -L -X POST "https://icyrctjdskdezbtcoaez.supabase.co/functions/v1/sync-microsoft-ads" -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljeXJjdGpkc2tkZXpidGNvYWV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MjIyOTcsImV4cCI6MjA4NzM5ODI5N30.TZ529SpcDhQyCFTl-atee1LQGwLEkGbgUbo31ouxPkI" -H "Content-Type: application/json" --data "{}"'
