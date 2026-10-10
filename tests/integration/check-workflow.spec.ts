import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '../../packages/core/src/index.js'
import type { AnalysisRequest, AnalysisResult, Result, TextBlock } from '@shouwei/contracts'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})
const editOf = (r: any) => ({
  id: r.id,
  text: r.text,
  importance: r.importance,
  originKind: r.originKind,
  sourceEvidence: r.sourceEvidence,
  applicability: r.applicability,
  reason: r.reason,
})
const connection = {
  id: 'test-model',
  displayName: '本机测试',
  modelId: 'synthetic',
  protocol: 'openai-chat' as const,
  baseUrl: 'http://127.0.0.1:1/v1',
  credentialRef: null,
  contextWindow: 32000,
  maxOutputTokens: 4096,
  requestTimeoutMs: 5000,
  capabilities: {
    text: 'untested',
    stream: 'untested',
    jsonMode: 'untested',
    tools: 'untested',
    vision: 'untested',
    usage: 'untested',
  } as const,
}
function evidence(b: TextBlock) {
  return {
    snapshotId: b.fileSnapshotId,
    blockId: b.id,
    start: 0,
    end: Array.from(b.text).length,
    quote: b.text,
  }
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'shouwei-check-'))
  const materials = new core.MaterialService(root)
  let checks: core.CheckService | undefined
  cleanup.push(async () => {
    await checks?.close()
    materials.close()
    await rm(root, { recursive: true, force: true })
  })
  const p = await materials.createProject({
    name: '活动',
    recipient: '同事',
    goal: '核对活动日期与费用',
  })
  let revision = 1
  for (const [name, role, text] of [
    ['要求.txt', 'requirement', '活动日期为 2026-10-24\n下周提交预算'],
    ['方案.txt', 'deliverable', '活动日期：2026-10-25\n场地费：待定'],
  ] as const) {
    const selection = await materials.stageUpload(p.id, name, Buffer.from(text))
    const imported = await materials.importSelection(p.id, selection.token, {
      expectedRevision: revision,
      role,
      encoding: 'utf-8',
    })
    revision = (
      await materials.parseSnapshot(p.id, imported.file.id, imported.project.revision)
    ).project.revision
  }
  const blocks = materials.getProject(p.id).blocks
  const req = blocks.find((b) => b.text === '活动日期为 2026-10-24')!
  const data = blocks.find((b) => b.text === '活动日期：2026-10-25')!
  let handler: (r: AnalysisRequest<unknown>, signal: AbortSignal) => Promise<unknown> = async (
    r,
  ) => {
    if (r.stage === 'requirements')
      return {
        requirements: [
          {
            text: '统一活动日期',
            importance: 'must',
            originKind: 'source',
            sourceEvidence: [evidence(req)],
          },
          {
            text: '下周提交预算',
            importance: 'must',
            originKind: 'suggested',
            sourceEvidence: [],
          },
        ],
      }
    if (r.stage === 'extract') return { facts: [], matches: [] }
    return {
      findings: [
        {
          kind: 'fact_conflict',
          severity: 'blocker',
          title: '日期冲突',
          explanation: '活动日期不一致',
          requirementIds: [get().workflow.requirements[0]!.id],
          evidence: [evidence(req), evidence(data)],
        },
      ],
      results: [
        {
          requirementId: get().workflow.requirements[0]!.id,
          status: 'unmet',
          evidence: [evidence(data)],
        },
      ],
    }
  }
  const model = {
    snapshot: () => connection,
    analyze: async <T>(
      r: AnalysisRequest<T>,
      signal: AbortSignal,
    ): Promise<Result<AnalysisResult<T>>> => {
      try {
        const data = await handler(r as AnalysisRequest<unknown>, signal)
        return {
          ok: true,
          data: {
            data: r.outputSchema.parse(data),
            usage: null,
            sessionId: 'test',
            durationMs: 1,
          },
        }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: signal.aborted
              ? 'CANCELLED'
              : error instanceof core.MaterialError
                ? error.code
                : 'INVALID_CREDENTIAL',
            userMessage: '测试失败',
            retryable: false,
            diagnosticId: 'test',
          },
        }
      }
    },
  }
  expect(typeof (core as any).CheckService).toBe('function')
  checks = new core.CheckService(materials, model)
  const get = () => checks!.view(p.id)

  const draft = async () => {
    await checks!.start(p.id, get().project.revision, 'requirements')
    await checks!.idle()
  }
  const confirm = async () => {
    await draft()
    const view = get()
    await checks!.confirm(
      p.id,
      view.project.revision,
      view.workflow.draft.map((r: any) => ({
        ...editOf(r),
        applicability: 'applicable',
        reason: '',
        text: r.text === '下周提交预算' ? '2026-10-30 提交预算' : r.text,
      })),
    )
  }
  return {
    root,
    materials,
    checks: checks!,
    p,
    get,
    blocks,
    req,
    data,
    draft,
    confirm,
    setHandler: (fn: typeof handler) => {
      handler = fn
    },
  }
}
it('extracts separate requirements, retains source evidence and requires human confirmation/date anchoring', async () => {
  const x = await setup()
  await x.draft()
  let v = x.get()
  expect(v.workflow.draft).toHaveLength(2)
  expect(v.workflow.requirements).toEqual([])
  expect(v.workflow.draft[1].originKind).toBe('suggested')
  await expect(
    x.checks.confirm(
      x.p.id,
      v.project.revision,
      v.workflow.draft.map((r: any) => ({
        ...editOf(r),
        applicability: 'applicable',
        reason: '',
      })),
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await x.confirm()
  v = x.get()
  expect(v.workflow.requirementsVersion).toBe(1)
  expect(v.workflow.requirements[0]!.sourceEvidence[0].quote).toBe('活动日期为 2026-10-24')
  await expect(x.checks.start(x.p.id, 1, 'check')).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  })
})
it('empty/unconfirmed requirements block checks; model auth failure preserves the previous draft', async () => {
  const x = await setup()
  await expect(
    x.checks.start(x.p.id, x.get().project.revision, 'check'),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await x.draft()
  const old = x.get().workflow.draft
  x.setHandler(async () => {
    throw Error('bad key')
  })
  await x.draft()
  expect(x.get().workflow.draft).toEqual(old)
  expect(x.get().workflow.runs.at(-1)!.state).toBe('failed')
})
it('checks persist across reopen; decisions require reason and cannot mark fixed without successful recheck', async () => {
  const x = await setup()
  await x.confirm()
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  let v = x.get()
  const run = v.workflow.runs.at(-1)!
  expect(run.state).toBe('completed')
  expect(run.findings[0]!.title).toBe('日期冲突')
  await expect(
    x.checks.decide(
      x.p.id,
      v.project.revision,
      run.id,
      run.findings[0]!.id,
      'accepted_risk',
      '',
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await x.checks.decide(
    x.p.id,
    v.project.revision,
    run.id,
    run.findings[0]!.id,
    'pending_recheck',
    '已在外部修改',
  )
  v = x.get()
  expect(v.findings[0]!.reviewState).toBe('pending_recheck')
  const reopened = new core.MaterialService(x.root)
  expect(reopened.getWorkflow(x.p.id).runs.at(-1)!.findings[0]!.title).toBe('日期冲突')
  reopened.close()
})
it('fabricated evidence is rejected and makes the result incomplete rather than clean', async () => {
  const x = await setup()
  await x.confirm()
  x.setHandler(async (r) =>
    r.stage === 'extract'
      ? { facts: [], matches: [] }
      : {
          findings: [
            {
              kind: 'placeholder',
              severity: 'blocker',
              title: '伪造',
              explanation: 'x',
              requirementIds: [],
              evidence: [{ ...evidence(x.data), blockId: 'invented' }],
            },
          ],
          results: [],
        },
  )
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  const r = x.get().workflow.runs.at(-1)!
  expect(r.state).toBe('completed')
  expect(r.coverageComplete).toBe(false)
  expect(r.findings).toEqual([])
  expect(r.rejected.length).toBeGreaterThan(0)
})
it('cancellation owns the active run until the model has actually settled and never completes it', async () => {
  const x = await setup()
  await x.confirm()
  let release!: () => void
  let started!: () => void
  const ready = new Promise<void>((r) => (started = r))
  x.setHandler(async () => {
    started()
    await new Promise<void>((r) => (release = r))
    return { facts: [], matches: [] }
  })
  const run = await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await ready
  const cancelled = x.checks.cancel(x.p.id, run.id)
  expect(x.get().project.activeRunId).toBe(run.id)
  await expect(
    x.checks.start(x.p.id, x.get().project.revision, 'check'),
  ).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
  release()
  await cancelled
  expect(x.get().workflow.runs.at(-1)!.state).toBe('cancelled')
  expect(x.get().project.activeRunId).toBe(null)
  expect(x.materials.getProject(x.p.id).events.some((e) => e.type === 'check_completed')).toBe(
    false,
  )
})
it('new snapshots invalidate decisions and requirement edits invalidate matching', async () => {
  const x = await setup()
  await x.confirm()
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  let v = x.get()
  const run = v.workflow.runs.at(-1)!
  await x.checks.decide(
    x.p.id,
    v.project.revision,
    run.id,
    run.findings[0]!.id,
    'dismissed',
    '人工确认另有安排',
  )
  expect(x.get().findings[0]!.reviewState).toBe('dismissed')
  const s = await x.materials.stageUpload(x.p.id, '新增.txt', Buffer.from('新内容'))
  await x.materials.importSelection(x.p.id, s.token, {
    expectedRevision: x.get().project.revision,
    role: 'deliverable',
    encoding: 'utf-8',
  })
  expect(x.get().stale).toBe(true)
  expect(x.get().findings[0]!.reviewState).toBe('stale')
})
it('rule and semantic candidates with the same evidence form one issue without weakening severity', async () => {
  const x = await setup()
  await x.confirm()
  x.setHandler(async (r) =>
    r.stage === 'extract'
      ? {
          facts: [
            {
              entityKey: '活动',
              field: 'date',
              value: '2026-10-24',
              qualifiers: '活动日期',
              isExample: false,
              evidence: [evidence(x.req)],
            },
            {
              entityKey: '活动',
              field: 'date',
              value: '2026-10-25',
              qualifiers: '活动日期',
              isExample: false,
              evidence: [evidence(x.data)],
            },
          ],
          matches: [],
        }
      : {
          findings: [
            {
              kind: 'fact_conflict',
              severity: 'suggestion',
              title: '日期冲突',
              explanation: '核对日期',
              requirementIds: [x.get().workflow.requirements[0]!.id],
              evidence: [evidence(x.req), evidence(x.data)],
            },
          ],
          results: [],
        },
  )
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  const findings = x.get().findings
  expect(findings).toHaveLength(1)
  expect(findings[0]!.severity).toBe('blocker')
  expect(findings[0]!.requirementIds).toHaveLength(1)
})
it('changing requirement sources after drafting prevents confirming an outdated AI draft', async () => {
  const x = await setup()
  await x.draft()
  const draft = x
    .get()
    .workflow.draft.map(editOf)
    .map((r: any) => ({
      ...r,
      text: r.text === '下周提交预算' ? '2026-10-30 提交预算' : r.text,
    }))
  const s = await x.materials.stageUpload(x.p.id, '新要求.txt', Buffer.from('更换活动日期'))
  await x.materials.importSelection(x.p.id, s.token, {
    expectedRevision: x.get().project.revision,
    role: 'requirement',
    encoding: 'utf-8',
  })
  await expect(
    x.checks.confirm(x.p.id, x.get().project.revision, draft),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
})
it('failed extraction preserves a visible failed run, no clean result and committed prior requirements', async () => {
  const x = await setup()
  await x.confirm()
  x.setHandler(async () => {
    throw Error('broken provider')
  })
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  const v = x.get()
  expect(v.workflow.runs.at(-1)?.state).toBe('failed')
  expect(v.workflow.runs.at(-1)?.coverageComplete).toBe(false)
  expect(v.workflow.requirements).toHaveLength(2)
  expect(v.project.activeRunId).toBe(null)
})
it('only a successful complete recheck with supporting matches can resolve an earlier issue', async () => {
  const x = await setup()
  await x.confirm()
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  const v = x.get()
  await x.checks.decide(
    x.p.id,
    v.project.revision,
    v.workflow.runs.at(-1)!.id,
    v.findings[0]!.id,
    'pending_recheck',
    '修正后再核对',
  )
  x.setHandler(async (r) =>
    r.stage === 'extract'
      ? { facts: [], matches: [] }
      : {
          findings: [],
          results: x.get().workflow.requirements.map((r) => ({
            requirementId: r.id,
            status: 'met',
            evidence: [evidence(x.data)],
          })),
        },
  )
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  expect(x.get().findings[0]!.reviewState).toBe('resolved_verified')
})
it('restart turns unfinished model checkpoints into interrupted and retains completed requirements', async () => {
  const x = await setup()
  await x.confirm()
  const previous = x.get().workflow.requirements
  await x.materials.startWorkflow(x.p.id, x.get().project.revision, (w, runId) => {
    w.runs.push({
      ...w.runs[0]!,
      id: runId,
      state: 'running',
      kind: 'check',
      stage: 'extract',
    })
  })
  await x.materials.recoverInterrupted()
  expect(x.get().workflow.runs.at(-1)?.state).toBe('interrupted')
  expect(x.get().project.activeRunId).toBe(null)
  expect(x.get().workflow.requirements).toEqual(previous)
})
it('recheck reuses committed unchanged extraction batches but always reruns cross-file judgment', async () => {
  const x = await setup()
  await x.confirm()
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  expect(x.get().workflow.runs.at(-1)!.calls).toBe(2)
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  const rerun = x.get().workflow.runs.at(-1)!
  expect(rerun.calls).toBe(1)
  expect(rerun.cachedBatches).toBe(1)
  expect(rerun.findings[0]?.title).toBe('日期冲突')
})
it('429 is retried at the application layer and does not create a second active run', async () => {
  const x = await setup()
  await x.confirm()
  let limited = true
  x.setHandler(async (r) => {
    if (limited) {
      limited = false
      throw new core.MaterialError('RATE_LIMITED', '稍后重试', true)
    }
    return r.stage === 'extract' ? { facts: [], matches: [] } : { findings: [], results: [] }
  })
  const started = await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  const run = x.get().workflow.runs.at(-1)!
  expect(run.id).toBe(started.id)
  expect(run.state).toBe('completed')
  expect(run.calls).toBe(3)
  expect(x.get().project.activeRunId).toBe(null)
})
it('partial or unread materials prohibit a definitive missing-material finding', async () => {
  const x = await setup()
  await x.confirm()
  const s = await x.materials.stageUpload(x.p.id, '未读取.txt', Buffer.from('报名说明'))
  await x.materials.importSelection(x.p.id, s.token, {
    expectedRevision: x.get().project.revision,
    role: 'deliverable',
    encoding: 'utf-8',
  })
  x.setHandler(async (r) =>
    r.stage === 'extract'
      ? { facts: [], matches: [] }
      : {
          findings: [
            {
              kind: 'missing_material',
              severity: 'blocker',
              title: '缺少报名说明',
              explanation: '未找到',
              requirementIds: [x.get().workflow.requirements[0]!.id],
              evidence: [evidence(x.req)],
            },
          ],
          results: [],
        },
  )
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  expect(x.get().findings).toEqual([])
  expect(x.get().workflow.runs.at(-1)!.coverageComplete).toBe(false)
  expect(x.get().workflow.runs.at(-1)!.gaps.join()).toContain('未读取.txt')
})
it('an unchanged duplicate snapshot keeps a valid review decision', async () => {
  const x = await setup()
  await x.confirm()
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  const v = x.get(),
    run = v.workflow.runs.at(-1)!
  await x.checks.decide(
    x.p.id,
    v.project.revision,
    run.id,
    run.findings[0]!.id,
    'accepted_risk',
    '安排已有确认',
  )
  const s = await x.materials.stageUpload(
    x.p.id,
    '方案.txt',
    Buffer.from('活动日期：2026-10-25\n场地费：待定'),
  )
  await x.materials.importSelection(x.p.id, s.token, {
    expectedRevision: x.get().project.revision,
    role: 'deliverable',
    encoding: 'utf-8',
  })
  expect(x.get().stale).toBe(false)
  expect(x.get().findings[0]!.reviewState).toBe('accepted_risk')
})
it('stop-unconfirmed keeps the run gate locked across projects until restart', async () => {
  const x = await setup()
  await x.confirm()
  x.setHandler(async () => {
    throw new core.MaterialError('STOP_UNCONFIRMED', '未确认退出')
  })
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  expect(x.get().workflow.runs.at(-1)!.state).toBe('stop_unconfirmed')
  expect(x.get().project.activeRunId).not.toBe(null)
  const other = await x.materials.createProject({
    name: '另一项目',
    recipient: '',
    goal: '测试',
  })
  await expect(x.checks.start(other.id, other.revision, 'requirements')).rejects.toMatchObject(
    { code: 'RUNTIME_BUSY' },
  )
})
it('a stale model selection cannot send materials to a newly configured provider', async () => {
  const x = await setup()
  await x.confirm()
  await expect(
    x.checks.start(x.p.id, x.get().project.revision, 'check', 'previous-connection'),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  expect(x.get().project.activeRunId).toBe(null)
})
it('excluded source quotes cannot be reconfirmed or sent in a check', async () => {
  const x = await setup()
  await x.confirm()
  await x.checks.setScope(x.p.id, x.get().project.revision, [x.data.fileSnapshotId])
  await expect(
    x.checks.confirm(
      x.p.id,
      x.get().project.revision,
      x.get().workflow.requirements.map(editOf),
    ),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await expect(
    x.checks.start(x.p.id, x.get().project.revision, 'check'),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
})
it('manual requirements can report missing material without inventing a source file', async () => {
  const x = await setup()
  await x.confirm()
  await x.checks.setScope(x.p.id, x.get().project.revision, [x.data.fileSnapshotId])
  const req = {
    ...editOf(x.get().workflow.requirements[0]),
    text: '必须提交独立报名说明',
    originKind: 'user',
    sourceEvidence: [],
  }
  await x.checks.confirm(x.p.id, x.get().project.revision, [req])
  x.setHandler(async (r) =>
    r.stage === 'extract'
      ? { facts: [], matches: [] }
      : {
          findings: [
            {
              kind: 'missing_material',
              severity: 'blocker',
              title: '缺少报名说明',
              explanation: '已读取全部选定材料，未找到报名说明',
              requirementIds: [req.id],
              evidence: [],
            },
          ],
          results: [{ requirementId: req.id, status: 'unmet', evidence: [] }],
        },
  )
  await x.checks.start(x.p.id, x.get().project.revision, 'check')
  await x.checks.idle()
  expect(x.get().workflow.runs.at(-1)!.coverageComplete).toBe(true)
  expect(x.get().findings).toHaveLength(1)
  expect(x.get().findings[0].searchedSnapshotIds).toEqual([x.data.fileSnapshotId])
})
