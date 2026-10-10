import { expect, it } from 'vitest'
import { parseIsolated } from '../../packages/core/src/parsers/process.js'
import { validateEvidence } from '../../packages/core/src/evidence.js'
import { docx, pdf } from '../helpers/documents.js'
const parse = (name: string, bytes: Uint8Array, options = {}) =>
  parseIsolated({ snapshotId: 'snap', name, bytes, encoding: 'utf-8', ...options })
it('text retains Chinese, emoji and real line locators; invalid quotes are rejected by code points', async () => {
  const result = await parse(
    '文字.md',
    Buffer.from('第一行\n你好😀世界\n<script>alert(1)</script>'),
  )
  expect(result.status).toBe('complete')
  const block = result.blocks.find((b: any) => b.text.includes('😀'))!
  expect(block.locator.kind).toBe('lines')
  expect(block.locator).toMatchObject({ kind: 'lines', startLine: 2 })
  expect(
    validateEvidence(
      { snapshotId: 'snap', blockId: block.id, start: 2, end: 3, quote: '😀' },
      result.blocks,
    ).valid,
  ).toBe(true)
  expect(
    validateEvidence(
      { snapshotId: 'snap', blockId: block.id, start: 2, end: 4, quote: '😀' },
      result.blocks,
    ).valid,
  ).toBe(false)
  expect(
    validateEvidence(
      { snapshotId: 'other', blockId: block.id, start: 2, end: 3, quote: '😀' },
      result.blocks,
    ).valid,
  ).toBe(false)
})
it('invalid UTF8 is a visible encoding failure, with explicit UTF16LE support', async () => {
  expect((await parse('bad.txt', new Uint8Array([0xff, 0xff]))).status).toBe('failed')
  expect(
    (await parse('utf16.txt', Buffer.from('中文😀', 'utf16le'), { encoding: 'utf-16le' }))
      .blocks[0].text,
  ).toBe('中文😀')
})
it('200001 code points become a visible gap, not a truncated success; blocks stay bounded', async () => {
  const result = await parse('long.txt', Buffer.from('😀'.repeat(200001)))
  expect(result.status).toBe('partial')
  expect(result.gaps.some((g: any) => g.code === 'TEXT_LIMIT')).toBe(true)
  expect(result.blocks.reduce((n: number, b: any) => n + Array.from(b.text).length, 0)).toBe(
    200000,
  )
  expect(result.blocks.every((b: any) => Array.from(b.text).length <= 6000)).toBe(true)
})
it('DOCX produces body paragraph and table cell anchors; embedded images remain a visible gap', async () => {
  const result = await parse(
    '活动.docx',
    docx(
      '<w:p><w:r><w:t>正文😀</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>预算</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
      { 'word/media/image1.png': new Uint8Array([1, 2]) },
    ),
  )
  expect(result.blocks[0].text).toBe('正文😀')
  expect(result.blocks[0].locator).toMatchObject({ kind: 'paragraph', paragraph: 1 })
  expect(result.blocks[1].text).toBe('预算')
  expect(result.blocks[1].locator).toMatchObject({ kind: 'cell', table: 1, row: 1, column: 1 })
  expect(result.status).toBe('partial')
  expect(result.gaps.some((g: any) => g.code === 'DOCX_UNCOVERED')).toBe(true)
})
it('PDF exposes actual page numbers and scanned/empty pages as missing coverage', async () => {
  const result = await parse('pages.pdf', pdf(['First page', null, 'Third page']))
  expect(result.blocks.map((b: any) => b.locator.page)).toEqual([1, 3])
  expect(result.gaps.some((g: any) => g.page === 2 && g.code === 'PDF_NO_TEXT')).toBe(true)
  expect(result.status).toBe('partial')
})
it('DOCX cell paragraphs keep their boundaries and nested tables report incomplete coverage', async () => {
  const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
  const result = await parse(
    '数字.docx',
    docx(`<w:tbl><w:tr><w:tc>${paragraph('100')}${paragraph('200')}</w:tc></w:tr></w:tbl>`),
  )
  expect(result.status).toBe('complete')
  expect(result.blocks[0].text).toBe('100\n200')
  expect(result.blocks[0].locator).toMatchObject({ kind: 'cell', table: 1, row: 1, column: 1 })
  const nested = await parse(
    '嵌套.docx',
    docx(
      `<w:tbl><w:tr><w:tc>${paragraph('外层')}<w:tbl><w:tr><w:tc>${paragraph('内层')}</w:tc></w:tr></w:tbl>${paragraph('末尾')}</w:tc></w:tr></w:tbl>`,
    ),
  )
  expect(nested.status).toBe('partial')
  expect(nested.gaps.some((gap) => gap.code === 'DOCX_UNCOVERED')).toBe(true)
  expect(nested.blocks[0].text).toBe('外层\n末尾')
})
it('PDF page limits, encrypted documents and corrupt ZIPs fail visibly', async () => {
  expect(
    (await parse('long.pdf', pdf(Array(101).fill('text')))).gaps.some(
      (g: any) => g.code === 'PDF_PAGE_LIMIT',
    ),
  ).toBe(true)
  expect(
    (await parse('locked.pdf', pdf(['secret'], true))).gaps.some(
      (g: any) => g.code === 'PDF_ENCRYPTED',
    ),
  ).toBe(true)
  expect((await parse('bad.docx', Buffer.from('notzip'))).status).toBe('failed')
})
it('parser timeout terminates its subprocess before reporting failure', async () => {
  const result = await parse('slow.pdf', pdf(['text']), { timeoutMs: 1 })
  expect(result.status).toBe('failed')
  expect(result.gaps[0].code).toBe('PARSE_TIMEOUT')
})
it('DOCX rejects oversized expanded archives before allocating their content', async () => {
  const result = await parse(
    'bomb.docx',
    docx('<w:p><w:r><w:t>hello</w:t></w:r></w:p>', {
      'word/media/large.bin': new Uint8Array(51 * 1024 * 1024),
    }),
  )
  expect(result.status).toBe('failed')
  expect(result.gaps[0]?.code).toBe('PARSE_INVALID')
})
it('renamed macro containers are rejected', async () => {
  const macro = await parse(
    'renamed.docx',
    docx('<w:p><w:r><w:t>text</w:t></w:r></w:p>', {
      'word/vbaProject.bin': new Uint8Array([1]),
    }),
  )
  expect(macro.status).toBe('failed')
})
it('huge line counts have a visible block limit', async () => {
  const many = await parse('many.txt', Buffer.from('一行\n'.repeat(3000)))
  expect(many.status).toBe('partial')
  expect(many.blocks.length).toBeLessThanOrEqual(2000)
  expect(many.gaps.some((g) => g.code === 'BLOCK_LIMIT')).toBe(true)
})
it('spawn failure settles without leaving a permanently active parse', async () => {
  const original = process.execPath
  let pending: ReturnType<typeof parseIsolated>
  try {
    process.execPath = '/nonexistent/shouwei-node'
    pending = parse('x.txt', Buffer.from('x'), { timeoutMs: 50 })
  } finally {
    process.execPath = original
  }
  const result = await Promise.race([
    pending!,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
  ])
  expect(result).not.toBe(null)
  expect(result?.status).toBe('failed')
})
