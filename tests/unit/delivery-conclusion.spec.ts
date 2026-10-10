import { expect, it } from 'vitest'
import * as core from '../../packages/core/src/index.js'
import type { CheckView } from '@shouwei/contracts'

function fixture(): CheckView {
  const project = {
    id: 'p',
    name: '活动',
    recipient: '同事',
    goal: '交方案',
    revision: 4,
    activeRunId: null,
    createdAt: '2026-10-10',
    updatedAt: '2026-10-10',
  }
  const file = {
    id: 'f',
    projectId: 'p',
    logicalFileId: 'g',
    version: 1,
    role: 'deliverable' as const,
    originalName: '方案.md',
    sha256: 'abc',
    bytes: 2,
    encoding: 'utf-8' as const,
    parseStatus: 'complete' as const,
    createdAt: '2026-10-10',
  }
  const evidence = { snapshotId: 'f', blockId: 'b', start: 0, end: 2, quote: '方案' }
  return {
    project,
    stale: false,
    findings: [],
    material: {
      project,
      files: [file],
      blocks: [
        {
          id: 'b',
          fileSnapshotId: 'f',
          text: '方案',
          textHash: 'abc',
          locator: { kind: 'lines', startLine: 1, endLine: 1, part: 1 },
          coverage: 'extracted',
        },
      ],
      gaps: [],
      events: [],
    },
    workflow: {
      requirementsVersion: 1,
      draft: [],
      draftInputHash: null,
      selectedSnapshotIds: null,
      decisions: [],
      requirements: [
        {
          id: 'r',
          text: '提供方案',
          importance: 'must',
          originKind: 'user',
          sourceEvidence: [],
          applicability: 'applicable',
          reason: '',
          version: 1,
          userConfirmedAt: '2026-10-10',
        },
      ],
      runs: [
        {
          id: 'run',
          kind: 'check',
          inputRevision: 4,
          requirementsVersion: 1,
          inputHash: 'hash',
          model: {
            id: 'model',
            displayName: '合成',
            baseUrl: 'http://localhost',
            protocol: 'openai-chat',
            modelId: 'test',
            contextWindow: 32000,
            maxOutputTokens: 4096,
            requestTimeoutMs: 1000,
            capabilities: {
              text: 'untested',
              stream: 'untested',
              jsonMode: 'untested',
              tools: 'untested',
              vision: 'untested',
              usage: 'untested',
            },
          },
          state: 'completed',
          stage: '完成',
          completedBatches: 2,
          totalBatches: 2,
          cachedBatches: 0,
          selectedSnapshotIds: ['f'],
          startedAt: '2026-10-10',
          endedAt: '2026-10-10',
          facts: [],
          findings: [],
          results: [{ requirementId: 'r', status: 'met', evidence: [evidence] }],
          rejected: [],
          gaps: [],
          coverageComplete: true,
          error: null,
          usage: null,
          calls: 2,
          durationMs: 1,
        },
      ],
    },
  }
}
const calculate = (
  v: CheckView,
  files = [{ snapshotId: 'f', name: '方案.md' }],
  risks: { requirementId: string; reason: string }[] = [],
) => {
  expect(typeof (core as any).deliveryConclusion).toBe('function')
  return (core as any).deliveryConclusion(v, files, risks)
}
it('fully evidenced must requirements permit ready; suggestions do not block', () => {
  const v = fixture()
  v.findings.push({
    id: 's',
    fingerprint: 's',
    kind: 'naming',
    severity: 'suggestion',
    title: '建议名称',
    explanation: '可选',
    requirementIds: [],
    evidence: [],
    searchedSnapshotIds: [],
    reviewState: 'open',
  })
  expect(calculate(v).conclusion).toBe('ready')
})
it('open and pending substantive findings block until a reasoned risk is recorded', () => {
  const v = fixture()
  v.findings.push({
    id: 'x',
    fingerprint: 'x',
    kind: 'placeholder',
    severity: 'blocker',
    title: '尚未确认',
    explanation: '费用待确认',
    requirementIds: ['r'],
    evidence: [],
    searchedSnapshotIds: [],
    reviewState: 'open',
  })
  expect(calculate(v).conclusion).toBe('needs_work')
  v.findings[0].reviewState = 'accepted_risk'
  expect(calculate(v).conclusion).toBe('needs_work')
  v.workflow.decisions.push({
    id: 'd',
    runId: 'run',
    findingId: 'x',
    fingerprint: 'x',
    inputHash: 'hash',
    action: 'accepted_risk',
    reason: '先交筹备版',
    createdAt: '2026-10-10',
  })
  expect(calculate(v).conclusion).toBe('ready_with_notes')
  expect(calculate(v).risks[0].reason).toBe('先交筹备版')
})
it('unknown business coverage requires an explicit requirement risk but technical failure is never waivable', () => {
  const v = fixture()
  v.workflow.runs[0].results[0].status = 'unknown'
  v.workflow.runs[0].coverageComplete = false
  expect(calculate(v).conclusion).toBe('incomplete')
  expect(
    calculate(v, undefined, [{ requirementId: 'r', reason: '与负责人线下补确认' }]).conclusion,
  ).toBe('ready_with_notes')
  v.workflow.runs[0].gaps = ['读取失败']
  expect(calculate(v, undefined, [{ requirementId: 'r', reason: '同意' }]).conclusion).toBe(
    'incomplete',
  )
})
it.each(['unmet', 'unknown'] as const)(
  'accepting a naming finding does not accept a %s must requirement gap',
  (status) => {
    const v = fixture()
    v.workflow.requirements[0].text = '必须提供已签字预算'
    v.workflow.runs[0].results[0].status = status
    v.findings.push({
      id: 'naming',
      fingerprint: 'naming',
      kind: 'naming',
      severity: 'attention',
      title: '预算文件名不统一',
      explanation: '名称存在差异',
      requirementIds: ['r'],
      evidence: [],
      searchedSnapshotIds: [],
      reviewState: 'accepted_risk',
    })
    v.workflow.decisions.push({
      id: 'naming-decision',
      runId: 'run',
      findingId: 'naming',
      fingerprint: 'naming',
      inputHash: 'hash',
      action: 'accepted_risk',
      reason: '保留旧文件名即可',
      createdAt: '2026-10-10',
    })
    const blocked = calculate(v)
    expect(blocked.conclusion).toBe(status === 'unmet' ? 'needs_work' : 'incomplete')
    expect(blocked.blockers).toContain(
      `要求「必须提供已签字预算」${status === 'unmet' ? '尚未满足' : '尚未确认覆盖'}，请补齐或逐条说明风险。`,
    )
    const accepted = calculate(v, undefined, [
      { requirementId: 'r', reason: '先交未签字版本，负责人明日补签' },
    ])
    expect(accepted.conclusion).toBe('ready_with_notes')
    expect(accepted.mustMet).toBe(0)
    expect(accepted.risks).toEqual([
      { subjectId: 'r', title: '必须提供已签字预算', reason: '先交未签字版本，负责人明日补签' },
      { subjectId: 'naming', title: '预算文件名不统一', reason: '保留旧文件名即可' },
    ])
  },
)
it('excluding the evidenced must attachment blocks even when risk was accepted', () => {
  const v = fixture()
  v.material.files.push({
    ...v.material.files[0],
    id: 'f2',
    logicalFileId: 'g2',
    originalName: '另一份.md',
  })
  v.workflow.runs[0].selectedSnapshotIds.push('f2')
  expect(
    calculate(
      v,
      [{ snapshotId: 'f2', name: '另一份.md' }],
      [{ requirementId: 'r', reason: '先交' }],
    ).conclusion,
  ).toBe('needs_work')
})
it('multiple versions, uninspected files, stale and unfinished runs cannot be prepared', () => {
  const v = fixture()
  v.material.files.push({ ...v.material.files[0], id: 'f2', version: 2 })
  v.workflow.runs[0].selectedSnapshotIds.push('f2')
  expect(
    calculate(v, [
      { snapshotId: 'f', name: '方案.md' },
      { snapshotId: 'f2', name: '新版.md' },
    ]).conclusion,
  ).toBe('needs_work')
  v.stale = true
  expect(calculate(v).conclusion).toBe('incomplete')
  v.stale = false
  v.workflow.runs[0].state = 'failed'
  expect(calculate(v).conclusion).toBe('incomplete')
})
it('export names reject paths, reserved names and Unicode/case collisions', () => {
  const v = fixture()
  expect(() => calculate(v, [{ snapshotId: 'f', name: '../逃逸.md' }])).toThrow()
  expect(() => calculate(v, [{ snapshotId: 'f', name: 'CON.txt' }])).toThrow()
  v.material.files.push({ ...v.material.files[0], id: 'f2', logicalFileId: 'g2' })
  v.workflow.runs[0].selectedSnapshotIds.push('f2')
  expect(() =>
    calculate(v, [
      { snapshotId: 'f', name: 'É.md' },
      { snapshotId: 'f2', name: 'é.MD' },
    ]),
  ).toThrow()
})
