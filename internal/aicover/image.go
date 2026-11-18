package aicover

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"textweave/internal/config"
	"textweave/internal/fsutil"
)

// 生图接口单次请求的时限；连不上或超时会由 withRetry 再试两次。
const imageTimeout = 180 * time.Second

// imageRequest 对应 OpenAI 兼容的 /images/generations 请求体。
type imageRequest struct {
	Model        string `json:"model"`
	Prompt       string `json:"prompt"`
	Size         string `json:"size"` // 顺序是 宽x高
	Quality      string `json:"quality"`
	OutputFormat string `json:"output_format"`
	N            int    `json:"n"`
}

type imageResponse struct {
	Data []struct {
		B64JSON string `json:"b64_json"`
	} `json:"data"`
}

// normalizeSize 兜住前端传来的宽高/格式，避免非法值打到接口上。
func normalizeSize(width, height int, format string) (string, string, error) {
	if width < 2 || width > 100000 || height < 2 || height > 100000 {
		return "", "", fmt.Errorf("输出尺寸不合法：%dx%d", width, height)
	}
	switch format {
	case "png", "jpeg", "webp":
	default:
		format = "png"
	}
	return fmt.Sprintf("%dx%d", width, height), format, nil
}

// generateImage 请求生图接口，返回 b64_json。
func generateImage(ctx context.Context, cfg ImageConfig, prompt, size, format string) (string, error) {
	payload, err := json.Marshal(imageRequest{
		Model:        cfg.Model,
		Prompt:       prompt,
		Size:         size,
		Quality:      cfg.Quality,
		OutputFormat: format,
		N:            1,
	})
	if err != nil {
		return "", fmt.Errorf("构造生图请求失败: %w", err)
	}

	// 请求地址由用户填全（含 /images/generations 之类后缀），这里不再拼接
	endpoint := strings.TrimSpace(cfg.BaseURL)
	client := &http.Client{Timeout: imageTimeout}

	return withRetry(ctx, func() (string, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
		if err != nil {
			return "", fmt.Errorf("构造生图请求失败: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
		if err != nil {
			return "", err
		}
		if resp.StatusCode != http.StatusOK {
			return "", &statusError{code: resp.StatusCode, body: snippet(body)}
		}

		var out imageResponse
		if err := json.Unmarshal(body, &out); err != nil {
			return "", fmt.Errorf("解析生图响应失败: %w", err)
		}
		if len(out.Data) == 0 || out.Data[0].B64JSON == "" {
			return "", errors.New("生图接口未返回 b64_json")
		}
		return out.Data[0].B64JSON, nil
	})
}

// saveCover 把 base64 图片写到配置目录下的 covers/。
//
// shortcut: 文件名带时间戳、旧文件不清理，因为前端按路径缓存位图，
// 复用同一路径会显示上一张图（累积的文件量级在几百 KB/张，暂可接受）。
func saveCover(coverID, format, b64 string) (string, error) {
	dir := filepath.Join(config.MustDir(), "covers")
	name := fmt.Sprintf("ai-%s-%s.%s", safeID(coverID), time.Now().Format("20060102-150405"), format)
	return fsutil.SaveImage(dir, name, b64)
}

// safeID 只保留文件名安全的字符；coverId 由前端生成，但不值得信任。
func safeID(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	if b.Len() == 0 {
		return "cover"
	}
	return b.String()
}

func snippet(b []byte) string {
	const max = 300
	s := strings.TrimSpace(string(b))
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}
