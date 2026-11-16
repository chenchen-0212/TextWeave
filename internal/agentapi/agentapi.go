// Package agentapi 暴露一个只监听 127.0.0.1 的本地控制口，供外部 agent 操作本应用。
//
// 设计约束（对应 D-02：Go 只做文件与进程，渲染留在前端）：
//  1. 渲染类能力不在这里实现 —— 控制口只把命令转成前端事件，由界面自己执行；
//  2. Go 与前端之间用「事件 + 回执」同步：请求带 id 发出去，前端处理完调
//     App.AgentReply(id, payload) 回执，HTTP 请求才返回，调用方拿到的是真实结果；
//  3. 只绑定回环地址 + 每次启动生成随机令牌，令牌写进 configDir/agent.json，
//     外部 agent 读那个文件即可发现端口与令牌；
//  4. 启动失败不影响应用本体（与 pyexec 通道同策略）。
package agentapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// EventName 是 Go → 前端下发指令的事件名，需与前端一致。
const EventName = "textweave:agent"

// InfoFile 是发现文件：外部 agent 读取它获得端口与令牌。
const InfoFile = "agent.json"

// 单条请求的等待上限。超时说明窗口没响应（最小化、WebView 卡住、或前端未装桥接）。
const callTimeout = 15 * time.Second

// ErrNotStarted 表示控制口没有成功启动。
var ErrNotStarted = errors.New("agent 控制口未启动")

// Info 写入 configDir/agent.json，供外部程序发现。
type Info struct {
	Version   string `json:"version"`
	Port      int    `json:"port"`
	URL       string `json:"url"`
	Token     string `json:"token"`
	PID       int    `json:"pid"`
	StartedAt int64  `json:"startedAt"`
}

// request 是下发给前端的指令信封。
type request struct {
	ID   string          `json:"id"`
	Op   string          `json:"op"`
	Args json.RawMessage `json:"args"`
}

type reply struct {
	Data json.RawMessage
	Err  string
}

// Server 是控制口实例。
type Server struct {
	version string
	token   string
	port    int
	infoDir string
	emit    func(event string, data any)
	srv     *http.Server

	mu      sync.Mutex
	waiters map[string]chan reply
	seq     int
}

// Start 在随机回环端口上启动控制口，并写出发现文件。
// emit 用于把指令推给前端（Wails 的 runtime.EventsEmit）。
func Start(infoDir, version string, emit func(event string, data any)) (*Server, error) {
	if emit == nil {
		return nil, fmt.Errorf("缺少事件通道")
	}
	token, err := randomToken()
	if err != nil {
		return nil, err
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("监听本地端口失败: %w", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	s := &Server{
		version: version,
		token:   token,
		port:    port,
		infoDir: infoDir,
		emit:    emit,
		waiters: make(map[string]chan reply),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	mux.HandleFunc("/tools", s.auth(s.handleTools))
	mux.HandleFunc("/queue/tasks", s.forward("queue.list", "queue.add"))
	mux.HandleFunc("/queue/style", s.forward("", "queue.setStyle"))
	mux.HandleFunc("/queue/remove", s.forward("", "queue.remove"))
	mux.HandleFunc("/queue/export", s.forward("", "queue.export"))
	mux.HandleFunc("/config", s.forward("config.get", "config.patch"))

	s.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = s.srv.Serve(ln) }()

	if err := s.writeInfo(); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

// URL 返回控制口根地址。
func (s *Server) URL() string { return fmt.Sprintf("http://127.0.0.1:%d", s.port) }

// Token 返回本次启动的访问令牌。
func (s *Server) Token() string { return s.token }

// Respond 由 App.AgentReply 调用，把前端处理结果交回等待中的 HTTP 请求。
func (s *Server) Respond(id, payload string) {
	s.mu.Lock()
	ch, ok := s.waiters[id]
	if ok {
		delete(s.waiters, id)
	}
	s.mu.Unlock()
	if !ok {
		return
	}

	if json.Valid([]byte(payload)) {
		ch <- reply{Data: json.RawMessage(payload)}
		return
	}
	wrapped, _ := json.Marshal(map[string]string{"result": payload})
	ch <- reply{Data: wrapped}
}

// Close 关闭监听并删除发现文件，避免留下过期端口误导外部程序。
func (s *Server) Close() {
	if s.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = s.srv.Shutdown(ctx)
		cancel()
	}
	if s.infoDir != "" {
		_ = os.Remove(filepath.Join(s.infoDir, InfoFile))
	}
}

// ---------------------------------------------------------------- 内部

func randomToken() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("生成令牌失败: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

func (s *Server) writeInfo() error {
	if s.infoDir == "" {
		return nil
	}
	info := Info{
		Version:   s.version,
		Port:      s.port,
		URL:       s.URL(),
		Token:     s.token,
		PID:       os.Getpid(),
		StartedAt: time.Now().Unix(),
	}
	raw, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	// 令牌只对同机用户有意义，权限收到 0600
	return os.WriteFile(filepath.Join(s.infoDir, InfoFile), raw, 0o600)
}

// call 把指令交给前端并等待回执。
func (s *Server) call(op string, args any) (json.RawMessage, error) {
	rawArgs, err := json.Marshal(args)
	if err != nil {
		return nil, fmt.Errorf("参数序列化失败: %w", err)
	}

	s.mu.Lock()
	s.seq++
	id := fmt.Sprintf("req-%d-%d", time.Now().UnixNano(), s.seq)
	ch := make(chan reply, 1)
	s.waiters[id] = ch
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.waiters, id)
		s.mu.Unlock()
	}()

	s.emit(EventName, request{ID: id, Op: op, Args: rawArgs})

	select {
	case r := <-ch:
		if r.Err != "" {
			return nil, errors.New(r.Err)
		}
		return r.Data, nil
	case <-time.After(callTimeout):
		return nil, fmt.Errorf("应用窗口在 %s 内没有响应，请确认应用已打开且未最小化", callTimeout)
	}
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+s.token {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"ok":    false,
				"error": "缺少或错误的令牌：请在请求头带 Authorization: Bearer <agent.json 里的 token>",
			})
			return
		}
		next(w, r)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	// 不带令牌也能探活：只返回版本，不泄漏任何数据
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": s.version})
}

func (s *Server) handleTools(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"ops": []map[string]any{
			{
				"op":     "queue.add",
				"method": "POST",
				"path":   "/queue/tasks",
				"args": map[string]any{
					"tasks": "数组，每项 {name?, path?, text?, bgPath?}；path 为本机 txt 绝对路径，name 缺省取文件名",
				},
				"returns": "{ok, added:[{id,name,chars}], failed:[{path,error}]}",
			},
			{
				"op":      "queue.list",
				"method":  "GET",
				"path":    "/queue/tasks",
				"returns": "{ok, tasks:[{id,name,enabled,chars,status,hasStyle,canvas,maskType,maskColor}]}",
			},
			{
				"op":     "queue.setStyle",
				"method": "POST",
				"path":   "/queue/style",
				"args": map[string]any{
					"id":    "任务 id（queue.list 返回的 id）",
					"patch": "局部配置，深合并到该任务的样式快照后经 sanitizeConfig 夹取",
				},
				"returns": "{ok, id, config}",
			},
			{
				"op":     "queue.remove",
				"method": "POST",
				"path":   "/queue/remove",
				"args":   map[string]any{"id": "任务 id"},
				"returns": "{ok, removed, tasks}（删除不可撤销）",
			},
			{
				"op":     "queue.export",
				"method": "POST",
				"path":   "/queue/export",
				"args":   map[string]any{"ids": "要导出的任务 id 数组；省略则导出全部启用任务"},
				"returns": "{ok, started}（后台执行，用 GET /queue/tasks 轮询 status 到 done/failed）",
			},
			{
				"op":      "config.get",
				"method":  "GET",
				"path":    "/config",
				"returns": "{ok, config}（净化后的完整配置）",
			},
			{
				"op":     "config.patch",
				"method": "POST",
				"path":   "/config",
				"args": map[string]any{
					"patch": "局部配置，深合并到当前配置后经 sanitizeConfig 夹取；只写要改的字段即可",
				},
				"returns": "{ok, config}，并在界面状态栏提示「外部 agent 修改了配置」",
			},
		},
		"notes": "所有 patch 都是深合并，未提及的字段保持不变；非法值会被夹取或丢弃，以返回的 config 为准。",
	})
}

// forward 把 HTTP 请求转成前端指令：GET 走 getOp，POST 走 postOp 并把请求体当参数。
// GET 请求的 op 为空时（只允许写入的资源）返回 405。
func (s *Server) forward(getOp, postOp string) http.HandlerFunc {
	return s.auth(func(w http.ResponseWriter, r *http.Request) {
		var op string
		var args any

		switch r.Method {
		case http.MethodGet:
			op = getOp
		case http.MethodPost:
			op = postOp
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "只支持 GET / POST"})
			return
		}
		if op == "" {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "该资源只支持 POST"})
			return
		}

		if r.Method == http.MethodPost {
			body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "读取请求体失败"})
				return
			}
			if len(body) > 0 && !json.Valid(body) {
				writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "请求体不是合法 JSON"})
				return
			}
			if len(body) > 0 {
				args = json.RawMessage(body)
			}
		}

		data, err := s.call(op, args)
		if err != nil {
			writeJSON(w, http.StatusGatewayTimeout, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeRaw(w, data)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeRaw(w http.ResponseWriter, data json.RawMessage) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
