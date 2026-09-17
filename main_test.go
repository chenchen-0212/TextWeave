package main

import "testing"

// 这些开关漏配时不会报错，只会「静默失效」，所以必须用测试守住。
//
// 真实事故：拖拽导入背景图完全不工作是两个原因叠加 ——
//   1. DragAndDrop.EnableFileDrop 默认为 false，而我们没配；
//   2. 前端 OnFileDrop 的第二个参数传了 true，那意味着
//      「只在带 --wails-drop-target 属性的元素上才回调」，而页面上没标。
// 两者都不会抛异常，界面上也没有任何提示。

func TestFileDropIsEnabled(t *testing.T) {
	o := appOptions(NewApp())

	if o.DragAndDrop == nil {
		t.Fatal("DragAndDrop 未配置：Wails 默认关闭拖拽，前端 OnFileDrop 永远收不到回调")
	}
	if !o.DragAndDrop.EnableFileDrop {
		t.Fatal("EnableFileDrop 为 false：拖拽导入不会生效")
	}
}

func TestWindowIsUsable(t *testing.T) {
	o := appOptions(NewApp())

	if o.Title == "" {
		t.Error("窗口标题为空")
	}
	if o.Width <= 0 || o.Height <= 0 {
		t.Errorf("窗口尺寸非法：%dx%d", o.Width, o.Height)
	}
	// 三栏布局塞不下太窄的窗口，最小宽度必须留够
	if o.MinWidth < 1100 {
		t.Errorf("最小宽度 %d 过小，三栏布局会被压变形", o.MinWidth)
	}
	if o.MinWidth > o.Width || o.MinHeight > o.Height {
		t.Error("最小尺寸不得大于初始尺寸")
	}
}

func TestBindingsArePresent(t *testing.T) {
	o := appOptions(NewApp())

	if len(o.Bind) == 0 {
		t.Fatal("没有绑定任何对象，前端将无法调用后端")
	}
	if o.OnStartup == nil {
		t.Error("OnStartup 未设置：Wails 运行时的 context 不会被保存，所有需要 ctx 的对话框都会失败")
	}
	if o.AssetServer == nil || o.AssetServer.Assets == nil {
		t.Error("AssetServer 未配置：前端资源无法加载")
	}
}
