package aicover

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/cloudwego/eino-ext/components/model/openai"
	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/schema"
)

// 文本模型单次请求的时限。
const chatTimeout = 90 * time.Second

// Request 一次生成封面的输入。宽高取封面画布配置（含像素倍率）。
type Request struct {
	Article string `json:"article"`
	CoverID string `json:"coverId"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Format  string `json:"format"`
}

// Result 生成结果：落盘后的图片路径与模型给出的提示词。
type Result struct {
	Path   string `json:"path"`
	Prompt string `json:"prompt"`
}

// Run 跑固定的 agent 工作流：正文 → 生图提示词 → 图片落盘。
//
// 图编排用 Eino：整条链路是确定的（没有工具调用与循环），
// 所以用 compose.Graph 把三步钉死，只有模型调用本身留给外部服务。
func Run(ctx context.Context, req Request) (*Result, error) {
	cfg, err := Load()
	if err != nil {
		return nil, err
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Article) == "" {
		return nil, errors.New("正文为空，无法生成封面")
	}
	size, format, err := normalizeSize(req.Width, req.Height, req.Format)
	if err != nil {
		return nil, err
	}

	cm, err := openai.NewChatModel(ctx, &openai.ChatModelConfig{
		BaseURL: cfg.LLM.BaseURL,
		APIKey:  cfg.LLM.APIKey,
		Model:   cfg.LLM.Model,
		Timeout: chatTimeout,
	})
	if err != nil {
		return nil, fmt.Errorf("初始化文本模型失败: %w", err)
	}
	article := truncate(req.Article, cfg.LLM.ContextLength)

	r, err := compileGraph(ctx, cfg, cm, req, size, format)
	if err != nil {
		return nil, err
	}
	return r.Invoke(ctx, article)
}

// chatGenerator 只用到 ChatModel 的 Generate，收窄接口便于测试时不联网。
type chatGenerator interface {
	Generate(ctx context.Context, in []*schema.Message, opts ...model.Option) (*schema.Message, error)
}

// compileGraph 组装固定工作流：正文 → 提示词 → 图片落盘。
func compileGraph(
	ctx context.Context,
	cfg *Config,
	cm chatGenerator,
	req Request,
	size, format string,
) (compose.Runnable[string, *Result], error) {
	g := compose.NewGraph[string, *Result]()
	_ = g.AddLambdaNode("messages", compose.InvokableLambda(
		func(_ context.Context, body string) ([]*schema.Message, error) {
			return []*schema.Message{
				schema.SystemMessage(cfg.LLM.SystemPrompt),
				schema.UserMessage(body),
			}, nil
		}))
	_ = g.AddLambdaNode("prompt", compose.InvokableLambda(
		func(c context.Context, msgs []*schema.Message) (string, error) {
			msg, err := withRetry(c, func() (*schema.Message, error) { return cm.Generate(c, msgs) })
			if err != nil {
				return "", fmt.Errorf("文本模型调用失败: %w", err)
			}
			prompt := cleanPrompt(msg.Content)
			if prompt == "" {
				return "", errors.New("文本模型没有返回可用的生图提示词")
			}
			return prompt, nil
		}))
	_ = g.AddLambdaNode("image", compose.InvokableLambda(
		func(c context.Context, prompt string) (*Result, error) {
			// 把封面尺寸附在 LLM 的提示词后面，让模型按这个画幅构图
			sent := prompt + sizeSuffix(req.Width, req.Height)
			b64, err := generateImage(c, cfg.Image, sent, size, format)
			if err != nil {
				return nil, fmt.Errorf("生图失败: %w", err)
			}
			path, err := saveCover(req.CoverID, format, b64)
			if err != nil {
				return nil, err
			}
			return &Result{Path: path, Prompt: sent}, nil
		}))
	_ = g.AddEdge(compose.START, "messages")
	_ = g.AddEdge("messages", "prompt")
	_ = g.AddEdge("prompt", "image")
	_ = g.AddEdge("image", compose.END)

	r, err := g.Compile(ctx)
	if err != nil {
		return nil, fmt.Errorf("编译生成工作流失败: %w", err)
	}
	return r, nil
}

// sizeSuffix 附在 LLM 提示词之后，让模型按封面的画幅构图。顺序是「宽x高」。
func sizeSuffix(width, height int) string {
	return fmt.Sprintf("\n尺寸为%dx%d。", width, height)
}

// truncate 把正文压到上下文预算内。
//
// shortcut: 按「1 字 ≈ 1 token」估算，不引入 tokenizer；留 500 字给系统提示词。
func truncate(s string, limit int) string {
	if limit <= 0 {
		limit = 8000
	}
	budget := limit - 500
	if budget < 500 {
		budget = 500
	}
	r := []rune(strings.TrimSpace(s))
	if len(r) <= budget {
		return string(r)
	}
	return string(r[:budget]) + "\n\n（正文过长，以上为节选）"
}

// cleanPrompt 去掉模型常见的包装：代码围栏、「提示词：」前缀、包裹引号。
func cleanPrompt(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			s = s[i+1:]
		}
	}
	s = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), "```"))
	for _, prefix := range []string{"提示词：", "提示词:", "Prompt:", "prompt:"} {
		s = strings.TrimSpace(strings.TrimPrefix(s, prefix))
	}
	return strings.TrimSpace(strings.Trim(s, "\"'“”‘’`"))
}
