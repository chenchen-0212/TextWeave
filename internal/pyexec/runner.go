// Package pyexec 封装 Python 子进程通道。
//
// 设计原则（对应产品方案 5.10）：
//  1. 绝不通过 cmd.exe / powershell 包裹命令，直接以完整路径启动 python 可执行文件；
//  2. stdout 只承载 JSON 协议数据，日志一律走 stderr；
//  3. 超时必须连带清理整个进程树；
//  4. Python 缺失时返回明确错误，核心渲染链路不受影响。
//
// 当前版本该通道不承载核心功能，仅作为后续图像分析 / AI 能力的预留扩展位。
package pyexec

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ErrNoPython 表示本机未探测到可用的 Python 解释器。
var ErrNoPython = errors.New("未检测到 Python 环境，该增强功能不可用（核心功能不受影响）")

// Envelope 是传给脚本的请求信封。
type Envelope struct {
	Script string          `json:"script"`
	Args   json.RawMessage `json:"args"`
}

// Result 是脚本的响应。
type Result struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error string          `json:"error"`
}

// Status 描述通道可用性，供前端展示。
type Status struct {
	Available bool   `json:"available"`
	Python    string `json:"python"`
	Version   string `json:"version"`
	ScriptDir string `json:"scriptDir"`
	Message   string `json:"message"`
}

// Runner 负责按需启动 Python 子进程。
type Runner struct {
	PythonPath string
	ScriptDir  string
	Timeout    time.Duration
}

// New 构造 Runner。ScriptDir 为空时使用可执行文件同级的 pyscripts 目录。
func New(scriptDir string) *Runner {
	if scriptDir == "" {
		if exe, err := os.Executable(); err == nil {
			scriptDir = filepath.Join(filepath.Dir(exe), "pyscripts")
		}
	}
	return &Runner{
		PythonPath: Detect(),
		ScriptDir:  scriptDir,
		Timeout:    60 * time.Second,
	}
}

// pythonCandidates 返回按优先级排列的解释器探测路径。
func pythonCandidates() []string {
	var out []string

	// 1. 环境变量显式指定
	if v := strings.TrimSpace(os.Getenv("TEXTWEAVE_PYTHON")); v != "" {
		out = append(out, v)
	}

	// 2. 随应用分发的内嵌运行时
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		out = append(out,
			filepath.Join(dir, "python", "python.exe"),
			filepath.Join(dir, "python", "bin", "python3"),
		)
	}

	// 3. 系统 PATH
	out = append(out, "python3", "python")

	return out
}

// Detect 探测可用的 Python 解释器，返回完整路径或空字符串。
func Detect() string {
	for _, c := range pythonCandidates() {
		if c == "python" || c == "python3" {
			if p, err := exec.LookPath(c); err == nil {
				return p
			}
			continue
		}
		if strings.ContainsAny(c, `\/`) {
			if st, err := os.Stat(c); err == nil && !st.IsDir() {
				return c
			}
		} else if p, err := exec.LookPath(c); err == nil {
			return p
		}
	}

	// 4. Windows 的 py 启动器（放在最后，因为它需要额外参数）
	if p, err := exec.LookPath("py"); err == nil {
		return p
	}
	return ""
}

// GetStatus 返回通道状态。
func (r *Runner) GetStatus() Status {
	st := Status{ScriptDir: r.ScriptDir}
	py := r.PythonPath
	if py == "" {
		py = Detect()
	}
	if py == "" {
		st.Message = ErrNoPython.Error()
		return st
	}
	st.Python = py
	st.Available = true

	if ver, err := interpreterVersion(py); err == nil {
		st.Version = ver
	}
	return st
}

// interpreterVersion 通过一次极短的子进程调用获取解释器版本号。
func interpreterVersion(py string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var stdout bytes.Buffer
	cmd := exec.CommandContext(ctx, py, "-c", "import sys;sys.stdout.write(sys.version.split()[0])")
	cmd.Stdout = &stdout
	applyHiddenProcAttr(cmd)

	if err := cmd.Run(); err != nil {
		return "", err
	}
	return strings.TrimSpace(stdout.String()), nil
}

// validateScriptName 拒绝任何带路径分隔符的脚本名，防止越权调用任意脚本。
func validateScriptName(name string) error {
	if name == "" {
		return fmt.Errorf("脚本名不能为空")
	}
	if strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
		return fmt.Errorf("脚本名不合法: %s", name)
	}
	if !strings.HasSuffix(strings.ToLower(name), ".py") {
		return fmt.Errorf("脚本必须是 .py 文件: %s", name)
	}
	return nil
}

// Run 执行脚本并返回结果。args 会被序列化为 JSON 通过 stdin 传入。
func (r *Runner) Run(parent context.Context, script string, args any) (*Result, error) {
	py := r.PythonPath
	if py == "" {
		py = Detect()
	}
	if py == "" {
		return nil, ErrNoPython
	}
	if err := validateScriptName(script); err != nil {
		return nil, err
	}

	scriptPath := filepath.Join(r.ScriptDir, script)
	if st, err := os.Stat(scriptPath); err != nil || st.IsDir() {
		return nil, fmt.Errorf("脚本不存在: %s", scriptPath)
	}

	timeout := r.Timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	var rawArgs json.RawMessage
	if args == nil {
		rawArgs = json.RawMessage("null")
	} else {
		b, err := json.Marshal(args)
		if err != nil {
			return nil, fmt.Errorf("参数序列化失败: %w", err)
		}
		rawArgs = b
	}
	payload, err := json.Marshal(Envelope{Script: script, Args: rawArgs})
	if err != nil {
		return nil, fmt.Errorf("请求序列化失败: %w", err)
	}

	var stdout, stderr bytes.Buffer
	// 关键：直接启动解释器，不经由任何 shell 包裹
	cmd := exec.Command(py, scriptPath)
	cmd.Dir = r.ScriptDir
	cmd.Stdin = bytes.NewReader(payload)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	applyHiddenProcAttr(cmd)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("启动 Python 失败: %w", err)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	select {
	case err := <-done:
		if err != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg != "" {
				return nil, fmt.Errorf("Python 执行失败: %v（stderr: %s）", err, msg)
			}
			return nil, fmt.Errorf("Python 执行失败: %w", err)
		}
	case <-ctx.Done():
		killProcessTree(cmd)
		<-done
		return nil, fmt.Errorf("Python 脚本执行超时（%s），已终止进程", timeout)
	}

	var res Result
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &res); err != nil {
		msg := strings.TrimSpace(stderr.String())
		return nil, fmt.Errorf("协议解析失败（stdout 不是合法 JSON）: %v；stderr: %s", err, msg)
	}
	if !res.OK && res.Error != "" {
		return &res, fmt.Errorf("脚本返回错误: %s", res.Error)
	}
	return &res, nil
}
