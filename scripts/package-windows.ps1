# 构建 Windows 产物并整理到 dist/
#
# 前置条件：
#   1. Go 1.21+、Node 18+、Wails CLI v2
#   2. NSIS（makensis 需在 PATH 中）
#      未安装时执行：winget install -e --id NSIS.NSIS
#
# 用法：powershell -ExecutionPolicy Bypass -File scripts/package-windows.ps1
#
# 注意：本文件必须保存为「UTF-8 with BOM」。Windows PowerShell 5.1 在没有 BOM 时
# 会按系统 ANSI 代码页（简体中文下为 GBK）解析脚本，中文内容会被拆坏并导致语法错误。

$ErrorActionPreference = 'Stop'

$Version = '0.2.0'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$DistDir = Join-Path $ProjectRoot 'dist'
if (Test-Path $DistDir) { Remove-Item $DistDir -Recurse -Force }
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null

Write-Host '=== 检查 makensis ===' -ForegroundColor Cyan
$makensis = Get-Command makensis -ErrorAction SilentlyContinue
if (-not $makensis) {
    $nsisDir = 'C:\Program Files (x86)\NSIS'
    if (Test-Path (Join-Path $nsisDir 'makensis.exe')) {
        $env:PATH = "$nsisDir;$env:PATH"
        Write-Host "已把 NSIS 加入 PATH：$nsisDir"
    } else {
        throw '未找到 makensis。请先执行：winget install -e --id NSIS.NSIS'
    }
}

Write-Host '=== 构建（exe + NSIS 安装包）===' -ForegroundColor Cyan
$env:CGO_ENABLED = '1'
wails build -clean -platform windows/amd64 -nsis -webview2 download

if ($LASTEXITCODE -ne 0) {
    throw ('wails build 失败，退出码 ' + $LASTEXITCODE)
}

Write-Host '=== 整理产物 ===' -ForegroundColor Cyan

$exe = Join-Path $ProjectRoot 'build\bin\TextWeave.exe'
$setup = Join-Path $ProjectRoot 'build\bin\textweave-amd64-installer.exe'
$count = 0

if (Test-Path $exe) {
    $name = 'TextWeave-' + $Version + '-windows-amd64-portable.exe'
    $portable = Join-Path $DistDir $name
    Copy-Item $exe $portable
    Write-Host ('  便携版：' + $name)
    $count++
}

if (Test-Path $setup) {
    $name = 'TextWeave-' + $Version + '-windows-amd64-setup.exe'
    $target = Join-Path $DistDir $name
    Copy-Item $setup $target
    Write-Host ('  安装包：' + $name)
    $count++
}

if ($count -eq 0) {
    throw '构建未产出任何文件，请检查 wails build 的输出'
}

Write-Host '=== 完成 ===' -ForegroundColor Green
Get-ChildItem $DistDir -File | ForEach-Object {
    $mb = [math]::Round($_.Length / 1MB, 2)
    Write-Host ('  ' + $_.Name + '  ' + $mb + ' MB')
}
