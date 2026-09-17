/** 二进制与 base64 的互转工具。 */

/** base64 字符串 → Uint8Array */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** base64 字符串 → Blob */
export function base64ToBlob(b64: string, mime: string): Blob {
  // TS 5.7 起 TypedArray 带 ArrayBufferLike 泛型参数，与 BlobPart 的
  // ArrayBufferView<ArrayBuffer> 不兼容，这里显式收窄一次。
  const part = base64ToBytes(b64) as unknown as BlobPart
  return new Blob([part], { type: mime || 'application/octet-stream' })
}

/** Uint8Array → base64 字符串 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[],
    )
  }
  return btoa(binary)
}

/** 把字节数格式化为易读的字符串。 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
