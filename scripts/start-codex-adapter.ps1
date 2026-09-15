param(
  [string]$CdpUrl = ''
)

$env:PROMPT_ENHANCE_ENDPOINT = [Environment]::GetEnvironmentVariable('PROMPT_ENHANCE_ENDPOINT', 'User')
$env:PROMPT_ENHANCE_MODEL = [Environment]::GetEnvironmentVariable('PROMPT_ENHANCE_MODEL', 'User')
$env:PROMPT_ENHANCE_API_KEY = [Environment]::GetEnvironmentVariable('PROMPT_ENHANCE_API_KEY', 'User')

if ([string]::IsNullOrWhiteSpace($env:PROMPT_ENHANCE_ENDPOINT) -or
    [string]::IsNullOrWhiteSpace($env:PROMPT_ENHANCE_MODEL) -or
    [string]::IsNullOrWhiteSpace($env:PROMPT_ENHANCE_API_KEY)) {
  throw 'DeepSeek user-environment configuration is incomplete.'
}

if ([string]::IsNullOrWhiteSpace($CdpUrl)) {
  $CdpUrl = [Environment]::GetEnvironmentVariable('PROMPT_ENHANCE_CDP_URL', 'User')
}
if ([string]::IsNullOrWhiteSpace($CdpUrl)) { $CdpUrl = 'http://127.0.0.1:9222' }
$env:PROMPT_ENHANCE_CDP_URL = $CdpUrl

& node (Join-Path $PSScriptRoot 'codex-desktop-adapter.mjs')
exit $LASTEXITCODE
