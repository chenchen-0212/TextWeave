/** 输出文件名模板渲染。支持 {index} {total} {title} {date} 四个变量。 */

export interface FilenameVars {
  index: number
  total: number
  title: string
  date: Date
  /** 序号补零位数 */
  pad: number
}

/** 去掉文件系统中非法的字符，并限制长度。 */
export function sanitizeFilename(name: string, maxLength = 60): string {
  const cleaned = (name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** 渲染文件名模板，返回不含扩展名的名字。 */
export function renderFilenameTemplate(template: string, vars: FilenameVars): string {
  const tpl = (template || '').trim() || '{index}'
  const index = String(vars.index).padStart(Math.max(1, vars.pad), '0')

  const out = tpl
    .replace(/\{index\}/g, index)
    .replace(/\{total\}/g, String(vars.total))
    .replace(/\{title\}/g, sanitizeFilename(vars.title, 40))
    .replace(/\{date\}/g, formatDate(vars.date))

  const safe = sanitizeFilename(out, 80)
  return safe || index
}

/** 渲染完整文件名（含扩展名）。 */
export function buildFilename(
  template: string,
  vars: FilenameVars,
  ext: string,
): string {
  const base = renderFilenameTemplate(template, vars)
  const cleanExt = ext.replace(/^\./, '')
  return `${base}.${cleanExt}`
}

/** 输出格式对应的扩展名。 */
export function extForFormat(format: string): string {
  switch (format) {
    case 'jpeg':
      return 'jpg'
    case 'webp':
      return 'webp'
    default:
      return 'png'
  }
}
