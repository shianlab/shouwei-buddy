import type { DemoState, IssueId } from './demo-service'
import { fixture } from './demo-data'
export type DemoFile = (typeof fixture.files)[number]
export function projectView(state: DemoState) {
  const issues = fixture.issues.map((issue) => ({
    ...issue,
    status: state.statuses[issue.id as IssueId],
  }))
  const resolved = (id: IssueId) => state.statuses[id] === 'resolved'
  const accepted = state.statuses.I02 === 'accepted' && state.reason.trim().length >= 2
  const requirements = fixture.requirements.map((requirement, index) => ({
    ...requirement,
    satisfied:
      [
        resolved('I01'),
        true,
        resolved('I03'),
        resolved('I02') && resolved('I03'),
        true,
        resolved('I04'),
      ][index] ?? false,
  }))
  const corrected = (id: IssueId) => state.statuses[id] !== 'open'
  const files: DemoFile[] = fixture.files.map((file) => {
    if (file.id === 'F03' && corrected('I01'))
      return {
        ...file,
        name: '活动通知-修正版.pdf',
        text: file.text.replace('10 月 25 日', '10 月 24 日'),
      }
    if (file.id === 'F05' && corrected('I02'))
      return {
        ...file,
        name: accepted ? '预算-筹备版.md' : '预算-确认版.md',
        text: accepted
          ? '场地费用：预计 600 元，费用尚未最终确认。\n其他费用：2200 元。\n预计合计：2800 元。'
          : '场地费用：600 元。\n其他费用：2200 元。\n合计：2800 元。\n状态：经负责人确认，用于本次交付。',
      }
    return file
  })
  if (corrected('I04'))
    files.push({
      id: 'F06',
      name: '报名说明.md',
      type: 'MD',
      role: '待交材料',
      size: '1.0 KB',
      text: '报名截止时间：2026 年 10 月 23 日 18:00，Asia/Shanghai。\n报名方式：向活动负责人提交姓名和是否参加共读的文字回复。\n活动日期：2026 年 10 月 24 日。',
    })
  const openCount = issues.filter((issue) => issue.status === 'open').length
  const pendingCount = issues.filter((issue) => issue.status === 'pending').length
  const baseReady =
    resolved('I01') &&
    resolved('I03') &&
    resolved('I04') &&
    (resolved('I02') || accepted) &&
    state.run !== 'running' &&
    state.run !== 'failed' &&
    state.run !== 'cancelled' &&
    !['partial', 'stale', 'timeout'].includes(state.scenario)
  const deliveryFiles = files.filter((file) => ['F02', 'F03', 'F05', 'F06'].includes(file.id))
  const missingAttachments = deliveryFiles.filter((file) => state.excludes.includes(file.id))
  const canDeliver = baseReady && missingAttachments.length === 0 && deliveryFiles.length === 4
  const conclusion = !canDeliver ? 'needs_work' : accepted ? 'ready_with_notes' : 'ready'
  const riskNote = accepted ? `费用尚未最终确认。${state.reason}。场地确认后请补交最终版预算。` : ''
  return {
    issues,
    requirements,
    files,
    openCount,
    pendingCount,
    satisfied: requirements.filter((item) => item.satisfied).length,
    acceptedCount: accepted ? 1 : 0,
    deliveryFiles,
    missingAttachments,
    canDeliver,
    conclusion,
    riskNote,
    deliveryNote: [state.note, riskNote ? `\n需留意：${riskNote}` : ''].join(''),
    blockReason:
      state.run === 'running'
        ? '示例检查仍在进行，请等待完成。'
        : state.run === 'failed' || state.run === 'cancelled'
          ? '本次检查未完成，请继续检查。'
          : state.scenario === 'partial'
            ? '仍有未覆盖页面，请先换用文字版材料。'
            : state.scenario === 'stale'
              ? '材料有变化，需要复核后再交付。'
              : state.scenario === 'timeout'
                ? '示例检查未完成，请重试。'
                : missingAttachments.length
                  ? '必交附件不能遗漏，请恢复勾选。'
                  : openCount
                    ? `还有 ${openCount} 项未处理，请先回到清单。`
                    : pendingCount
                      ? `有 ${pendingCount} 项修改等待复核。`
                      : '',
  }
}
export type ProjectViewModel = ReturnType<typeof projectView>
