# Deploy sync-microsoft-ads Edge Function and set all required secrets.
# Usage:
#   1. Auth (pick one):
#        OR run once: npx supabase login (then do not set SUPABASE_ACCESS_TOKEN to the doc placeholder)
#        OR paste a real token: $env:SUPABASE_ACCESS_TOKEN = "<full sbp_... from dashboard>"  # https://supabase.com/dashboard/account/tokens
#   2. Set Microsoft env vars:
#        $env:MS_ADS_CLIENT_ID      = "your-azure-app-client-id"
#        $env:MS_ADS_CLIENT_SECRET  = "your-azure-app-client-secret"
#        $env:MS_ADS_DEVELOPER_TOKEN = "your-microsoft-ads-developer-token"
#        $env:MS_ADS_REFRESH_TOKEN  = "your-refresh-token"  (from get-ms-ads-token.ps1)
#   3. Run from repo root: .\scripts\deploy-microsoft-ads.ps1
#   Optional: .\scripts\deploy-microsoft-ads.ps1 -SkipSecrets   (deploy only; skip MS Ads secrets step)

param(
    [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
    [switch]$SkipSecrets
)

# Literal "sbp_..." from docs is not a token and overrides `supabase login`, causing "Invalid access token format".
if ($AccessToken -eq 'sbp_...' -or $AccessToken -match '^\s*sbp_\.\.\.\s*$') {
    Write-Host "Ignoring placeholder SUPABASE_ACCESS_TOKEN - use a real dashboard token or rely on npx supabase login." -ForegroundColor Yellow
    Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
    $AccessToken = $null
}

if ($AccessToken) {
    $env:SUPABASE_ACCESS_TOKEN = $AccessToken
} else {
    Write-Host "Note: No SUPABASE_ACCESS_TOKEN - using credentials from npx supabase login (if you ran it)." -ForegroundColor Yellow
}

$projectRef = "icyrctjdskdezbtcoaez"

Write-Host "==> Deploying sync-microsoft-ads Edge Function..." -ForegroundColor Cyan
Write-Host '    (deploy uses no-verify-jwt; gateway JWT off, same as supabase/config.toml)' -ForegroundColor DarkGray
npx supabase functions deploy sync-microsoft-ads --project-ref $projectRef --no-verify-jwt
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Deploy failed (Supabase CLI auth). Do one of:" -ForegroundColor Red
    Write-Host "  npx supabase login" -ForegroundColor Yellow
    Write-Host "  then run this script again (do not set SUPABASE_ACCESS_TOKEN to the literal text sbp_... from docs)" -ForegroundColor Yellow
    Write-Host "  or set a full token: `$env:SUPABASE_ACCESS_TOKEN = '<paste from https://supabase.com/dashboard/account/tokens>'" -ForegroundColor Yellow
    exit $LASTEXITCODE
}

if ($SkipSecrets) {
    Write-Host "`n==> Skipped secrets (-SkipSecrets). Done." -ForegroundColor Green
    exit 0
}

Write-Host "`n==> Setting Microsoft Ads secrets..." -ForegroundColor Cyan

$required = @("MS_ADS_CLIENT_ID","MS_ADS_CLIENT_SECRET","MS_ADS_DEVELOPER_TOKEN","MS_ADS_REFRESH_TOKEN")
foreach ($v in $required) {
    if (-not (Get-Item "env:$v" -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Host "$v is not set. Set env vars (see script header) or deploy only with:" -ForegroundColor Red
        Write-Host "  .\scripts\deploy-microsoft-ads.ps1 -SkipSecrets" -ForegroundColor Yellow
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
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "`n==> Done! For curl examples see: supabase/functions/curl.text" -ForegroundColor Green
