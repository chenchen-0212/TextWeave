package aicover

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"textweave/internal/config"
)

// AI 配置独立存放。
//
// 为什么不放进 config.json：那份配置会随模板、分享码、历史记录一起外发，
// 也会被本地控制口的 /config 读走，密钥不能待在那儿。
const fileName = "ai.json"

// DefaultSystemPrompt 留空时使用的系统提示词。
const DefaultSystemPrompt = "你是资深视觉设计提示词工程师。根据用户提供的中文长文，提炼核心主题与情绪，" +
	"输出一段用于文生图模型的高质量提示词。只输出提示词本身，不要解释、不要引号，120 字以内，" +
	"包含画面主体、构图、光线、色彩与风格。"

// LLMConfig 文本模型（OpenAI 兼容）配置。
type LLMConfig struct {
	BaseURL       string `json:"baseUrl"`
	APIKey        string `json:"apiKey"`
	Model         string `json:"model"`
	SystemPrompt  string `json:"systemPrompt"`
	ContextLength int    `json:"contextLength"`
}

// ImageConfig 生图模型（OpenAI 兼容 images 接口）配置。
type ImageConfig struct {
	// BaseURL 是用户填写的完整请求地址，含 /images/generations 之类的后缀
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
	Quality string `json:"quality"`
}

// Config 是 ai.json 的完整结构。
type Config struct {
	LLM   LLMConfig   `json:"llm"`
	Image ImageConfig `json:"image"`
}

func configPath() string { return filepath.Join(config.MustDir(), fileName) }

// LoadRaw 读取 ai.json 原始内容。文件不存在时返回空字符串。
func LoadRaw() (string, error) {
	b, err := os.ReadFile(configPath())
	if errors.Is(err, fs.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("读取 AI 配置失败: %w", err)
	}
	return string(b), nil
}

// SaveRaw 原子写入 ai.json。密钥文件只给当前用户读写。
func SaveRaw(raw string) error {
	if raw == "" {
		return nil
	}
	if !json.Valid([]byte(raw)) {
		return errors.New("AI 配置不是合法 JSON，已拒绝写入")
	}
	p := configPath()
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, []byte(raw), 0o600); err != nil {
		return fmt.Errorf("写入 AI 配置失败: %w", err)
	}
	if err := os.Rename(tmp, p); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("保存 AI 配置失败: %w", err)
	}
	return nil
}

// Load 读取并规范化配置。
func Load() (*Config, error) {
	raw, err := LoadRaw()
	if err != nil {
		return nil, err
	}
	cfg := &Config{}
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), cfg); err != nil {
			return nil, fmt.Errorf("AI 配置格式有误: %w", err)
		}
	}
	cfg.normalize()
	return cfg, nil
}

func (c *Config) normalize() {
	if strings.TrimSpace(c.LLM.SystemPrompt) == "" {
		c.LLM.SystemPrompt = DefaultSystemPrompt
	}
	if c.LLM.ContextLength <= 0 {
		c.LLM.ContextLength = 8000
	}
	if strings.TrimSpace(c.Image.Quality) == "" {
		c.Image.Quality = "high"
	}
}

// Validate 校验必需项。前端已有同样判断，这里守住 Go 侧边界。
func (c *Config) Validate() error {
	missing := []string{}
	if strings.TrimSpace(c.LLM.BaseURL) == "" {
		missing = append(missing, "LLM 基础 URL")
	}
	if strings.TrimSpace(c.LLM.APIKey) == "" {
		missing = append(missing, "LLM API Key")
	}
	if strings.TrimSpace(c.LLM.Model) == "" {
		missing = append(missing, "LLM 模型名称")
	}
	if strings.TrimSpace(c.Image.BaseURL) == "" {
		missing = append(missing, "生图请求地址")
	}
	if strings.TrimSpace(c.Image.APIKey) == "" {
		missing = append(missing, "生图 API Key")
	}
	if strings.TrimSpace(c.Image.Model) == "" {
		missing = append(missing, "生图模型名称")
	}
	if len(missing) > 0 {
		return fmt.Errorf("请先配置 %s", strings.Join(missing, "、"))
	}
	return nil
}
