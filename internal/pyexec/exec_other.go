//go:build !windows

package pyexec

import (
	"os/exec"
	"syscall"
)

// applyHiddenProcAttr 在类 Unix 系统上无需特殊处理——
// 这些平台本来就不会弹控制台窗口，也无需 CREATE_NO_WINDOW 标志。
func applyHiddenProcAttr(cmd *exec.Cmd) {
	// 显式置空，保持与 Windows 实现对称
	cmd.SysProcAttr = &syscall.SysProcAttr{}
}

// killProcessTree 结束子进程。
//
// 将子进程放入独立进程组后，对进程组发送 SIGKILL 即可连带清理其派生的后代，
// 效果等价于 Windows 上的 taskkill /T。
func killProcessTree(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true

	// 负 PID 表示「整个进程组」
	pgid := cmd.Process.Pid
	if err := syscall.Kill(-pgid, syscall.SIGKILL); err != nil {
		// 进程组不存在时退回单进程结束
		_ = cmd.Process.Kill()
	}
}
