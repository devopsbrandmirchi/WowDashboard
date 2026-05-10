# Deploy all Settings "Sync" Edge Functions with JWT verification disabled at the gateway.
# Run from repo root: .\scripts\deploy-sync-edge-functions.ps1
# Requires: npx supabase, and $env:SUPABASE_ACCESS_TOKEN or login via supabase login

param(
    [string]$ProjectRef = "icyrctjdskdezbtcoaez"
)

$t = $env:SUPABASE_ACCESS_TOKEN
if ($t -eq 'sbp_...' -or $t -match '^\s*sbp_\.\.\.\s*$') {
    Write-Host "Ignoring placeholder SUPABASE_ACCESS_TOKEN - use npx supabase login or a real dashboard token." -ForegroundColor Yellow
    Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
}

$functions = @(
    "sync-google-ads-upsert",
    "fetch-reddit-campaigns-upsert",
    "fetch-facebook-campaigns-upsert",
    "fetch-tiktok-campaigns-upsert",
    "sync-microsoft-ads",
    "send-daily-ad-spend-email"
)

foreach ($name in $functions) {
    Write-Host "==> Deploying $name ..." -ForegroundColor Cyan
    npx supabase functions deploy $name --project-ref $ProjectRef --no-verify-jwt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`nDeploy failed. Run: npx supabase login" -ForegroundColor Red
        Write-Host "or set `$env:SUPABASE_ACCESS_TOKEN from https://supabase.com/dashboard/account/tokens" -ForegroundColor Yellow
        exit $LASTEXITCODE
    }
}

Write-Host "`n==> All sync functions deployed with --no-verify-jwt" -ForegroundColor Green
