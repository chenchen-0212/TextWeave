//go:build windows

package pyexec

import (
	"os/exec"
	"strconv"
	"syscall"
)

// CREATE_NO_WINDOW 是「不弹出控制台黑窗」的根因解。
// HideWindow 是保险措施：某些情况下单靠它不足以抑制控制台宿主。
const createNoWindow = 0x08000000

// applyHiddenProcAttr 为子进程设置隐藏窗口属性。
func applyHiddenProcAttr(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}

// killProcessTree 结束子进程及其全部后代。
//
// context 取消只会杀掉父进程，Python 拉起的子进程会成为孤儿残留在系统里，
// 因此超时后必须再调用一次 taskkill /T /F 做整棵进程树的清理。
func killProcessTree(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := strconv.Itoa(cmd.Process.Pid)

	// 先温和结束父进程
	_ = cmd.Process.Kill()

	// 再连带清理子进程树
	kill := exec.Command("taskkill", "/T", "/F", "/PID", pid)
	kill.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
	_ = kill.Run()
}
