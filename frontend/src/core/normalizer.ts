/**
 * 文本规范化（渲染管线第 ① 步）。
 *
 * 目的是把各种来源的文本（网页复制、Word 粘贴、txt 文件）统一成
 * 一套可预测的输入，让后续的分段与断行结果稳定。
 */

/** 统一换行符、清理零宽字符、折叠多余空行、去除行首行尾空白。 */
export function normalizeText(raw: string): string {
  if (!raw) return ''

  let s = raw

  // 1) 统一换行符（CRLF / CR → LF）
  s = s.replace(/\r\n?/g, '\n')

  // 2) 去除零宽字符（复制粘贴常见的隐形污染源）
  s = s.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')

  // 3) 全角空格转半角（表意空格在排版里会造成难以察觉的对齐问题）
  s = s.replace(/\u3000/g, ' ')

  // 4) 去除每行行首行尾空白（含制表符）
  s = s
    .split('\n')
    .map((line) => line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''))
    .join('\n')

  // 5) 折叠三个及以上连续换行为两个（两个换行 = 一个段落边界）
  s = s.replace(/\n{3,}/g, '\n\n')

  // 6) 去掉整体首尾空白
  return s.replace(/^\n+/, '').replace(/\n+$/, '')
}

/** 判断字符串是否只包含空白字符。 */
export function isBlank(s: string): boolean {
  return s.trim().length === 0
}

/** 粗略统计正文字数（不含空白字符）。 */
export function countChars(text: string): number {
  return (text || '').replace(/\s/g, '').length
}
