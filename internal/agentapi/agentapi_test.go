package agentapi

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// 守住三条安全性质：发现文件可读且带令牌、无令牌被拒、关闭后不留过期文件。
// 这三条一破，等于把「改队列」的能力开放给同机任意进程。
func TestStartGuardsTokenAndCleansUp(t *testing.T) {
	dir := t.TempDir()

	var srv *Server
	s, err := Start(dir, "test", func(_ string, data any) {
		req, ok := data.(request)
		if !ok {
			return
		}
		// 模拟前端：立刻回一条合法 JSON
		go func() { srv.Respond(req.ID, `{"ok":true,"tasks":[]}`) }()
	})
	if err != nil {
		t.Fatalf("启动失败: %v", err)
	}
	srv = s
	defer s.Close()

	raw, err := os.ReadFile(filepath.Join(dir, InfoFile))
	if err != nil {
		t.Fatalf("发现文件未写出: %v", err)
	}
	var info Info
	if err := json.Unmarshal(raw, &info); err != nil {
		t.Fatalf("发现文件不是合法 JSON: %v", err)
	}
	if info.Token == "" || info.Port == 0 || info.URL == "" {
		t.Fatalf("发现文件字段不完整: %+v", info)
	}

	// 探活不需要令牌
	resp, err := http.Get(srv.URL() + "/health")
	if err != nil {
		t.Fatalf("探活失败: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("探活应为 200，实际 %d", resp.StatusCode)
	}

	// 队列接口必须带令牌
	resp, err = http.Get(srv.URL() + "/queue/tasks")
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("无令牌应返回 401，实际 %d", resp.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodGet, srv.URL()+"/queue/tasks", nil)
	req.Header.Set("Authorization", "Bearer "+info.Token)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("带令牌请求失败: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("带令牌应返回 200，实际 %d（%s）", resp.StatusCode, body)
	}
	if !json.Valid(body) {
		t.Fatalf("回执不是 JSON: %s", body)
	}

	// 关闭后不留发现文件，避免外部程序连到死端口
	s.Close()
	if _, err := os.Stat(filepath.Join(dir, InfoFile)); !os.IsNotExist(err) {
		t.Fatalf("关闭后应删除 %s", InfoFile)
	}
}
