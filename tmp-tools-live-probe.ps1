# CI-P1-03 real-call probe (read-only + refusals; no writes to the real database).
# Usage: powershell -NoProfile -File tmp-tools-live-probe.ps1
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000'
$dir = Join-Path $env:TEMP 'coolpilot-tools-probe'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

function Invoke-ToolCall {
  param([string]$Name, [string]$Label, [AllowNull()][string]$Json)
  $out = Join-Path $dir "$Label.out"
  $url = if ($Name) { "$base/api/tools/$Name" } else { "$base/api/tools" }
  if ([string]::IsNullOrEmpty($Json)) {
    $code = & curl.exe -s -o $out -w '%{http_code}' "$url"
  } else {
    $file = Join-Path $dir "$Label.json"
    Set-Content -Path $file -Value $Json -Encoding utf8 -NoNewline
    $code = & curl.exe -s -o $out -w '%{http_code}' -X POST "$url" `
      -H 'content-type: application/json' --data-binary "@$file"
  }
  $body = Get-Content $out -Raw
  Write-Output ("[{0}] {1} -> {2}" -f $Label, $url, $code)
  if ($body.Length -gt 600) {
    $data = ($body | ConvertFrom-Json).data
    Write-Output ("      body {0} bytes; assets={1} total={2} matched={3} byRoot={4}" -f `
      $body.Length, @($data.assets).Count, $data.total, $data.matched, ($data.byRoot | ConvertTo-Json -Compress))
    Write-Output ("      first asset: " + (($data.assets | Select-Object -First 1) | ConvertTo-Json -Compress))
  } else {
    Write-Output ("      " + $body)
  }
  Write-Output ''
}

Write-Output '=== 1. discovery ==='
Invoke-ToolCall -Name '' -Label 'discovery' -Json $null

Write-Output '=== 2. a read-only tool, whole workspace and filtered ==='
Invoke-ToolCall -Name 'media_list_assets' -Label 'list-all' -Json '{"input":{}}'
Invoke-ToolCall -Name 'media_list_assets' -Label 'list-videos-2' -Json '{"input":{"root":"videos","limit":2}}'

Write-Output '=== 3. refusals ==='
Invoke-ToolCall -Name 'browser_open_page' -Label 'unknown' -Json '{"input":{"url":"https://example.com"}}'
Invoke-ToolCall -Name 'media_list_assets' -Label 'bad-root' -Json '{"input":{"root":"nowhere"}}'
Invoke-ToolCall -Name 'media_list_assets' -Label 'bad-body' -Json 'not json at all'
Invoke-ToolCall -Name 'media_list_assets' -Label 'no-task' -Json '{"input":{},"taskId":"no-such-task"}'

Write-Output '=== 4. the side-effecting tool: gate, then the runtime''s own failure ==='
Invoke-ToolCall -Name 'generate_image_file' -Label 'unapproved' -Json '{"input":{"prompt":"a red fox at dawn"}}'
Invoke-ToolCall -Name 'generate_image_file' -Label 'approved' -Json '{"input":{"prompt":"a red fox at dawn"},"approvals":{"grantedToolCallId":"call_1"}}'

Write-Output '=== 5. host task that really exists (agent run, no log write) ==='
$tasks = & curl.exe -s "$base/api/tasks?kind=agent&limit=1"
Write-Output ("GET /api/tasks?kind=agent&limit=1 -> " + (($tasks | ConvertFrom-Json).data.total) + " agent run(s), first id: " + (($tasks | ConvertFrom-Json).data.tasks[0].id))
$taskId = (($tasks | ConvertFrom-Json).data.tasks | Select-Object -First 1).id
if ($taskId) {
  Invoke-ToolCall -Name 'media_list_assets' -Label 'with-agent-host' -Json ("{`"input`":{},`"taskId`":`"$taskId`"}")
} else {
  Write-Output 'no agent run in this database; skipped'
}
