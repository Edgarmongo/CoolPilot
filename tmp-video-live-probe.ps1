# CI-P1-04 real-call probe: video templates + a real render task on the running dev server.
#
# Unlike the CI-P1-03 probe this one deliberately WRITES, because that is the card's claim: a render task
# has to be a real task row with a real deliverable. Every row and file it creates is printed, and the
# before/after state of the workspace and the database are printed next to each other.
#
# The 2-second test clip is produced with the ffmpeg that happens to be installed on this machine, purely
# as *probe fixture*: the app never invokes ffmpeg (see the card's delivery record on the P1-04-06
# decision). Usage: powershell -NoProfile -File tmp-video-live-probe.ps1
#
# Every response is written to a file and read back as UTF-8: PowerShell 5.1 reads a UTF-8 file as ANSI
# unless told otherwise, which turns task text into mojibake and can break `ConvertFrom-Json` outright.
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3000'
$dir = Join-Path $env:TEMP 'coolpilot-video-probe'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$repo = 'd:\devworkspace\software\workspace\myproject\CoolPilot'
$videosDir = Join-Path $repo 'web-data\videos'
$dbFile = Join-Path $repo 'web-data\social-auto-post.db'
$ffmpeg = 'D:\workspace\software\videotools\ffmpeg-8.1.2-essentials_build\bin\ffmpeg.exe'

function Read-Body {
  param([string]$Path)
  return (Get-Content -Path $Path -Raw -Encoding UTF8)
}

function Shorten {
  param([string]$Text, [int]$Max = 900)
  if ($Text.Length -le $Max) { return $Text }
  return $Text.Substring(0, $Max) + ' ...(truncated)'
}

function Post-Json {
  param([string]$Url, [string]$Label, [string]$Json)
  $in = Join-Path $dir "$Label.in.json"
  $out = Join-Path $dir "$Label.out.json"
  Set-Content -Path $in -Value $Json -NoNewline
  $code = & curl.exe -s -o $out -w '%{http_code}' -X POST $Url -H 'content-type: application/json' --data-binary "@$in"
  $body = Read-Body $out
  # Write-Host, not Write-Output: this progress text must not join the value the caller parses.
  Write-Host ("[{0}] POST {1} -> HTTP {2}" -f $Label, $Url, $code)
  Write-Host ("      " + (Shorten $body))
  Write-Host ''
  return $body
}

function Get-Json {
  param([string]$Url, [string]$Label)
  $out = Join-Path $dir "$Label.out.json"
  $code = & curl.exe -s -o $out -w '%{http_code}' $Url
  $body = Read-Body $out
  Write-Host ("[{0}] GET {1} -> HTTP {2}" -f $Label, $Url, $code)
  Write-Host ("      " + (Shorten $body))
  Write-Host ''
  return $body
}

function Get-State {
  param([string]$When)
  $tasksOut = Join-Path $dir "state-$When-tasks.json"
  $videosOut = Join-Path $dir "state-$When-videos.json"
  & curl.exe -s -o $tasksOut "$base/api/tasks?limit=200" | Out-Null
  & curl.exe -s -o $videosOut "$base/api/videos" | Out-Null
  $tasks = (Read-Body $tasksOut | ConvertFrom-Json).data
  $videos = (Read-Body $videosOut | ConvertFrom-Json).data.videos
  $files = @(Get-ChildItem $videosDir -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer })
  Write-Host ("=== state {0}: tasks={1} videos-in-library={2} files-in-web-data/videos={3} db-mtime={4}" -f `
    $When, $tasks.total, @($videos).Count, $files.Count, (Get-Item $dbFile).LastWriteTime)
  foreach ($file in $files) { Write-Host ("      {0} ({1} bytes)" -f $file.Name, $file.Length) }
  Write-Host ''
  return @{ tasks = $tasks.total; files = $files }
}

Get-State -When 'before' | Out-Null


Write-Output '=== 1. discovery: the render tool is published with its contract ==='
$discovery = Get-Json -Url "$base/api/tools" -Label 'discovery'
foreach ($tool in ($discovery | ConvertFrom-Json).data) {
  $schema = ($tool.inputSchema | ConvertTo-Json -Compress -Depth 20)
  Write-Output ("      {0}: schema {1} chars, mentions existing_video_package={2}" -f `
    $tool.name, $schema.Length, $schema.Contains('existing_video_package'))
}
Write-Output ''

Write-Output '=== 2. a real video material: a 2s test clip uploaded through the real endpoint ==='
$fixture = Join-Path $dir 'probe-clip.mp4'
if (-not (Test-Path $fixture)) {
  & $ffmpeg -v error -y -f lavfi -i "testsrc=size=320x240:rate=15:duration=2" -f lavfi -i "sine=frequency=440:duration=2" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest $fixture
}
Write-Output ("      fixture: {0} bytes, produced only as fixture by {1}" -f (Get-Item $fixture).Length, $ffmpeg)
$uploadOut = Join-Path $dir 'upload.out.json'
$uploadCode = & curl.exe -s -o $uploadOut -w '%{http_code}' -X POST "$base/api/videos/upload" -F "file=@$fixture"
$upload = Read-Body $uploadOut
Write-Output ("[upload] POST $base/api/videos/upload -> HTTP " + $uploadCode)
Write-Output ("      " + $upload)
Write-Output ''
$material = ($upload | ConvertFrom-Json).data.fileName
$materialSize = ($upload | ConvertFrom-Json).data.size
Write-Output ("      material fileName={0} size={1}" -f $material, $materialSize)
Write-Output ''

$renderInput = @{
  template = @{ id = 'existing_video_package' }
  materials = @{ video = $material }
  params = @{
    title = 'CI-P1-04 probe'
    captions = @(
      @{ startMs = 0; endMs = 1200; text = 'first cue' }
      @{ startMs = 1200; endMs = 2400; text = 'second cue' }
    )
  }
}

Write-Output '=== 3. the approval gate: nothing is created without it ==='
$beforeGate = (Get-State -When 'before-gate').tasks
Post-Json -Url "$base/api/tools/video_render" -Label 'unapproved' -Json ((@{ input = $renderInput } | ConvertTo-Json -Depth 12 -Compress)) | Out-Null
$afterGate = (Get-State -When 'after-gate').tasks
Write-Output ("      tasks before={0} after={1} (an unapproved call creates no task)" -f $beforeGate, $afterGate)
Write-Output ''

Write-Output '=== 4. approved: the task is created and really runs ==='
$approved = Post-Json -Url "$base/api/tools/video_render" -Label 'approved' `
  -Json ((@{ input = $renderInput; approvals = @{ grantedToolCallId = 'probe_call_1' } } | ConvertTo-Json -Depth 12 -Compress))
$renderData = ($approved | ConvertFrom-Json).data
$taskId = $renderData.taskId
$videoUrl = $renderData.artifacts.video.url
Write-Output ("      taskId={0} taskStatus={1} taskRawStatus={2} lookup={3}" -f `
  $taskId, $renderData.taskStatus, $renderData.taskRawStatus, $renderData.lookup)
Write-Output ("      renderer={0} encoded={1} videoBytes={2}" -f `
  $renderData.renderer.name, $renderData.renderer.encoded, $renderData.videoBytes)
Write-Output ("      video url={0}" -f $renderData.artifacts.video.url)
Write-Output ("      subtitles={0} (url='{1}')" -f $renderData.artifacts.subtitles.fileName, $renderData.artifacts.subtitles.url)
Write-Output ("      metadata={0} (url='{1}')" -f $renderData.artifacts.metadata.fileName, $renderData.artifacts.metadata.url)
Write-Output ("      notes={0}" -f ($renderData.notes -join ' | '))
Write-Output ''

Write-Output '=== 5. the returned task id is queryable through the unified task entry ==='
$taskBody = Get-Json -Url "$base/api/tasks/$taskId" -Label 'tasks-by-id'
$taskView = ($taskBody | ConvertFrom-Json).data
Write-Output ("      kind={0} type={1} status={2} rawStatus={3} progress={4}" -f `
  $taskView.task.kind, $taskView.task.type, $taskView.task.status, $taskView.task.rawStatus, $taskView.task.progress)
Write-Output ("      resultUrl={0}" -f $taskView.task.resultUrl)
Write-Output ("      log stages={0}" -f (($taskView.logs | ForEach-Object { $_.stage }) -join ' > '))
Write-Output ''

Write-Output '=== 6. the deliverable is readable over HTTP, including a range request ==='
$deliverable = Join-Path $dir 'deliverable.mp4'
$download = & curl.exe -s -o $deliverable -w '%{http_code} %{size_download} %{content_type}' "$base$videoUrl"
Write-Output ("[deliverable] GET {0} -> {1}" -f $videoUrl, $download)
Write-Output ("      material size={0} downloaded size={1} identical={2}" -f `
  $materialSize, (Get-Item $deliverable).Length, ((Get-Item $deliverable).Length -eq $materialSize))
$rangeOut = Join-Path $dir 'range.bin'
$rangeHeaders = Join-Path $dir 'range.headers'
$range = & curl.exe -s -o $rangeOut -D $rangeHeaders -w '%{http_code}' -H 'range: bytes=0-99' "$base$videoUrl"
Write-Output ("[range] GET {0} (range: bytes=0-99) -> HTTP {1}, {2} bytes" -f $videoUrl, $range, (Get-Item $rangeOut).Length)
$rangeText = ((Read-Body $rangeHeaders) -split "`n" | Select-String -Pattern 'content-range|content-length') -join ' ; '
Write-Output ("      " + $rangeText.Trim())
Write-Output ''

Write-Output '=== 7. a refused render: no success is reported, the task keeps the diagnosis ==='
$failed = Post-Json -Url "$base/api/tools/video_render" -Label 'missing-material' `
  -Json ((@{ input = @{ template = @{ id = 'existing_video_package' }; materials = @{ video = 'no-such-clip.mp4' } }; approvals = @{ grantedToolCallId = 'probe_call_2' } } | ConvertTo-Json -Depth 12 -Compress))
$failedTaskId = [regex]::Match(($failed | ConvertFrom-Json).error.message, 'task (\S+) failed').Groups[1].Value
Write-Output ("      the tool error names the task it left behind: {0}" -f $failedTaskId)
$failedTask = Get-Json -Url "$base/api/tasks/$failedTaskId" -Label 'failed-task'
$failedView = ($failedTask | ConvertFrom-Json).data.task
Write-Output ("      kind={0} type={1} status={2} progress={3}" -f `
  $failedView.kind, $failedView.type, $failedView.status, $failedView.progress)
Write-Output ("      error={0}" -f $failedView.error.message)
Write-Output ''

Write-Output '=== 8. a queued render task is cancellable before it runs (the CI-P1-02 rule) ==='
$queued = Post-Json -Url "$base/api/runs" -Label 'queue-run' `
  -Json ((@{ playbookId = 'video_render'; params = $renderInput } | ConvertTo-Json -Depth 12 -Compress))
$queuedId = ($queued | ConvertFrom-Json).data.id
Write-Output ("      queued run id={0} status={1}" -f $queuedId, ($queued | ConvertFrom-Json).data.status)
Post-Json -Url "$base/api/runs/$queuedId/cancel" -Label 'cancel-run' -Json '{}' | Out-Null
$cancelledTask = Get-Json -Url "$base/api/tasks/$queuedId" -Label 'cancelled-task'
$cancelledView = ($cancelledTask | ConvertFrom-Json).data.task
Write-Output ("      kind={0} type={1} status={2} rawStatus={3}" -f `
  $cancelledView.kind, $cancelledView.type, $cancelledView.status, $cancelledView.rawStatus)
Write-Output ''

Get-State -When 'after' | Out-Null
Write-Output '=== rows and files this probe created (left in place as evidence) ==='
Write-Output ("      render task (succeeded): {0}" -f $taskId)
Write-Output ("      render task (failed):    {0}" -f $failedTaskId)
Write-Output ("      render task (cancelled): {0}" -f $queuedId)
Write-Output ("      uploaded material:       {0} ({1} bytes)" -f $material, $materialSize)
Write-Output ("      deliverable video:       {0}" -f $renderData.artifacts.video.fileName)
Write-Output ("      subtitles:               {0}" -f $renderData.artifacts.subtitles.fileName)
Write-Output ("      metadata:                {0}" -f $renderData.artifacts.metadata.fileName)

