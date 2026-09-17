package imageinfo

import (
	"fmt"
	"image"
	"os"
	"path/filepath"
	"strings"

	// 注册各格式解码器
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"
)

// Info 背景图元信息。
type Info struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Aspect string `json:"aspect"`
	Format string `json:"format"`
	Bytes  int64  `json:"bytes"`
	MIME   string `json:"mime"`
}

var mimeByExt = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".bmp":  "image/bmp",
	".gif":  "image/gif",
}

// Probe 读取图片的尺寸与格式。
func Probe(path string) (*Info, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("打开图片失败: %w", err)
	}
	defer f.Close()

	cfg, format, err := image.DecodeConfig(f)
	if err != nil {
		return nil, fmt.Errorf("无法识别的图片格式（支持 PNG / JPG / WebP / BMP / GIF）: %w", err)
	}

	st, _ := f.Stat()
	var size int64
	if st != nil {
		size = st.Size()
	}

	ext := strings.ToLower(filepath.Ext(path))
	mime := mimeByExt[ext]
	if mime == "" {
		mime = "image/" + format
	}

	return &Info{
		Path:   path,
		Name:   filepath.Base(path),
		Width:  cfg.Width,
		Height: cfg.Height,
		Aspect: ratio(cfg.Width, cfg.Height),
		Format: format,
		Bytes:  size,
		MIME:   mime,
	}, nil
}

// ratio 返回最简整数比字符串，例如 "9:16"。
func ratio(w, h int) string {
	if w <= 0 || h <= 0 {
		return ""
	}
	g := gcd(w, h)
	return fmt.Sprintf("%d:%d", w/g, h/g)
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		return -a
	}
	return a
}
