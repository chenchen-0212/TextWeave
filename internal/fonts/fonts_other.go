//go:build !windows

package fonts

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// platformFontFiles 在类 Unix 系统上从标准字体目录递归收集字体文件。
//
// macOS 与 Linux 没有 Windows 那样的字体注册表，字体直接以文件形式存放在
// 若干约定目录中，递归扫描即为权威来源。
func platformFontFiles() []string {
	home, _ := os.UserHomeDir()

	var dirs []string
	switch runtime.GOOS {
	case "darwin":
		dirs = []string{
			"/System/Library/Fonts",
			"/System/Library/Fonts/Supplemental",
			"/Library/Fonts",
			filepath.Join(home, "Library", "Fonts"),
		}
	default:
		dirs = []string{
			"/usr/share/fonts",
			"/usr/local/share/fonts",
			filepath.Join(home, ".fonts"),
			filepath.Join(home, ".local", "share", "fonts"),
		}
	}

	seen := map[string]bool{}
	var out []string

	for _, d := range dirs {
		_ = filepath.WalkDir(d, func(path string, de os.DirEntry, err error) error {
			if err != nil || de == nil || de.IsDir() {
				return nil
			}
			if !allowedExt[strings.ToLower(filepath.Ext(path))] {
				return nil
			}
			key := strings.ToLower(path)
			if seen[key] {
				return nil
			}
			seen[key] = true
			out = append(out, path)
			return nil
		})
	}

	return out
}
