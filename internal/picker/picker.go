package picker

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ImageFile 打开背景图选择对话框。用户取消时返回空字符串与 nil error。
func ImageFile(ctx context.Context) (string, error) {
	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "选择背景图",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "图片文件 (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif)",
				Pattern:     "*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif",
			},
		},
	})
}

// TextFile 打开文本文件选择对话框。
func TextFile(ctx context.Context) (string, error) {
	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "导入文本",
		Filters: []runtime.FileFilter{
			{DisplayName: "文本文件 (*.txt;*.md)", Pattern: "*.txt;*.md"},
			{DisplayName: "所有文件", Pattern: "*.*"},
		},
	})
}

// FontFile 打开字体文件选择对话框。
func FontFile(ctx context.Context) (string, error) {
	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "选择字体文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "字体文件 (*.ttf;*.otf;*.ttc;*.woff2)", Pattern: "*.ttf;*.otf;*.ttc;*.woff2"},
		},
	})
}

// OutputDir 打开输出目录选择对话框。
func OutputDir(ctx context.Context) (string, error) {
	return runtime.OpenDirectoryDialog(ctx, runtime.OpenDialogOptions{
		Title: "选择输出目录",
	})
}

// JSONFile 打开 .json 文件选择对话框（导入 AI 配置）。
func JSONFile(ctx context.Context) (string, error) {
	return runtime.OpenFileDialog(ctx, runtime.OpenDialogOptions{
		Title: "导入 AI 配置",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON 文件 (*.json)", Pattern: "*.json"},
			{DisplayName: "所有文件", Pattern: "*.*"},
		},
	})
}

// SaveJSON 打开「另存为」对话框（导出 AI 配置），返回完整路径。
func SaveJSON(ctx context.Context) (string, error) {
	return runtime.SaveFileDialog(ctx, runtime.SaveDialogOptions{
		Title:           "导出 AI 配置",
		DefaultFilename: "textweave-ai-config.json",
		Filters: []runtime.FileFilter{
			{DisplayName: "JSON 文件 (*.json)", Pattern: "*.json"},
		},
	})
}
