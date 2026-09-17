package fsutil

import (
	"archive/zip"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// DecodeDataURL 接受纯 base64 或 data URL，返回原始字节。
func DecodeDataURL(data string) ([]byte, error) {
	if strings.HasPrefix(data, "data:") {
		if i := strings.Index(data, ","); i >= 0 {
			data = data[i+1:]
		}
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(data))
	if err != nil {
		return nil, fmt.Errorf("base64 解码失败: %w", err)
	}
	return raw, nil
}

// safeName 只取文件名部分，防止路径穿越。
func safeName(name string) string {
	name = filepath.Base(filepath.FromSlash(name))
	if name == "." || name == ".." || name == string(filepath.Separator) {
		return "output"
	}
	return name
}

// SaveImage 将 base64 图片数据写入 dir/filename，返回完整路径。
func SaveImage(dir, filename, data string) (string, error) {
	raw, err := DecodeDataURL(data)
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", fmt.Errorf("未指定输出目录")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("创建输出目录失败: %w", err)
	}
	full := filepath.Join(dir, safeName(filename))
	if err := os.WriteFile(full, raw, 0o644); err != nil {
		return "", fmt.Errorf("写入文件失败: %w", err)
	}
	return full, nil
}

// ZipEntry 表示一个待写入压缩包的条目（内容为 base64）。
type ZipEntry struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

// SaveZip 将若干 base64 条目打包为 dir/zipName，返回完整路径。
func SaveZip(dir, zipName string, entries []ZipEntry) (string, error) {
	if dir == "" {
		return "", fmt.Errorf("未指定输出目录")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("创建输出目录失败: %w", err)
	}
	if zipName == "" {
		zipName = "textweave-cards.zip"
	}
	full := filepath.Join(dir, safeName(zipName))

	f, err := os.Create(full)
	if err != nil {
		return "", fmt.Errorf("创建压缩包失败: %w", err)
	}
	defer f.Close()

	zw := zip.NewWriter(f)
	for _, e := range entries {
		raw, err := DecodeDataURL(e.Data)
		if err != nil {
			zw.Close()
			return "", fmt.Errorf("条目 %s 解码失败: %w", e.Name, err)
		}
		w, err := zw.Create(safeName(e.Name))
		if err != nil {
			zw.Close()
			return "", fmt.Errorf("写入条目 %s 失败: %w", e.Name, err)
		}
		if _, err := w.Write(raw); err != nil {
			zw.Close()
			return "", fmt.Errorf("写入条目 %s 失败: %w", e.Name, err)
		}
	}
	if err := zw.Close(); err != nil {
		return "", fmt.Errorf("关闭压缩包失败: %w", err)
	}
	return full, nil
}

// ReadTextFile 读取文本文件内容。
func ReadTextFile(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %w", err)
	}
	// 去掉 UTF-8 BOM
	s := string(raw)
	s = strings.TrimPrefix(s, "\ufeff")
	return s, nil
}

// ReadFileBase64 读取任意文件并返回 base64（不含 data URL 前缀）。
func ReadFileBase64(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("打开文件失败: %w", err)
	}
	defer f.Close()

	raw, err := io.ReadAll(f)
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %w", err)
	}
	return base64.StdEncoding.EncodeToString(raw), nil
}

// FileExists 判断路径是否存在且为文件。
func FileExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}

// DirExists 判断路径是否存在且为目录。
func DirExists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.IsDir()
}
