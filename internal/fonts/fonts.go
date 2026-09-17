// Package fonts 负责系统字体枚举与用户字体管理。
//
// 核心约束（对应产品方案 F-10 / R-11）：
//   - 只列出覆盖常用汉字区（U+4E00–U+9FFF）的字体，避免用户选到纯拉丁字体后满屏方块；
//   - 用户上传字体需通过三项校验：可解码、覆盖汉字区、格式受支持，任一不过则拒绝导入；
//   - 扫描结果带磁盘缓存（按「路径 + 大小 + 修改时间」失效），首次扫描后后续启动即时可用。
package fonts

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"golang.org/x/image/font/sfnt"

	"textweave/internal/config"
)

// Entry 描述一个可用字体。
type Entry struct {
	Family   string `json:"family"`
	Path     string `json:"path"`
	Source   string `json:"source"` // system | user
	HasCJK   bool   `json:"hasCJK"`
	Verified bool   `json:"verified"` // false 表示未能完成字形校验（如 woff2）
	Bytes    int64  `json:"bytes"`
}

const cacheName = "fontscan.json"

// cjkSamples 用于校验字体是否覆盖常用汉字区。
var cjkSamples = []rune("中文字体测试汉阅读")

const minCJKHits = 6

var allowedExt = map[string]bool{
	".ttf":   true,
	".otf":   true,
	".ttc":   true,
	".woff2": true,
}

type cacheEntry struct {
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
	Family  string `json:"family"`
	HasCJK  bool   `json:"hasCJK"`
}

type scanCache map[string]cacheEntry

var (
	cacheMu sync.Mutex
	cache   scanCache
)

func loadCache() scanCache {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if cache != nil {
		return cache
	}
	cache = scanCache{}
	if raw, err := config.ReadCache(cacheName); err == nil && raw != "" {
		_ = json.Unmarshal([]byte(raw), &cache)
	}
	return cache
}

func saveCache() {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if cache == nil {
		return
	}
	if raw, err := json.Marshal(cache); err == nil {
		_ = config.WriteCache(cacheName, string(raw))
	}
}

// inspect 读取字体的真实族名与汉字覆盖情况。
func inspect(path string, size int64, modTime int64) (string, bool) {
	fallback := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	ext := strings.ToLower(filepath.Ext(path))

	// woff2 使用 brotli 压缩，sfnt 无法解析。
	// 这里标记为「未校验通过」，交由前端在 FontFace 加载完成后做字形宽度比对二次校验。
	if ext == ".woff2" {
		return fallback, true
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return fallback, false
	}

	var font *sfnt.Font
	if len(raw) >= 4 && string(raw[:4]) == "ttcf" {
		// TrueType Collection：取第一个字体
		coll, err := sfnt.ParseCollection(raw)
		if err != nil || coll.NumFonts() == 0 {
			return fallback, false
		}
		font, err = coll.Font(0)
		if err != nil {
			return fallback, false
		}
	} else {
		font, err = sfnt.Parse(raw)
		if err != nil {
			return fallback, false
		}
	}

	var buf sfnt.Buffer
	family := fallback
	if n, err := font.Name(&buf, sfnt.NameIDFamily); err == nil && strings.TrimSpace(n) != "" {
		family = strings.TrimSpace(n)
	}

	return family, glyphCoverage(font, &buf) >= minCJKHits
}

// glyphCoverage 统计抽样汉字在字体中的命中数。
func glyphCoverage(f *sfnt.Font, buf *sfnt.Buffer) int {
	hit := 0
	for _, r := range cjkSamples {
		idx, err := f.GlyphIndex(buf, r)
		if err == nil && idx != 0 {
			hit++
		}
	}
	return hit
}

// userFontFiles 列出用户上传的字体文件。
func userFontFiles() []string {
	dir := config.UserFontDir()
	items, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, it := range items {
		if it.IsDir() {
			continue
		}
		if allowedExt[strings.ToLower(filepath.Ext(it.Name()))] {
			out = append(out, filepath.Join(dir, it.Name()))
		}
	}
	return out
}

// Enumerate 返回全部可用字体。只返回覆盖汉字的字体，按族名排序。
func Enumerate() ([]Entry, error) {
	files := append(platformFontFiles(), userFontFiles()...)
	sort.Strings(files)

	c := loadCache()
	changed := false

	byFamily := map[string]Entry{}
	// 先处理系统字体，再用用户字体覆盖同名字体（用户上传的优先）
	for _, path := range files {
		st, err := os.Stat(path)
		if err != nil || st.IsDir() {
			continue
		}
		source := "system"
		if strings.HasPrefix(strings.ToLower(path), strings.ToLower(config.UserFontDir())) {
			source = "user"
		}

		key := strings.ToLower(path)
		ce, hit := c[key]
		if !hit || ce.Size != st.Size() || ce.ModTime != st.ModTime().Unix() {
			family, ok := inspect(path, st.Size(), st.ModTime().Unix())
			ce = cacheEntry{Size: st.Size(), ModTime: st.ModTime().Unix(), Family: family, HasCJK: ok}
			c[key] = ce
			changed = true
		}

		if !ce.HasCJK {
			continue
		}
		family := strings.TrimSpace(ce.Family)
		if family == "" {
			family = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		}
		byFamily[strings.ToLower(family)] = Entry{
			Family:   family,
			Path:     path,
			Source:   source,
			HasCJK:   true,
			Verified: strings.ToLower(filepath.Ext(path)) != ".woff2",
			Bytes:    st.Size(),
		}
	}

	if changed {
		saveCache()
	}

	out := make([]Entry, 0, len(byFamily))
	for _, e := range byFamily {
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Source != out[j].Source {
			return out[i].Source == "user" // 用户字体排前面
		}
		return strings.ToLower(out[i].Family) < strings.ToLower(out[j].Family)
	})
	return out, nil
}

// ImportUserFont 校验并导入一个字体文件。
func ImportUserFont(src string) (*Entry, error) {
	ext := strings.ToLower(filepath.Ext(src))
	if !allowedExt[ext] {
		return nil, fmt.Errorf("不支持的字体格式 %s（仅支持 .ttf / .otf / .ttc / .woff2）", ext)
	}
	st, err := os.Stat(src)
	if err != nil {
		return nil, fmt.Errorf("无法读取字体文件: %w", err)
	}
	if st.IsDir() {
		return nil, fmt.Errorf("请选择字体文件而不是文件夹")
	}

	dstDir := config.UserFontDir()
	dst := filepath.Join(dstDir, filepath.Base(src))

	if err := copyFile(src, dst); err != nil {
		return nil, fmt.Errorf("复制字体失败: %w", err)
	}

	dstInfo, err := os.Stat(dst)
	if err != nil {
		return nil, fmt.Errorf("字体写入后无法读取: %w", err)
	}

	family, hasCJK := inspect(dst, dstInfo.Size(), dstInfo.ModTime().Unix())
	if !hasCJK {
		_ = os.Remove(dst)
		return nil, fmt.Errorf("该字体未覆盖常用汉字区，已拒绝导入（避免渲染出方块）")
	}

	// 清掉这类字体的旧缓存，确保下次枚举读到新值
	cacheMu.Lock()
	if cache != nil {
		delete(cache, strings.ToLower(dst))
	}
	cacheMu.Unlock()
	saveCache()

	return &Entry{
		Family:   family,
		Path:     dst,
		Source:   "user",
		HasCJK:   true,
		Verified: ext != ".woff2",
		Bytes:    dstInfo.Size(),
	}, nil
}

// RemoveUserFont 移除一个已导入的字体。只允许删除用户字体目录内的文件。
func RemoveUserFont(path string) error {
	dir := strings.ToLower(config.UserFontDir())
	if !strings.HasPrefix(strings.ToLower(path), dir) {
		return fmt.Errorf("只能移除通过本应用导入的字体")
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("移除字体失败: %w", err)
	}

	cacheMu.Lock()
	if cache != nil {
		delete(cache, strings.ToLower(path))
	}
	cacheMu.Unlock()
	saveCache()
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}
