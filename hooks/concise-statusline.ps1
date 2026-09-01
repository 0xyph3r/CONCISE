# concise - statusline badge. Shows [CONCISE] plus the live prose-budget bar.
#
# Usage in %USERPROFILE%\.claude\settings.json:
#   "statusLine": { "type": "command", "command": "powershell -ExecutionPolicy Bypass -File C:\path\to\concise-statusline.ps1" }

# Bounded read: opens the file and reads at most $maxBytes off disk, never
# the whole file into memory. head -c does this for free in bash; PowerShell
# needs it spelled out via a FileStream, or Get-Content -Raw would pull an
# arbitrarily large file into memory on every statusline render.
function Read-CappedBytes($path, $maxBytes) {
  try {
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $buf = New-Object byte[] $maxBytes
      $n = $fs.Read($buf, 0, $maxBytes)
      return [System.Text.Encoding]::UTF8.GetString($buf, 0, $n)
    } finally {
      $fs.Dispose()
    }
  } catch {
    return ''
  }
}

# Writes raw UTF-8 bytes straight to the stdout stream, bypassing
# Write-Host / Console.Out entirely. Windows PowerShell 5.1 encodes
# Write-Host output using the console/pipe's OutputEncoding (often the
# system OEM codepage, not UTF-8) regardless of the string's correct
# in-memory representation - the block characters (U+2588/U+2591) would
# come out as mojibake (typically a diamond-question-mark glyph) even
# though this script built them correctly. Writing bytes directly
# sidesteps that encoding layer altogether.
function Write-Utf8Bytes([string]$text) {
  if (-not $text) { return }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
}

$esc = [char]27

$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$flagPath = Join-Path $claudeDir '.concise-active'
$barPath = Join-Path $claudeDir '.concise-statusline-bar'

if (-not (Test-Path -LiteralPath $flagPath -PathType Leaf)) { exit 0 }
$flagItem = Get-Item -LiteralPath $flagPath -Force
if ($flagItem.LinkType) { exit 0 }  # refuse symlinks/junctions

$rawMode = Read-CappedBytes $flagPath 8
if (-not $rawMode) { exit 0 }
$mode = ($rawMode -replace '[^a-z]', '').ToLower()
if ($mode -ne 'on') { exit 0 }

$output = "$esc[38;5;108m[CONCISE]$esc[0m"

if (Test-Path -LiteralPath $barPath -PathType Leaf) {
  $barItem = Get-Item -LiteralPath $barPath -Force
  if (-not $barItem.LinkType) {
    $rawBar = Read-CappedBytes $barPath 100
    if ($rawBar) {
      # Strip control chars (blocks ESC/terminal-escape injection) rather
      # than an ASCII allow-list - the bar uses block characters (U+2588
      # full block, U+2591 light shade), which an allow-list would eat.
      $bar = ($rawBar -replace '[\x00-\x1F\x7F]', '')
      if ($bar) { $output += " $esc[38;5;108m$bar$esc[0m" }
    }
  }
}

Write-Utf8Bytes $output
