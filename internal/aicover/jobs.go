package aicover

import (
	"context"
	"sync"
	"time"
)

// JobTimeout 是单次生成的总时限：包含两次模型调用的全部重试。
const JobTimeout = 5 * time.Minute

var (
	jobsMu sync.Mutex
	jobs   = map[string]context.CancelFunc{}
)

// Start 为 jobID 注册一个可取消的上下文。
//
// 一个封面一个 jobID（前端直接用 coverId），因此多个封面同时生成互不干扰；
// 同一 jobID 重复进入时取消上一次，避免旧请求的结果回写。
func Start(parent context.Context, jobID string) (context.Context, func()) {
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, JobTimeout)

	jobsMu.Lock()
	if prev, ok := jobs[jobID]; ok {
		prev()
	}
	jobs[jobID] = cancel
	jobsMu.Unlock()

	return ctx, func() {
		jobsMu.Lock()
		delete(jobs, jobID)
		jobsMu.Unlock()
		cancel()
	}
}

// Cancel 取消指定 job。已结束或不存在时什么都不做。
func Cancel(jobID string) {
	jobsMu.Lock()
	cancel := jobs[jobID]
	jobsMu.Unlock()
	if cancel != nil {
		cancel()
	}
}
