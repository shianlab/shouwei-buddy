import type { EvidenceRef, EvidenceValidation, TextBlock } from '@shouwei/contracts'
export function validateEvidence(ref: EvidenceRef, blocks: TextBlock[]): EvidenceValidation {
  const block = blocks.find((b) => b.id === ref.blockId && b.fileSnapshotId === ref.snapshotId)
  if (!block) return { valid: false, reason: '没有匹配的快照原文块。' }
  const points = Array.from(block.text)
  if (
    !Number.isInteger(ref.start) ||
    !Number.isInteger(ref.end) ||
    ref.start < 0 ||
    ref.end <= ref.start ||
    ref.end > points.length ||
    points.slice(ref.start, ref.end).join('') !== ref.quote
  )
    return { valid: false, reason: '引文或码点范围与原文不符。' }
  return { valid: true }
}
