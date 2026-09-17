package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

var (
	mu      sync.Mutex
	baseDir string
)

const appFolder = "TextWeave"

// Dir 返回应用数据目录（首次调用时自动创建）。
func Dir() (string, error) {
	mu.Lock()
	defer mu.Unlock()
	if baseDir != "" {
		return baseDir, nil
	}
	root, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("无法定位用户配置目录: %w", err)
	}
	d := filepath.Join(root, appFolder)
	if err := os.MkdirAll(d, 0o755); err != nil {
		return "", fmt.Errorf("创建配置目录失败: %w", err)
	}
	baseDir = d
	return d, nil
}

// MustDir 是 Dir 的简化版，失败时回退到系统临时目录，保证调用方不会因目录问题崩溃。
func MustDir() string {
	d, err := Dir()
	if err == nil {
		return d
	}
	fallback := filepath.Join(os.TempDir(), appFolder)
	_ = os.MkdirAll(fallback, 0o755)
	return fallback
}

// UserFontDir 用户上传字体的存放目录。
func UserFontDir() string {
	d := filepath.Join(MustDir(), "fonts")
	_ = os.MkdirAll(d, 0o755)
	return d
}

func configPath() string { return filepath.Join(MustDir(), "config.json") }

// LoadConfig 读取 config.json 的原始内容。文件不存在时返回空字符串与 nil。
func LoadConfig() (string, error) {
	raw, err := os.ReadFile(configPath())
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("读取配置失败: %w", err)
	}
	return string(raw), nil
}

// SaveConfig 以「先写临时文件再重命名」的方式原子保存配置，避免中途崩溃导致文件损坏。
func SaveConfig(raw string) error {
	if raw == "" {
		return nil
	}
	// 校验必须是合法 JSON，防止写入损坏数据导致下次启动解析失败
	if !json.Valid([]byte(raw)) {
		return fmt.Errorf("配置内容不是合法 JSON，已拒绝写入")
	}
	path := configPath()
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(raw), 0o644); err != nil {
		return fmt.Errorf("写入配置失败: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("保存配置失败: %w", err)
	}
	return nil
}

// ReadCache 读取命名缓存文件的原始内容，不存在时返回空字符串。
func ReadCache(name string) (string, error) {
	raw, err := os.ReadFile(filepath.Join(MustDir(), name))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return string(raw), nil
}

// WriteCache 写入命名缓存文件。
func WriteCache(name string, raw string) error {
	return os.WriteFile(filepath.Join(MustDir(), name), []byte(raw), 0o644)
}
