package aicover

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// stubChat 只为验证工作流能编译，不产生任何网络请求。
type stubChat struct{ reply string }

func (s stubChat) Generate(_ context.Context, _ []*schema.Message, _ ...model.Option) (*schema.Message, error) {
	return schema.AssistantMessage(s.reply, nil), nil
}

func TestCompileGraph(t *testing.T) {
	cfg := &Config{}
	cfg.normalize()
	_, err := compileGraph(
		context.Background(), cfg, stubChat{reply: "一座雪山"},
		Request{CoverID: "cover-1", Width: 1080, Height: 1920}, "1080x1920", "png",
	)
	if err != nil {
		t.Fatalf("工作流应能编译: %v", err)
	}
}

func TestCleanPrompt(t *testing.T) {
	cases := map[string]string{
		"```\n一座雪山\n```":              "一座雪山",
		"提示词：一座雪山":                    "一座雪山",
		`"一座雪山"`:                      "一座雪山",
		"  Prompt: a snowy mountain ": "a snowy mountain",
	}
	for in, want := range cases {
		if got := cleanPrompt(in); got != want {
			t.Fatalf("cleanPrompt(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeSize(t *testing.T) {
	size, format, err := normalizeSize(1080, 1920, "jpeg")
	if err != nil || size != "1080x1920" || format != "jpeg" {
		t.Fatalf("合法输入被拒绝: size=%q format=%q err=%v", size, format, err)
	}
	// 未知格式退回 png，避免接口收到空 output_format
	if _, format, _ := normalizeSize(1080, 1920, "bmp"); format != "png" {
		t.Fatalf("未知格式应退回 png，实际 %q", format)
	}
	if _, _, err := normalizeSize(0, 1920, "png"); err == nil {
		t.Fatal("非法尺寸应报错")
	}
}

// 提示词里的尺寸说明按「宽x高」拼，与请求体的 size 一致
func TestSizeSuffix(t *testing.T) {
	if got := sizeSuffix(1080, 1920); got != "\n尺寸为1080x1920。" {
		t.Fatalf("sizeSuffix(1080,1920) = %q", got)
	}
}

func TestRetryable(t *testing.T) {
	if retryable(&statusError{code: 401}) {
		t.Fatal("鉴权失败不应重试")
	}
	if !retryable(&statusError{code: 503}) || !retryable(&statusError{code: 429}) {
		t.Fatal("服务端故障与限流应重试")
	}
	if retryable(errors.New("参数错误")) {
		t.Fatal("普通错误不应重试")
	}
}

func TestTruncate(t *testing.T) {
	if got := truncate("短正文", 8000); got != "短正文" {
		t.Fatalf("未超预算时不应改动，实际 %q", got)
	}
	long := strings.Repeat("字", 1200)
	got := truncate(long, 1000)
	if len([]rune(got)) >= len(long) || !strings.Contains(got, "节选") {
		t.Fatal("超预算正文应被截断并标注节选")
	}
}
