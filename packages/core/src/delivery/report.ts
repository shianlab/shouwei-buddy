import type { DeliveryRecord } from '@shouwei/contracts'
export const htmlEscape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const csv = (s: string) =>
  '"' + (/^[\s]*[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"'
export function deliveryDocuments(record: DeliveryRecord) {
  const risks = record.assessment.risks
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.reason}`)
    .join('\n\n')
  const note = `# ${record.projectName} · 交付说明\n\n收件人：${record.recipient || '未填写'}\n\n${record.note}\n\n附件共 ${record.files.length} 份。\n\n${risks ? '本次包含已接受风险，详见独立的「风险说明.md」。' : '本次没有已接受风险。'}\n`
  const riskNote = `# 本次交付的风险说明\n\n${risks || '没有已接受风险。'}\n\n本清单由已确认的处理记录生成，独立保留于材料包内。\n`
  const manifest = JSON.stringify(
    {
      schemaVersion: 1,
      deliveryId: record.id,
      projectName: record.projectName,
      runId: record.runId,
      inputHash: record.inputHash,
      createdAt: record.createdAt,
      conclusion: record.assessment.conclusion,
      risks: record.assessment.risks,
      files: record.files,
    },
    null,
    2,
  )
  const list =
    '\uFEFF文件名,版本,字节,SHA256\r\n' +
    record.files
      .map((f) => [f.name, String(f.version), String(f.bytes), f.sha256].map(csv).join(','))
      .join('\r\n')
  const e = htmlEscape,
    run = record.frozen.workflow.runs.find((r) => r.id === record.runId)
  const report = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(record.projectName)} · 内部检查报告</title><style>body{max-width:860px;margin:48px auto;padding:0 24px;font:16px/1.8 system-ui;color:#304b3c;background:#fafbf6}h1{font-size:28px}section{margin:28px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin:12px 0}small{color:#64746a}</style><h1>${e(record.projectName)} · 内部检查报告</h1><p>供自己留存；未放入收件人 ZIP。此记录冻结于 ${e(record.createdAt)}。</p><p>模型：${e(run?.model.displayName ?? '未知')} / ${e(run?.model.modelId ?? '未知')}；结论：${e(record.assessment.conclusion)}</p><section><h2>交付附件</h2><ul>${record.files.map((f) => `<li>${e(f.name)} · v${f.version}<br><small>${e(f.sha256)}</small></li>`).join('')}</ul></section><section><h2>确认的要求</h2><ul>${record.frozen.workflow.requirements.map((r) => `<li>${e(r.text)} · ${e(r.applicability)}${r.reason ? ' · ' + e(r.reason) : ''}</li>`).join('')}</ul></section><section><h2>核对范围</h2><ul>${record.frozen.material.files
    .filter((f) => run?.selectedSnapshotIds.includes(f.id))
    .map((f) => `<li>${e(f.originalName)} · v${f.version} · ${e(f.role)}</li>`)
    .join(
      '',
    )}</ul><p>${e(run?.gaps.join('；') || '无技术范围缺口。')}</p></section><section><h2>问题与处理</h2>${record.frozen.findings.map((f) => `<h3>${e(f.title)} · ${e(f.reviewState)}</h3><p>${e(f.explanation)}</p>${f.evidence.map((ref) => `<blockquote>${e(ref.quote)}</blockquote>`).join('')}<p>${e(record.frozen.workflow.decisions.findLast((d) => d.fingerprint === f.fingerprint && d.inputHash === record.inputHash)?.reason ?? '')}</p>`).join('') || '<p>没有有效问题候选。</p>'}</section><section><h2>独立对外风险</h2><pre>${e(risks || '无')}</pre></section><section><h2>交付文字</h2><pre>${e(record.note)}</pre></section><p>原文件保持不变。本报告不替代收件人或负责人的最终确认。</p></html>`
  return { note, riskNote, manifest, list, report }
}
