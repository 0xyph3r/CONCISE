# Tests for hooks/concise-statusline.ps1 - run: powershell -File tests/test_concise_statusline.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'hooks\concise-statusline.ps1'
$passed = 0
$failed = 0

# Built from char codes, never typed literally: a .ps1 saved without a BOM is
# read by Windows PowerShell 5.1 as the system ANSI codepage, not UTF-8 - a
# literal block character in source corrupts into mojibake and breaks parsing.
$fullBlock = [char]0x2588
$emptyBlock = [char]0x2591

function Check($name, $expectedSubstr, $actual) {
  if ($actual -like "*$expectedSubstr*") {
    $script:passed++
    Write-Host "  OK $name"
  } else {
    $script:failed++
    Write-Host "  FAIL $name"
    Write-Host "    expected to contain: $expectedSubstr"
    Write-Host "    got: $actual"
  }
}

function CheckEmpty($name, $actual) {
  if ([string]::IsNullOrEmpty($actual)) {
    $script:passed++
    Write-Host "  OK $name"
  } else {
    $script:failed++
    Write-Host "  FAIL $name"
    Write-Host "    expected empty, got: $actual"
  }
}

Write-Host "concise-statusline.ps1 tests"
Write-Host ""

# Missing flag -> empty output
$tmp1 = Join-Path $env:TEMP ("concise-ps1-test-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp1 | Out-Null
$env:CLAUDE_CONFIG_DIR = $tmp1
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script
CheckEmpty "missing flag produces no output" $out
Remove-Item -Recurse -Force $tmp1

# on flag + bar -> badge and bar
$tmp2 = Join-Path $env:TEMP ("concise-ps1-test-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp2 | Out-Null
Set-Content -LiteralPath (Join-Path $tmp2 '.concise-active') -Value 'on' -NoNewline
# Write real UTF-8 (no BOM) matching how concise-stats.js writes the bar in
# production - Set-Content's default encoding would mangle the block chars.
$expectedBlocks = ($fullBlock.ToString() * 10) + ($emptyBlock.ToString() * 10)
$barContent = "[$expectedBlocks] 50% of budget"
[System.IO.File]::WriteAllText((Join-Path $tmp2 '.concise-statusline-bar'), $barContent, (New-Object System.Text.UTF8Encoding($false)))
$env:CLAUDE_CONFIG_DIR = $tmp2
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script
Check "on flag with bar shows the bar" "50%" $out
Check "on flag with bar shows the unicode block characters (not stripped by sanitization)" $expectedBlocks $out
Remove-Item -Recurse -Force $tmp2

# off flag -> empty output
$tmp3 = Join-Path $env:TEMP ("concise-ps1-test-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp3 | Out-Null
Set-Content -LiteralPath (Join-Path $tmp3 '.concise-active') -Value 'off' -NoNewline
$env:CLAUDE_CONFIG_DIR = $tmp3
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script
CheckEmpty "off flag produces no output" $out
Remove-Item -Recurse -Force $tmp3

# large bar file (bigger than the 100-byte cap) -> script reads it capped, no hang/error
$tmp4 = Join-Path $env:TEMP ("concise-ps1-test-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp4 | Out-Null
Set-Content -LiteralPath (Join-Path $tmp4 '.concise-active') -Value 'on' -NoNewline
$largeBar = '#' * 5000
Set-Content -LiteralPath (Join-Path $tmp4 '.concise-statusline-bar') -Value $largeBar -NoNewline
$env:CLAUDE_CONFIG_DIR = $tmp4
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script
$barPart = $out -replace ".*\[CONCISE\]\s*", ""
if ($barPart.Length -le 150) {
  $script:passed++; Write-Host "  OK large bar file is read capped, not printed in full"
} else {
  $script:failed++; Write-Host "  FAIL large bar file is read capped, not printed in full"
  Write-Host "    got length: $($barPart.Length)"
}
Remove-Item -Recurse -Force $tmp4

# on flag, no bar file yet -> badge only, AND output contains a real ESC
# byte (27) not literal backtick-e text (regression test for the PS 5.1
# `e-escape bug)
$tmp5 = Join-Path $env:TEMP ("concise-ps1-test-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp5 | Out-Null
Set-Content -LiteralPath (Join-Path $tmp5 '.concise-active') -Value 'on' -NoNewline
$env:CLAUDE_CONFIG_DIR = $tmp5
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script
Check "on flag with no bar shows [CONCISE] badge" "CONCISE" $out
$hasEsc = $out.ToCharArray() | Where-Object { [int]$_ -eq 27 }
if ($hasEsc) {
  $script:passed++; Write-Host "  OK output contains a real ESC byte (27), not literal backtick-e text"
} else {
  $script:failed++; Write-Host "  FAIL output contains a real ESC byte (27), not literal backtick-e text"
  Write-Host "    got: $out"
}
Remove-Item -Recurse -Force $tmp5

Remove-Item Env:\CLAUDE_CONFIG_DIR

Write-Host ""
Write-Host "$passed passed, $failed failed"
if ($failed -gt 0) { exit 1 } else { exit 0 }
