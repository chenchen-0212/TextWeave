package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

// appOptions 构造 Wails 的运行参数。
//
// 单独抽成函数（而不是写在 main 里）是为了让它可被单元测试覆盖 ——
// DragAndDrop 这类开关一旦漏配，表现只是「某个功能静默失效」，
// 编译和启动都不会报错，只能靠测试守住。
func appOptions(app *App) *options.App {
	return &options.App{
		Title:            "文织 TextWeave",
		Width:            1480,
		Height:           940,
		MinWidth:         1180,
		MinHeight:        720,
		DisableResize:    false,
		Fullscreen:       false,
		Frameless:        false,
		StartHidden:      false,
		BackgroundColour: &options.RGBA{R: 244, G: 245, B: 247, A: 1},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},

		// 文件拖拽导入。
		//
		// EnableFileDrop 默认为 false —— 不显式打开的话，Wails 不会注入
		// `window.wails.flags.enableWailsDragAndDrop = true`，它的拖拽处理器
		// 会在第一步就 return，前端注册的 OnFileDrop 回调永远不会被调用，
		// 表现就是「拖进去毫无反应」，而且没有任何报错。
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop: true,
		},

		// Windows 专属配置
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
			ZoomFactor:           1.0,
		},

		// macOS 专属配置
		// 不使用 FullSizeContent，保留标准标题栏：本应用顶部工具栏内容从最左侧开始，
		// 若让标题栏覆盖内容会与红绿灯按钮重叠。
		Mac: &mac.Options{
			Appearance:           mac.NSAppearanceNameAqua, // 界面为浅色主题
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			About: &mac.AboutInfo{
				Title:   "文织 TextWeave",
				Message: "长文自动切段，渲染到自有背景图，批量产出系列图文。",
			},
		},
	}
}

func main() {
	app := NewApp()

	if err := wails.Run(appOptions(app)); err != nil {
		println("Error:", err.Error())
	}
}
