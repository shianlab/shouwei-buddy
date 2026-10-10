import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MaterialService,
  CheckService,
  type CheckModel,
} from '../../packages/core/src/index.js'
import type {
  AnalysisRequest,
  AnalysisResult,
  Result,
  TextBlock,
  RequirementEdit,
} from '@shouwei/contracts'
it('six confirmed requirements produce four issue groups; date-only correction never erases an unfixed budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shouwei-golden-'))
  const materials = new MaterialService(root)
  const p = await materials.createProject({
    name: '周末读书会',
    recipient: '活动负责人',
    goal: '核对方案、通知、预算与报名说明',
  })
  const files = [
    [
      '要求.md',
      'requirement',
      'R01 活动日期统一为 2026-10-24。\nR02 地点为一层 A 教室。\nR03 提交已确认的最终预算。\nR04 场地费用和其他费用合计不超过 3000 元。\nR05 提交活动方案和活动通知。\nR06 单独提交报名说明。',
    ],
    ['方案.md', 'deliverable', '活动日期：2026-10-24\n地点：一层 A 教室'],
    ['通知.md', 'deliverable', '活动日期：2026-10-25\n地点：一层 A 教室'],
    ['预算-v1.md', 'deliverable', '场地费：400 元\n合计：2400 元\n状态：旧版，待确认'],
    ['预算-v2.md', 'deliverable', '场地费：待定\n合计：待定\n状态：更新稿，待确认'],
  ] as const
  let revision = 1
  for (const [name, role, text] of files) {
    const s = await materials.stageUpload(p.id, name, Buffer.from(text))
    const r = await materials.importSelection(p.id, s.token, {
      expectedRevision: revision,
      role,
      encoding: 'utf-8',
    })
    revision = (await materials.parseSnapshot(p.id, r.file.id, r.project.revision)).project
      .revision
  }
  const ref = (b: TextBlock) => ({
    snapshotId: b.fileSnapshotId,
    blockId: b.id,
    start: 0,
    end: Array.from(b.text).length,
    quote: b.text,
  })
  let fixedDate = false
  const connection = {
    id: 'fixture',
    displayName: '确定性样例',
    protocol: 'openai-chat' as const,
    baseUrl: 'http://127.0.0.1:1/v1',
    modelId: 'fixed-response',
    credentialRef: null,
    contextWindow: 64000,
    maxOutputTokens: 4096,
    requestTimeoutMs: 8000,
    capabilities: {
      text: 'untested',
      stream: 'untested',
      jsonMode: 'untested',
      tools: 'untested',
      vision: 'untested',
      usage: 'untested',
    } as const,
  }
  const model: CheckModel = {
    snapshot: () => connection,
    analyze: async <T>(request: AnalysisRequest<T>): Promise<Result<AnalysisResult<T>>> => {
      const material = materials.getProject(p.id),
        workflow = materials.getWorkflow(p.id)
      const selectedBlocks = material.blocks.filter(
        (b) =>
          workflow.selectedSnapshotIds === null ||
          workflow.selectedSnapshotIds.includes(b.fileSnapshotId),
      )
      const byText = (text: string) => selectedBlocks.find((b) => b.text === text)!
      const reqs = selectedBlocks.filter((b) => /^R0/.test(b.text))
      let output: unknown
      if (request.stage === 'requirements')
        output = {
          requirements: reqs.map((b) => ({
            text: b.text,
            importance: 'must',
            originKind: 'source',
            sourceEvidence: [ref(b)],
          })),
        }
      else if (request.stage === 'extract') output = { facts: [], matches: [] }
      else {
        const requirement = (n: number) =>
          workflow.requirements.find((r) => r.text.startsWith(`R0${n}`))!
        const req = (n: number) => ref(reqs.find((b) => b.text.startsWith(`R0${n}`))!)
        const item = (
          kind: string,
          title: string,
          ids: number[],
          evidence: ReturnType<typeof ref>[],
          severity = 'blocker',
        ) => ({
          kind,
          title,
          explanation: title,
          severity,
          requirementIds: ids.map((n) => requirement(n).id),
          evidence,
        })
        const findings = [
          item(
            'placeholder',
            '预算未填写',
            [4],
            [ref(byText('场地费：待定')), ref(byText('合计：待定'))],
          ),
          item(
            'version_ambiguity',
            '预算版本未确定',
            [3],
            [ref(byText('状态：旧版，待确认')), ref(byText('状态：更新稿，待确认'))],
            'attention',
          ),
          item('missing_material', '缺少报名说明', [6], [req(6)]),
        ]
        if (!fixedDate)
          findings.unshift(
            item(
              'fact_conflict',
              '活动日期不一致',
              [1],
              [
                req(1),
                ref(byText('活动日期：2026-10-24')),
                ref(byText('活动日期：2026-10-25')),
              ],
            ),
          )
        output = {
          findings,
          results: workflow.requirements.map((r) => ({
            requirementId: r.id,
            status:
              /^R0[25]/.test(r.text) || (fixedDate && r.text.startsWith('R01'))
                ? 'met'
                : 'unmet',
            evidence: [
              ref(
                byText(
                  r.text.startsWith('R02') ? '地点：一层 A 教室' : '活动日期：2026-10-24',
                ),
              ),
            ],
          })),
        }
      }
      return {
        ok: true,
        data: {
          data: request.outputSchema.parse(output),
          usage: null,
          durationMs: 1,
          sessionId: 'fixture',
        },
      }
    },
  }
  const checks = new CheckService(materials, model)
  try {
    await checks.start(p.id, revision, 'requirements')
    await checks.idle()
    let view = checks.view(p.id)
    const edits: RequirementEdit[] = view.workflow.draft.map(
      ({ version: _version, userConfirmedAt: _confirmed, ...r }) => r,
    )
    await checks.confirm(p.id, view.project.revision, edits)
    await checks.start(p.id, checks.view(p.id).project.revision, 'check')
    await checks.idle()
    view = checks.view(p.id)
    expect(view.findings).toHaveLength(4)
    expect(view.workflow.runs.at(-1)!.coverageComplete).toBe(true)
    expect(view.workflow.runs.at(-1)!.results.filter((r) => r.status === 'met')).toHaveLength(
      2,
    )
    const old = materials.getProject(p.id).files.find((f) => f.originalName === '通知.md')!,
      s = await materials.stageUpload(
        p.id,
        '通知.md',
        Buffer.from('活动日期：2026-10-24\n地点：一层 A 教室'),
      )
    const updated = await materials.importSelection(p.id, s.token, {
      expectedRevision: view.project.revision,
      role: 'deliverable',
      encoding: 'utf-8',
      logicalFileId: old.logicalFileId,
    })
    await materials.parseSnapshot(p.id, updated.file.id, updated.project.revision)
    view = checks.view(p.id)
    await checks.setScope(
      p.id,
      view.project.revision,
      view.material.files.filter((f) => f.id !== old.id).map((f) => f.id),
    )
    fixedDate = true
    await checks.start(p.id, checks.view(p.id).project.revision, 'check')
    await checks.idle()
    view = checks.view(p.id)
    expect(view.findings.find((f) => f.kind === 'fact_conflict')?.reviewState).toBe(
      'resolved_verified',
    )
    expect(view.findings.find((f) => f.kind === 'placeholder')?.reviewState).toBe('open')
    expect(view.workflow.runs.at(-1)!.results.filter((r) => r.status === 'met')).toHaveLength(
      3,
    )
  } finally {
    await checks.close()
    materials.close()
    await rm(root, { recursive: true, force: true })
  }
})
