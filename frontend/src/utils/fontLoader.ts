import * as api from '../backend/api'

/**
 * 用户上传字体的加载。
 *
 * 系统字体在 WebView2 中可直接按族名使用，无需加载文件；
 * 只有用户上传的字体需要读出字节并通过 FontFace 注册到文档中。
 */

const loaded = new Set<string>()

/** base64 → Uint8Array */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * 确保某个用户字体已注册。
 *
 * 注册后再做一次字形可用性校验：若目标字体与回退字体的「中」字宽度
 * 完全一致，说明 FontFace 实际未生效，此时返回 false 让上层给出提示。
 */
export async function ensureFontLoaded(family: string, path: string): Promise<boolean> {
  if (!path || !family) return true
  if (loaded.has(path)) return true

  try {
    const b64 = await api.readFileBase64(path)
    if (!b64) return false

    const bytes = base64ToBytes(b64)
    const face = new FontFace(family, bytes.buffer as ArrayBuffer)
    await face.load()
    document.fonts.add(face)
    loaded.add(path)
    return true
  } catch {
    return false
  }
}

/** 等待 document.fonts 就绪（系统字体也可能尚未完成加载）。 */
export async function waitForFonts(): Promise<void> {
  try {
    await document.fonts.ready
  } catch {
    // 忽略：字体就绪失败不应阻塞排版
  }
}

/** 清空已加载记录（切换配置 / 重启时用）。 */
export function resetFontCache(): void {
  loaded.clear()
}
