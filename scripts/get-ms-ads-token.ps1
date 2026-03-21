# One-time Microsoft Advertising OAuth2 authorization.
# Generates the MS_ADS_REFRESH_TOKEN you need to store as a Supabase secret.
#
# Usage:
#   $env:MS_ADS_CLIENT_ID     = "your-azure-app-client-id"
#   $env:MS_ADS_CLIENT_SECRET = "your-azure-app-client-secret"
#   .\scripts\get-ms-ads-token.ps1

$clientId     = if ($env:MS_ADS_CLIENT_ID)     { $env:MS_ADS_CLIENT_ID }     else { Read-Host "Enter MS_ADS_CLIENT_ID" }
$clientSecret = if ($env:MS_ADS_CLIENT_SECRET) { $env:MS_ADS_CLIENT_SECRET } else { Read-Host "Enter MS_ADS_CLIENT_SECRET" }
$redirectUri  = "http://localhost:5173/"
$scope        = "https://ads.microsoft.com/msads.manage offline_access"

# Step 1: Open the auth URL in the browser
$encodedRedirect = [uri]::EscapeDataString($redirectUri)
$encodedScope    = [uri]::EscapeDataString($scope)
$authUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=$clientId&response_type=code&redirect_uri=$encodedRedirect&scope=$encodedScope&prompt=consent"

Write-Host ""
Write-Host "==> Opening browser for Microsoft Advertising authorization..." -ForegroundColor Cyan
Write-Host "    Sign in with: adops@chipperdigital.io"
Write-Host ""
Start-Process $authUrl

# Step 2: Paste the redirect URL
Write-Host "After authorizing, the browser will redirect to http://localhost:5173/?code=..."
Write-Host "(It will show a 'This site can't be reached' error - that is expected!)"
Write-Host "Copy the FULL URL from the browser address bar and paste it here."
Write-Host ""
$redirectResponse = Read-Host "Paste redirect URL"

# Extract the 'code' parameter
$code = $null
if ($redirectResponse -match "[?&]code=([^&]+)") {
    $code = $matches[1]
}

if (-not $code) {
    Write-Error "Could not extract authorization code from URL. Make sure you pasted the full redirect URL."
    exit 1
}

Write-Host ""
Write-Host "==> Exchanging code for tokens..." -ForegroundColor Cyan

# Step 3: Exchange code for tokens
$bodyParams = "grant_type=authorization_code" +
              "&client_id=$clientId" +
              "&client_secret=$([uri]::EscapeDataString($clientSecret))" +
              "&code=$code" +
              "&redirect_uri=$encodedRedirect" +
              "&scope=$encodedScope"

$response = Invoke-RestMethod `
    -Uri "https://login.microsoftonline.com/common/oauth2/v2.0/token" `
    -Method POST `
    -ContentType "application/x-www-form-urlencoded" `
    -Body $bodyParams

$rt = $response.refresh_token
$at = $response.access_token

Write-Host ""
Write-Host "==> SUCCESS!" -ForegroundColor Green
Write-Host ""
Write-Host "access_token (expires in $($response.expires_in)s):" -ForegroundColor Yellow
Write-Host "  $at"
Write-Host ""
Write-Host "refresh_token (long-lived - save this as your Supabase secret):" -ForegroundColor Green
Write-Host "  $rt"
Write-Host ""
Write-Host "==> Set it as a Supabase secret (after setting SUPABASE_ACCESS_TOKEN):" -ForegroundColor Cyan
Write-Host "  npx supabase secrets set MS_ADS_REFRESH_TOKEN=`"$rt`" --project-ref icyrctjdskdezbtcoaez"
Write-Host ""

# Copy refresh token to clipboard automatically
$rt | Set-Clipboard
Write-Host "Refresh token copied to clipboard!" -ForegroundColor Green
