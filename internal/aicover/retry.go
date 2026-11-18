package aicover

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	sdkoai "github.com/meguminnnnnnnnn/go-openai"
)

// statusError 让重试逻辑能区分「服务端暂时不可用」和「请求本身有问题」。
type statusError struct {
	code int
	body string
}

func (e *statusError) Error() string {
	body := strings.TrimSpace(e.body)
	if body == "" {
		return fmt.Sprintf("接口返回 %d", e.code)
	}
	return fmt.Sprintf("接口返回 %d：%s", e.code, body)
}

// statusRetryable：0 表示请求根本没拿到响应（断网、连接被拒），也值得重试。
func statusRetryable(code int) bool {
	return code == 0 || code == 408 || code == 429 || code >= 500
}

// retryable 判断错误是否值得重试：限流、服务端故障、断网、超时都重试；
// 鉴权失败、参数错误这类 4xx 重试多少次都一样，直接返回。
func retryable(err error) bool {
	if err == nil {
		return false
	}
	// eino 的 chat model 在非 2xx / 传输失败时返回这两个 SDK 错误类型
	var reqErr *sdkoai.RequestError
	if errors.As(err, &reqErr) {
		return statusRetryable(reqErr.HTTPStatusCode)
	}
	var apiErr *sdkoai.APIError
	if errors.As(err, &apiErr) {
		return statusRetryable(apiErr.HTTPStatusCode)
	}
	var se *statusError
	if errors.As(err, &se) {
		return statusRetryable(se.code)
	}
	var ne net.Error
	if errors.As(err, &ne) {
		return true
	}
	return errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF)
}

// withRetry 最多尝试 3 次，退避 1s / 3s。取消后立刻返回，不再等待。
func withRetry[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	var zero T
	delays := []time.Duration{time.Second, 3 * time.Second}

	for attempt := 0; ; attempt++ {
		out, err := fn()
		if err == nil {
			return out, nil
		}
		if ctx.Err() != nil {
			return zero, ctx.Err()
		}
		if attempt >= len(delays) || !retryable(err) {
			if attempt > 0 {
				return zero, fmt.Errorf("%w（已重试 %d 次）", err, attempt)
			}
			return zero, err
		}
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case <-time.After(delays[attempt]):
		}
	}
}
