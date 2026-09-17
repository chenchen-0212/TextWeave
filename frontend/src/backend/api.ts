/**
 * 后端绑定封装。
 *
 * 所有与 Go 的交互都收敛到这一层。
 *
 * 注意：这里**不做**「是否运行在 Wails 中」的前置判断。
 * 曾经加过 `__wailsjs__ in window` 的判断，但 Wails v2 实际注入的全局是
 * `window.runtime`，导致判断恒为 false、所有调用被静默短路，文件对话框根本
 * 不会弹出。正确做法是直接调用，让异常自然抛出并转成可读提示。
 */

import type { FontEntry, ImageInfo, PyStatus } from '../types'

import {
  AppInfo,
  ConfigDir,
  ImportFont,
  ListFonts,
  LoadConfig,
  PickFontFile,
  PickImage,
  PickOutputDir,
  PickTextFile,
  ProbeImage,
  PyRun,
  PyStatus as PyStatusBinding,
  ReadFileBase64,
  ReadTextFile,
  RemoveFont,
  RevealInFolder,
  SaveConfig,
  SaveImage,
  SaveZip,
} from '../../wailsjs/go/main/App'

import { OnFileDrop, OnFileDropOff } from '../../wailsjs/runtime/runtime'

export interface ZipEntryPayload {
  name: string
  data: string
}

/** Wails 运行时的全局挂载点 */
interface WailsWindow {
  runtime?: unknown
  go?: { main?: { App?: unknown } }
}

/** 是否运行在 Wails 容器内。仅用于界面提示，不作为调用前置条件。 */
export function isWails(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as WailsWindow
  return Boolean(w.runtime || w.go?.main?.App)
}

function describeError(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message || fallback
  const s = String(e)
  return s && s !== '[object Object]' ? s : fallback
}

// ---------------------------------------------------------------- 文件选择

/** 选择背景图。用户取消时返回空字符串。 */
export async function pickImage(): Promise<string> {
  try {
    return (await PickImage()) || ''
  } catch (e) {
    throw new Error(describeError(e, '打开图片选择对话框失败'))
  }
}

export async function pickTextFile(): Promise<string> {
  try {
    return (await PickTextFile()) || ''
  } catch (e) {
    throw new Error(describeError(e, '打开文本选择对话框失败'))
  }
}

export async function pickFontFile(): Promise<string> {
  try {
    return (await PickFontFile()) || ''
  } catch (e) {
    throw new Error(describeError(e, '打开字体选择对话框失败'))
  }
}

export async function pickOutputDir(): Promise<string> {
  try {
    return (await PickOutputDir()) || ''
  } catch (e) {
    throw new Error(describeError(e, '打开目录选择对话框失败'))
  }
}

// ---------------------------------------------------------------- 拖拽导入

/**
 * 读取 Wails 注入的拖拽总开关。
 *
 * Go 侧只有在 `DragAndDrop.EnableFileDrop` 为 true 时才会执行
 * `window.wails.flags.enableWailsDragAndDrop = true`。这个标志是判断
 * 「拖放到底能不能用」的唯一可靠依据 —— `OnFileDrop()` 的注册本身永远不会
 * 失败，所以不能拿注册结果当信号。
 */
export function isFileDropEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as {
    wails?: { flags?: { enableWailsDragAndDrop?: boolean } }
  }
  return w.wails?.flags?.enableWailsDragAndDrop === true
}

/** 轮询等待开关就绪。该标志在 navigationCompleted 时注入，可能晚于前端挂载。 */
function waitForFileDropFlag(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = (): void => {
      if (isFileDropEnabled()) {
        resolve(true)
        return
      }
      if (Date.now() - started > timeoutMs) {
        resolve(false)
        return
      }
      window.setTimeout(tick, 100)
    }
    tick()
  })
}

/**
 * 注册文件拖拽回调。
 *
 * 三个必须同时满足的条件，缺一个就「拖进去毫无反应」：
 *
 *   1. **Go 侧必须开启 `DragAndDrop.EnableFileDrop`**（见 main.go）。
 *      它默认是 false，不打开的话 Wails 注入的处理器第一步就 return，
 *      这里的回调永远不会被调用。这是最容易漏掉的一条 —— 注册不会报错，
 *      界面也没有任何异常，纯粹就是没反应。
 *
 *   2. **第二个参数必须传 false。** 它的名字叫 useDropTarget，很容易被误读成
 *      「把整个窗口设为投放目标」。实际含义是「**只在落点元素带
 *      `--wails-drop-target` 属性时才回调**」——传 true 而页面上又没标这个属性，
 *      回调同样永远不触发。
 *
 *   3. 回调能拿到鼠标坐标，调用方可用 elementFromPoint 判断用户丢在了哪个区域。
 *
 * @returns 拖放是否真的可用（以 Go 侧开关为准，不是以注册是否抛异常为准）
 */
export async function registerFileDrop(
  cb: (x: number, y: number, paths: string[]) => void,
): Promise<boolean> {
  try {
    OnFileDrop((x: number, y: number, paths: string[]) => {
      if (paths && paths.length > 0) cb(x, y, paths)
    }, false)
  } catch (e) {
    console.warn('[TextWeave] 文件拖拽注册失败，请改用「点击选择」：', e)
    return false
  }
  return waitForFileDropFlag()
}

export function unregisterFileDrop(): void {
  try {
    OnFileDropOff()
  } catch {
    // 忽略
  }
}

// ---------------------------------------------------------------- 读取

export async function readTextFile(path: string): Promise<string> {
  return ReadTextFile(path)
}

export async function readFileBase64(path: string): Promise<string> {
  return ReadFileBase64(path)
}

export async function probeImage(path: string): Promise<ImageInfo | null> {
  try {
    return (await ProbeImage(path)) as unknown as ImageInfo
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 保存

export async function saveImage(dir: string, filename: string, base64: string): Promise<string> {
  return SaveImage(dir, filename, base64)
}

export async function saveZip(
  dir: string,
  zipName: string,
  entries: ZipEntryPayload[],
): Promise<string> {
  return SaveZip(dir, zipName, entries)
}

export async function revealInFolder(path: string): Promise<void> {
  await RevealInFolder(path)
}

// ---------------------------------------------------------------- 配置

export async function loadConfig(): Promise<string> {
  try {
    return (await LoadConfig()) || ''
  } catch {
    return ''
  }
}

export async function saveConfig(raw: string): Promise<void> {
  await SaveConfig(raw)
}

export async function getConfigDir(): Promise<string> {
  try {
    return await ConfigDir()
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------- 字体

export async function listFonts(): Promise<FontEntry[]> {
  try {
    const list = (await ListFonts()) as unknown as FontEntry[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export async function importFont(src: string): Promise<FontEntry | null> {
  return (await ImportFont(src)) as unknown as FontEntry
}

export async function removeFont(path: string): Promise<void> {
  await RemoveFont(path)
}

// ---------------------------------------------------------------- Python 通道

export async function pyStatus(): Promise<PyStatus | null> {
  try {
    return (await PyStatusBinding()) as unknown as PyStatus
  } catch {
    return null
  }
}

/** 预留的 Python 增强通道调用入口。当前版本不对应任何核心功能。 */
export async function pyRun(script: string, args: unknown): Promise<unknown> {
  const payload = args === undefined || args === null ? '' : JSON.stringify(args)
  const res = (await PyRun(script, payload)) as unknown as {
    ok: boolean
    data: unknown
    error: string
  }
  if (!res.ok) throw new Error(res.error || 'Python 脚本执行失败')
  return res.data
}

// ---------------------------------------------------------------- 杂项

export async function appInfo(): Promise<Record<string, string>> {
  try {
    return (await AppInfo()) as unknown as Record<string, string>
  } catch {
    return {}
  }
}
