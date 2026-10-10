import { extname } from 'node:path'
import { unzipSync } from 'fflate'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { ParseResult, Locator, TextEncoding } from '@shouwei/contracts'
import { hash } from '../files.js'
export interface ParseInput {
  snapshotId: string
  name: string
  bytes: Uint8Array
  encoding: TextEncoding
  maxCodePoints?: number
  timeoutMs?: number
}
export function failure(snapshotId: string, code: string, reason: string): ParseResult {
  return {
    status: 'failed',
    blocks: [],
    gaps: [{ id: `${snapshotId}:gap:1`, fileSnapshotId: snapshotId, code, reason }],
  }
}
export async function extract(input: ParseInput): Promise<ParseResult> {
  const result: ParseResult = { status: 'complete', blocks: [], gaps: [] }
  let remaining = Math.max(0, Math.min(200000, input.maxCodePoints ?? 200000))
  const gap = (code: string, reason: string, page?: number) => {
    if (result.gaps.some((g) => g.code === code && g.page === page)) return
    result.gaps.push({
      id: `${input.snapshotId}:gap:${result.gaps.length + 1}`,
      fileSnapshotId: input.snapshotId,
      code,
      reason,
      ...(page ? { page } : {}),
    })
  }
  const add = (text: string, locator: Locator) => {
    if (!text.trim()) return
    if (result.blocks.length >= 2000) {
      gap('BLOCK_LIMIT', '文字片段超过 2000 个，余下内容未覆盖，请拆分材料。')
      return
    }
    const points = Array.from(text)
    if (points.length > remaining)
      gap('TEXT_LIMIT', '项目文本超过 200000 码点，超出的内容尚未覆盖。')
    const selected = points.slice(0, remaining)
    remaining -= selected.length
    for (let start = 0; start < selected.length; start += 6000) {
      if (result.blocks.length >= 2000) {
        gap('BLOCK_LIMIT', '文字片段超过 2000 个，余下内容未覆盖，请拆分材料。')
        break
      }
      const text = selected.slice(start, start + 6000).join('')
      result.blocks.push({
        id: `${input.snapshotId}:block:${result.blocks.length + 1}`,
        fileSnapshotId: input.snapshotId,
        text,
        textHash: hash(text),
        locator: { ...locator, part: 1 + start / 6000 },
        coverage: 'extracted',
      })
    }
  }
  try {
    const ext = extname(input.name).toLowerCase()
    if (ext === '.txt' || ext === '.md') {
      let text: string
      try {
        text = new TextDecoder(input.encoding, { fatal: true }).decode(input.bytes)
      } catch {
        return failure(
          input.snapshotId,
          'TEXT_ENCODING',
          '无法按所选编码读取，请重新导入并选择正确编码。',
        )
      }
      if (text.includes('\u0000'))
        return failure(
          input.snapshotId,
          'TEXT_ENCODING',
          '材料含无法识别的文本字节，请核对编码。',
        )
      text
        .split(/\r\n|\n|\r/)
        .forEach((line, i) =>
          add(line, { kind: 'lines', startLine: i + 1, endLine: i + 1, part: 1 }),
        )
    } else if (ext === '.docx') {
      let size = 0,
        count = 0
      const zip = unzipSync(input.bytes, {
        filter: (entry) => {
          size += entry.originalSize
          count++
          if (
            size > 50 * 1024 * 1024 ||
            count > 2000 ||
            /vbaProject/i.test(entry.name) ||
            entry.name.includes('..') ||
            entry.name.startsWith('/') ||
            entry.name.includes('\\')
          )
            throw new Error('UNSAFE_ZIP')
          return entry.name === 'word/document.xml'
        },
      })
      if (!zip['word/document.xml'])
        return failure(input.snapshotId, 'DOCX_INVALID', '不是可读取的 DOCX 文档。')
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(zip['word/document.xml'])
      if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
        return failure(input.snapshotId, 'DOCX_INVALID', '文档 XML 格式无效。')
      const parser = new XMLParser({
        preserveOrder: true,
        ignoreAttributes: false,
        trimValues: false,
        parseTagValue: false,
        processEntities: true,
      })
      type XmlNode = Record<string, unknown>
      const tree = parser.parse(xml) as XmlNode[]
      const children = (node: XmlNode, key: string) =>
        (node[key] as XmlNode[] | undefined) ?? []
      const find = (nodes: XmlNode[], key: string): XmlNode[] => {
        for (const node of nodes) {
          if (key in node) return children(node, key)
          for (const [k, v] of Object.entries(node))
            if (k !== ':@' && Array.isArray(v)) {
              const found = find(v, key)
              if (found.length) return found
            }
        }
        return []
      }
      const textOf = (nodes: XmlNode[]): string =>
        nodes
          .map((n) =>
            Object.entries(n)
              .map(([k, v]) => {
                if (k === 'w:tbl') {
                  gap('DOCX_UNCOVERED', '嵌套表格尚未覆盖，请在原文件中核对。')
                  return ''
                }
                if (k === 'w:p' && Array.isArray(v)) return textOf(v) + '\n'
                return k === '#text'
                  ? String(v)
                  : k === 'w:tab'
                    ? '\t'
                    : k === 'w:br'
                      ? '\n'
                      : k === ':@' || k === 'w:instrText'
                        ? ''
                        : Array.isArray(v)
                          ? textOf(v)
                          : ''
              })
              .join(''),
          )
          .join('')
      let paragraph = 0,
        table = 0
      for (const node of find(tree, 'w:body')) {
        if ('w:p' in node)
          add(textOf(children(node, 'w:p')), {
            kind: 'paragraph',
            paragraph: ++paragraph,
            part: 1,
          })
        else if ('w:tbl' in node) {
          table++
          let row = 0
          for (const tr of children(node, 'w:tbl').filter((n) => 'w:tr' in n)) {
            row++
            let column = 0
            for (const tc of children(tr, 'w:tr').filter((n) => 'w:tc' in n))
              add(textOf(children(tc, 'w:tc')).replace(/\n$/, ''), {
                kind: 'cell',
                table,
                row,
                column: ++column,
                part: 1,
              })
          }
        } else if (!('w:sectPr' in node))
          gap('DOCX_UNCOVERED', '文档含正文与普通表格之外的结构，尚未覆盖。')
      }
      // Inspect archive entries without inflating unneeded media or external links.
      unzipSync(input.bytes, {
        filter: (entry) => {
          if (
            /word\/(media\/|header|footer|footnotes|endnotes|comments|vbaProject|embeddings\/)/i.test(
              entry.name,
            )
          )
            gap('DOCX_UNCOVERED', '图片、页眉页脚、批注或嵌入内容未纳入文字读取。')
          return false
        },
      })
      if (/w:(drawing|pict|txbxContent|ins|del|altChunk|fldChar|hyperlink)/.test(xml))
        gap('DOCX_UNCOVERED', '文档含图形、修订、域或链接，需在原文件中核对。')
    } else if (ext === '.pdf') {
      const task = getDocument({
        data: new Uint8Array(input.bytes),
        useSystemFonts: false,
        disableFontFace: true,
        isOffscreenCanvasSupported: false,
        verbosity: 0,
      })
      try {
        const doc = await task.promise
        if (doc.numPages > 100)
          return failure(input.snapshotId, 'PDF_PAGE_LIMIT', 'PDF 超过 100 页，请拆分后导入。')
        gap('PDF_READING_ORDER', 'PDF 仅提取文字层，阅读顺序与图形需对照原页；未执行 OCR。')
        for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
          const page = await doc.getPage(pageNo)
          const content = await page.getTextContent()
          const text = content.items
            .map((item) =>
              'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '',
            )
            .join('')
            .trim()
          if (text) add(text, { kind: 'page', page: pageNo, part: 1 })
          else gap('PDF_NO_TEXT', '此页没有可提取文字，可能是扫描页或空白页。', pageNo)
          const ops = await page.getOperatorList()
          if (
            ops.fnArray.some((op) =>
              [
                OPS.paintImageXObject,
                OPS.paintInlineImageXObject,
                OPS.paintImageMaskXObject,
              ].includes(op),
            )
          )
            gap('PDF_IMAGE', '页面含图片，图片内文字未覆盖。', pageNo)
          if ((await page.getAnnotations()).length)
            gap('PDF_ANNOTATION', '页面有批注、链接或表单，请在原文件中核对。', pageNo)
          page.cleanup()
        }
        if (await doc.getAttachments()) gap('PDF_ATTACHMENT', 'PDF 内嵌附件未解析。')
      } catch (error) {
        return failure(
          input.snapshotId,
          (error as Error).name === 'PasswordException' ? 'PDF_ENCRYPTED' : 'PDF_INVALID',
          (error as Error).name === 'PasswordException'
            ? 'PDF 已加密，请导入已解密的副本。'
            : 'PDF 无法读取，请核对文件是否损坏。',
        )
      } finally {
        await task.destroy()
      }
    } else
      return {
        status: 'unsupported',
        blocks: [],
        gaps: [
          {
            id: `${input.snapshotId}:gap:1`,
            fileSnapshotId: input.snapshotId,
            code: 'UNSUPPORTED_FILE',
            reason: '不支持此文件类型。',
          },
        ],
      }
    if (!result.blocks.length) gap('NO_TEXT', '没有提取到可定位的文字，不能用于完整内容检查。')
    result.status = result.gaps.length ? 'partial' : 'complete'
    return result
  } catch {
    return failure(
      input.snapshotId,
      'PARSE_INVALID',
      '文档损坏、结构不支持或展开体积超限，请核对原文件。',
    )
  }
}
