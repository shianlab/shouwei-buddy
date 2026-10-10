import type { TextBlock, Fact } from '@shouwei/contracts'
/** Deterministic HTTP fixture, never imported by the production server. */
export function checkReply(body: unknown) {
  const input = body as { messages: { role: string; content: string }[] }
  const message =
    input.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .find((m) => m.includes('待分析材料')) ?? ''
  if (message.includes('Synthetic connection probe.')) return { ok: true }
  const packed = JSON.parse(
    message.slice(message.indexOf('\n') + 1, message.lastIndexOf('\n只返回')),
  ) as string[]
  const data = JSON.parse(packed[0]!) as {
    blocks?: TextBlock[]
    requirements?: { id: string }[]
    facts?: Fact[]
    files?: { id: string; role: string }[]
  }
  const ref = (b: TextBlock) => ({
    snapshotId: b.fileSnapshotId,
    blockId: b.id,
    start: 0,
    end: Array.from(b.text).length,
    quote: b.text,
  })
  if (data.blocks && !data.requirements)
    return {
      requirements: data.blocks
        .slice(0, 1)
        .map((b) => ({
          text: '活动日期统一',
          importance: 'must',
          originKind: 'source',
          sourceEvidence: [ref(b)],
        })),
    }
  if (data.blocks)
    return {
      facts: data.blocks
        .filter((b) => /2026-10-\d{2}/.test(b.text))
        .map((b) => ({
          entityKey: '测试活动',
          field: 'date',
          value: b.text.match(/2026-10-\d{2}/)![0],
          qualifiers: '活动日期',
          isExample: false,
          evidence: [ref(b)],
        })),
      matches: [],
    }
  const facts = data.facts ?? [],
    conflict = new Set(facts.map((f) => f.value)).size > 1
  const evidence = facts.flatMap((f) => f.evidence)
  const deliverable = evidence.filter((e) =>
    data.files?.some((f) => f.id === e.snapshotId && f.role === 'deliverable'),
  )
  return {
    findings: conflict
      ? [
          {
            kind: 'fact_conflict',
            severity: 'blocker',
            title: '活动日期冲突',
            explanation: '要求与方案的活动日期不一致。',
            requirementIds: data.requirements!.map((r) => r.id),
            evidence,
          },
        ]
      : [],
    results: data.requirements!.map((r) => ({
      requirementId: r.id,
      status: conflict ? 'unmet' : 'met',
      evidence: deliverable,
    })),
  }
}
