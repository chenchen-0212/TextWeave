package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"textweave/internal/config"
	"textweave/internal/fsutil"
	"textweave/internal/fonts"
	"textweave/internal/imageinfo"
	"textweave/internal/picker"
	"textweave/internal/pyexec"
)

// Version 应用版本号，随构建可注入。
var Version = "0.4.0"

// App 是暴露给前端的绑定对象。
//
// 职责边界（对应产品方案 D-02）：Go 只负责文件选择、图片落盘、字体枚举、
// 配置持久化与子进程管理；一切渲染与排版都在前端 WebView2 中完成。
type App struct {
	ctx    context.Context
	runner *pyexec.Runner
}

// NewApp 创建应用实例。
func NewApp() *App {
	return &App{runner: pyexec.New("")}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// ---------------------------------------------------------------- 文件选择

// PickImage 选择背景图。
func (a *App) PickImage() (string, error) { return picker.ImageFile(a.ctx) }

// PickTextFile 选择要导入的文本文件。
func (a *App) PickTextFile() (string, error) { return picker.TextFile(a.ctx) }

// PickFontFile 选择要导入的字体文件。
func (a *App) PickFontFile() (string, error) { return picker.FontFile(a.ctx) }

// PickOutputDir 选择输出目录。
func (a *App) PickOutputDir() (string, error) { return picker.OutputDir(a.ctx) }

// ---------------------------------------------------------------- 读取

// ReadTextFile 读取文本文件内容。
func (a *App) ReadTextFile(path string) (string, error) {
	if !fsutil.FileExists(path) {
		return "", fmt.Errorf("文件不存在: %s", path)
	}
	return fsutil.ReadTextFile(path)
}

// ReadFileBase64 读取任意文件并返回 base64，供前端构造 Blob / FontFace。
func (a *App) ReadFileBase64(path string) (string, error) {
	if !fsutil.FileExists(path) {
		return "", fmt.Errorf("文件不存在: %s", path)
	}
	return fsutil.ReadFileBase64(path)
}

// ProbeImage 读取背景图的尺寸与格式信息。
func (a *App) ProbeImage(path string) (*imageinfo.Info, error) {
	return imageinfo.Probe(path)
}

// ---------------------------------------------------------------- 保存

// SaveImage 将一张渲染结果（base64）写入指定目录。
func (a *App) SaveImage(dir, filename, data string) (string, error) {
	return fsutil.SaveImage(dir, filename, data)
}

// SaveZip 将多张渲染结果打包为 zip 写入指定目录。
func (a *App) SaveZip(dir, zipName string, entries []fsutil.ZipEntry) (string, error) {
	return fsutil.SaveZip(dir, zipName, entries)
}

// RevealInFolder 在系统文件管理器中定位到指定路径。
func (a *App) RevealInFolder(path string) error {
	if path == "" {
		return fmt.Errorf("路径为空")
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// explorer 的 /select 参数无法正确接受带逗号的路径，改用 /select, 形式
		cmd = exec.Command("explorer", "/select,"+filepath.FromSlash(path))
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	default:
		dir := path
		if st, err := os.Stat(path); err == nil && !st.IsDir() {
			dir = filepath.Dir(path)
		}
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Start()
}

// ---------------------------------------------------------------- 配置

// LoadConfig 读取上次保存的参数配置（原始 JSON 字符串，空字符串表示尚无配置）。
func (a *App) LoadConfig() (string, error) { return config.LoadConfig() }

// SaveConfig 保存参数配置。
func (a *App) SaveConfig(raw string) error { return config.SaveConfig(raw) }

// ConfigDir 返回应用数据目录，便于界面展示。
func (a *App) ConfigDir() string { return config.MustDir() }

// ---------------------------------------------------------------- 字体

// ListFonts 枚举可用字体（仅返回覆盖汉字区的字体）。
func (a *App) ListFonts() ([]fonts.Entry, error) { return fonts.Enumerate() }

// ImportFont 校验并导入用户字体。
func (a *App) ImportFont(src string) (*fonts.Entry, error) { return fonts.ImportUserFont(src) }

// RemoveFont 移除已导入的用户字体。
func (a *App) RemoveFont(path string) error { return fonts.RemoveUserFont(path) }

// ---------------------------------------------------------------- Python 增强通道

// PyStatus 返回 Python 通道状态，供界面展示与降级判断。
func (a *App) PyStatus() pyexec.Status { return a.runner.GetStatus() }

// PyRun 执行一个 Python 脚本，args 为 JSON 字符串。
//
// 该通道为预留扩展位，当前版本不承载核心功能；Python 缺失时返回明确错误，
// 前端据此将相关入口置灰，核心渲染链路完全不受影响。
func (a *App) PyRun(script string, args string) (pyexec.Result, error) {
	var payload any
	if s := strings.TrimSpace(args); s != "" && s != "null" {
		if !json.Valid([]byte(s)) {
			return pyexec.Result{}, fmt.Errorf("args 不是合法 JSON")
		}
		payload = json.RawMessage(s)
	}
	res, err := a.runner.Run(a.ctx, script, payload)
	if res == nil {
		return pyexec.Result{OK: false, Error: errString(err)}, err
	}
	return *res, err
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// ---------------------------------------------------------------- 杂项

// AppInfo 返回应用元信息。
func (a *App) AppInfo() map[string]string {
	return map[string]string{
		"name":      "文织 TextWeave",
		"version":   Version,
		"goVersion": runtime.Version(),
		"os":        runtime.GOOS,
		"arch":      runtime.GOARCH,
		"configDir": config.MustDir(),
	}
}
