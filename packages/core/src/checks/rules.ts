import type { Fact, FileSnapshot, FindingCandidate } from '@shouwei/contracts'
export function ruleFindings(facts: Fact[], files: FileSnapshot[]): FindingCandidate[] {
  const output: FindingCandidate[] = []
  const groups = new Map<string, Fact[]>()
  for (const f of facts.filter((f) => !f.isExample)) {
    if (f.field === 'placeholder')
      output.push({
        kind: 'placeholder',
        severity: 'blocker',
        title: `${f.entityKey}仍有待填写内容`,
        explanation: `${f.qualifiers}：${f.value}`,
        requirementIds: [],
        evidence: f.evidence,
      })
    if (['date', 'location', 'amount', 'version'].includes(f.field)) {
      const key = JSON.stringify([
        f.entityKey.trim().normalize(),
        f.field,
        f.qualifiers.trim().normalize(),
      ])
      groups.set(key, [...(groups.get(key) ?? []), f])
    }
  }
  for (const group of groups.values()) {
    if (
      new Set(group.map((f) => f.value.trim())).size < 2 ||
      new Set(group.flatMap((f) => f.evidence.map((e) => e.snapshotId))).size < 2
    )
      continue
    const first = group[0]!
    output.push({
      kind: first.field === 'version' ? 'version_ambiguity' : 'fact_conflict',
      severity: first.field === 'version' ? 'attention' : 'blocker',
      title: `${first.entityKey}的${first.qualifiers || first.field}不一致`,
      explanation: group.map((f) => f.value).join(' / '),
      requirementIds: [],
      evidence: group.flatMap((f) => f.evidence).slice(0, 12),
    })
  }
  const versions = new Map<string, FileSnapshot[]>()
  for (const file of files.filter((f) => f.role === 'deliverable'))
    versions.set(file.logicalFileId, [...(versions.get(file.logicalFileId) ?? []), file])
  for (const group of versions.values())
    if (group.length > 1)
      output.push({
        kind: 'version_ambiguity',
        severity: 'attention',
        title: `${group[0]!.originalName}选中了多个版本`,
        explanation: '请在检查范围中明确保留哪一版，再重新核对。',
        requirementIds: [],
        evidence: [],
      })
  return output
}
