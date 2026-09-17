//go:build windows

package fonts

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// platformFontFiles 从注册表与字体目录两路枚举 Windows 系统字体文件。
//
// 双路并行的原因（对应风险 R-13）：注册表是权威来源但可能缺少免安装字体，
// 直接扫描字体目录可兜底补齐；两者结果合并去重。
func platformFontFiles() []string {
	seen := map[string]bool{}
	var out []string

	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" || !filepath.IsAbs(p) {
			return
		}
		if !allowedExt[strings.ToLower(filepath.Ext(p))] {
			return
		}
		key := strings.ToLower(p)
		if seen[key] {
			return
		}
		st, err := os.Stat(p)
		if err != nil || st.IsDir() {
			return
		}
		seen[key] = true
		out = append(out, p)
	}

	winDir := os.Getenv("SystemRoot")
	if winDir == "" {
		winDir = `C:\Windows`
	}
	fontDir := filepath.Join(winDir, "Fonts")

	// 1) 注册表登记的字体
	const regPath = `SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`
	for _, root := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
		k, err := registry.OpenKey(root, regPath, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		names, err := k.ReadValueNames(0)
		if err == nil {
			for _, name := range names {
				val, _, err := k.GetStringValue(name)
				if err != nil || val == "" {
					continue
				}
				// 单个注册项可能登记多个文件，以逗号分隔
				for _, part := range strings.Split(val, ",") {
					part = strings.TrimSpace(part)
					if part == "" {
						continue
					}
					if filepath.IsAbs(part) {
						add(part)
					} else {
						add(filepath.Join(fontDir, part))
					}
				}
			}
		}
		_ = k.Close()
	}

	// 2) 兜底扫描字体目录，捕获未在注册表登记的字体
	if items, err := os.ReadDir(fontDir); err == nil {
		for _, it := range items {
			if !it.IsDir() {
				add(filepath.Join(fontDir, it.Name()))
			}
		}
	}

	// 3) 用户级字体目录（免安装字体）
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		userFontDir := filepath.Join(local, "Microsoft", "Windows", "Fonts")
		if items, err := os.ReadDir(userFontDir); err == nil {
			for _, it := range items {
				if !it.IsDir() {
					add(filepath.Join(userFontDir, it.Name()))
				}
			}
		}
	}

	return out
}
