import type { CheckView, DeliveryAssessment, DeliveryInput } from '@shouwei/contracts'
import { fail } from '../errors.js'
import { validateEvidence } from '../evidence.js'

export function validateExportNames(files: DeliveryInput['files']) {
  const names = new Set<string>(),
    ids = new Set<string>()
  for (const file of files) {
    const name = file.name
    if (
      !name ||
      Buffer.byteLength(name) > 220 ||
      /[\\/<>:"|?*\x00-\x1f\x7f]/.test(name) ||
      /[. ]$/.test(name) ||
      name === '.' ||
      name === '..' ||
      name.startsWith('._') ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
    )
      fail('INVALID_FILE', '导出名称不能包含路径、特殊字符、保留名或超过 220 字节。')
    const key = name.normalize('NFC').toLocaleLowerCase('en-US')
    if (names.has(key) || ids.has(file.snapshotId))
      fail('INVALID_FILE', '导出名称或快照重复，请为每个附件使用不同名称。')
    names.add(key)
    ids.add(file.snapshotId)
  }
  if (!files.length) fail('INVALID_FILE', '请至少选择一份交付材料。')
}
export function deliveryConclusion(
  view: CheckView,
  files: DeliveryInput['files'],
  requirementRisks: DeliveryInput['requirementRisks'],
): DeliveryAssessment {
  validateExportNames(files)
  const selected = new Set(files.map((f) => f.snapshotId)),
    run = view.workflow.runs.findLast((r) => r.kind === 'check')
  const must = view.workflow.requirements.filter(
    (r) => r.applicability === 'applicable' && r.importance === 'must',
  )
  const assessment: DeliveryAssessment = {
    conclusion: 'ready',
    blockers: [],
    risks: [],
    mustMet: 0,
    mustTotal: must.length,
  }
  const block = (reason: string, technical = false) => {
    assessment.blockers.push(reason)
    if (technical) assessment.conclusion = 'incomplete'
    else if (assessment.conclusion !== 'incomplete') assessment.conclusion = 'needs_work'
  }
  const riskIds = new Set<string>()
  for (const risk of requirementRisks) {
    if (
      !risk.reason.trim() ||
      riskIds.has(risk.requirementId) ||
      !view.workflow.requirements.some(
        (r) => r.id === risk.requirementId && r.applicability === 'applicable',
      )
    )
      fail('INVALID_INPUT', '风险必须对应适用要求，逐条填写原因且不能重复。')
    riskIds.add(risk.requirementId)
  }
  if (
    !run ||
    run.state !== 'completed' ||
    view.stale ||
    view.project.activeRunId ||
    view.workflow.draft.length ||
    run.requirementsVersion !== view.workflow.requirementsVersion ||
    !view.workflow.requirements.length ||
    view.workflow.requirements.some((r) => !r.userConfirmedAt)
  ) {
    block('请先确认要求并完成当前材料的核对。', true)
    return assessment
  }
  if (
    run.error ||
    run.gaps.length ||
    run.rejected.length ||
    run.completedBatches !== run.totalBatches
  )
    block('检查或解析仍有技术缺口，不能以接受风险代替完整检查。', true)
  const groups = new Set<string>()
  for (const file of files) {
    const snapshot = view.material.files.find((f) => f.id === file.snapshotId)
    if (
      !snapshot ||
      snapshot.role !== 'deliverable' ||
      !run.selectedSnapshotIds.includes(file.snapshotId)
    )
      block('交付附件必须来自本次已核对的待交材料。', true)
    else {
      if (snapshot.parseStatus !== 'complete')
        block(`${snapshot.originalName} 的读取范围不完整。`, true)
      if (groups.has(snapshot.logicalFileId)) block('同一材料只能选择一个交付版本。')
      groups.add(snapshot.logicalFileId)
    }
  }
  for (const req of must) {
    const result = run.results.find((m) => m.requirementId === req.id)
    if (result?.status === 'met') {
      const relevant = result.evidence.filter(
        (e) => view.material.files.find((f) => f.id === e.snapshotId)?.role === 'deliverable',
      )
      if (
        !relevant.length ||
        result.evidence.some((e) => !validateEvidence(e, view.material.blocks).valid)
      )
        block(`要求「${req.text}」缺少有效满足证据。`, true)
      else if (relevant.some((e) => !selected.has(e.snapshotId)))
        block(`要求「${req.text}」的必须附件未选入交付包。`)
      else assessment.mustMet++
    } else {
      const accepted = requirementRisks.find((r) => r.requirementId === req.id)
      if (accepted)
        assessment.risks.push({
          subjectId: req.id,
          title: req.text,
          reason: accepted.reason.trim(),
        })
      else
        block(
          `要求「${req.text}」${result?.status === 'unmet' ? '尚未满足' : '尚未确认覆盖'}，请补齐或逐条说明风险。`,
          result?.status !== 'unmet',
        )
    }
  }
  for (const finding of view.findings) {
    if (finding.reviewState === 'accepted_risk') {
      const decision = view.workflow.decisions.findLast(
        (d) =>
          d.fingerprint === finding.fingerprint &&
          d.inputHash === run.inputHash &&
          d.action === 'accepted_risk',
      )
      if (!decision?.reason.trim()) block(`「${finding.title}」尚未记录有效风险原因。`)
      else
        assessment.risks.push({
          subjectId: finding.id,
          title: finding.title,
          reason: decision.reason,
        })
    } else if (
      finding.severity !== 'suggestion' &&
      ['open', 'pending_recheck', 'stale'].includes(finding.reviewState)
    )
      block(`请先处理「${finding.title}」。`)
  }
  if (!assessment.blockers.length && assessment.risks.length)
    assessment.conclusion = 'ready_with_notes'
  return assessment
}
