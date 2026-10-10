import { zipSync, strToU8 } from 'fflate'
export function docx(body: string, extras: Record<string, Uint8Array> = {}) {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    ),
    ...extras,
  })
}
export function pdf(pages: (string | null)[], encrypted = false) {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const kids: string[] = []
  for (const text of pages) {
    const page = objects.length + 1,
      stream = text ? `BT /F1 14 Tf 50 700 Td (${text}) Tj ET` : ''
    kids.push(`${page} 0 R`)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    )
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`
  if (encrypted)
    objects.push(
      '<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <' +
        '00'.repeat(32) +
        '> /U <' +
        '00'.repeat(32) +
        '> >>',
    )
  let output = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(output))
    output += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(output)
  output +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${encrypted ? `/Encrypt ${objects.length} 0 R /ID [<00112233445566778899aabbccddeeff00><00112233445566778899aabbccddeeff00>]` : ''} >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(output)
}
