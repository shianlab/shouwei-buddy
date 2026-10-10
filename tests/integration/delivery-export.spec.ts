import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, readFile, readdir, writeFile, chmod, mkdir, symlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import * as core from '../../packages/core/src/index.js'
import type { AnalysisRequest } from '@shouwei/contracts'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})
async function setup(withRisk=false) {
  const root = await mkdtemp(join(tmpdir(), 'shouwei-delivery-'))
  const materials = new core.MaterialService(root)
  const p = await materials.createProject({
    name: '=中文活动<script>',
    recipient: '同事',
    goal: '交活动方案',
  })
  const upload = await materials.stageUpload(
    p.id,
    '方案.md',
    Buffer.from('活动方案：<script>alert(1)</script>'),
  )
  const imported = await materials.importSelection(p.id, upload.token, {
    expectedRevision: p.revision,
    role: 'deliverable',
    encoding: 'utf-8',
  })
  await materials.parseSnapshot(p.id, imported.file.id, imported.project.revision)
  const checks = new core.CheckService(materials, {
    snapshot: () => ({
      id: 'synthetic',
      displayName: '本机合成',
      protocol: 'openai-chat',
      baseUrl: 'http://127.0.0.1',
      modelId: 'test',
      credentialRef: null,
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
    }),
    analyze: async <T>(request: AnalysisRequest<T>) => {
      const block = materials.getProject(p.id).blocks[0]!,
        e = {
          snapshotId: block.fileSnapshotId,
          blockId: block.id,
          start: 0,
          end: Array.from(block.text).length,
          quote: block.text,
        }
      const value =
        request.stage === 'extract'
          ? { facts: [], matches: [] }
          : { findings: withRisk ? [{kind:'requirement_gap',severity:'attention',title:'待负责人确认',explanation:'签字确认仍待补充',requirementIds:['req'],evidence:[e]}] : [], results: [{ requirementId: 'req', status: 'met', evidence: [e] }] }
      return {
        ok: true as const,
        data: {
          data: request.outputSchema.parse(value),
          sessionId: 'synthetic',
          durationMs: 1,
          usage: null,
        },
      }
    },
  })
  await checks.confirm(p.id, checks.view(p.id).project.revision, [
    {
      id: 'req',
      text: '提供活动方案',
      importance: 'must',
      originKind: 'user',
      sourceEvidence: [],
      applicability: 'applicable',
      reason: '',
    },
  ])
  await checks.start(p.id, checks.view(p.id).project.revision, 'check')
  await checks.idle()
  cleanup.push(async () => {
    await checks.close()
    materials.close()
    await rm(root, { recursive: true, force: true })
  })
  expect(typeof (core as any).DeliveryService).toBe('function')
  const delivery = new (core as any).DeliveryService(materials, checks, root)
  const input = () => ({
    expectedRevision: checks.view(p.id).project.revision,
    files: [{ snapshotId: imported.file.id, name: '=方案.md' }],
    note: '请查收<script>alert(2)</script>',
    requirementRisks: [],
  })
  return { root, materials, checks, p, delivery, input, file: imported.file }
}
it('ZIP hashes match source bytes, CSV formulas are escaped, internal HTML is inert and history survives restart', async () => {
  const x = await setup(),
    preview = await x.delivery.prepare(x.p.id, x.input())
  const exported = await x.delivery.export(x.p.id, preview.id)
  expect(exported.state).toBe('completed')
  const zip = await x.delivery.download(x.p.id, preview.id, 'zip'),
    report = await x.delivery.download(x.p.id, preview.id, 'report')
  const content = unzipSync(zip.bytes),
    manifest = JSON.parse(strFromU8(content['manifest.json']))
  expect(Object.keys(content)).toEqual(
    expect.arrayContaining([
      '材料/=方案.md',
      '交付说明.md',
      '风险说明.md',
      '附件清单.csv',
      'manifest.json',
    ]),
  )
  expect(Object.keys(content)).not.toContain('检查报告.html')
  expect(createHash('sha256').update(content['材料/=方案.md']).digest('hex')).toBe(
    x.file.sha256,
  )
  expect(manifest.files[0].sha256).toBe(x.file.sha256)
  expect(strFromU8(content['附件清单.csv'])).toContain("'=方案.md")
  expect(report.bytes.toString()).not.toContain('<script>')
  expect(report.bytes.toString()).toContain('&lt;script&gt;')
  expect(await readFile(join(x.root, 'snapshots', x.file.id))).toEqual(
    Buffer.from('活动方案：<script>alert(1)</script>'),
  )
  x.materials.close()
  const reopened = new core.MaterialService(x.root)
  try {
    expect(reopened.getDelivery(x.p.id, preview.id).projectName).toBe('=中文活动<script>')
  } finally {
    reopened.close()
  }
})
it('accepted risks remain in a separate ZIP document even if the editable note is empty',async()=>{
 const x=await setup(true),v=x.checks.view(x.p.id),run=v.workflow.runs.at(-1)!
 await x.checks.decide(x.p.id,v.project.revision,run.id,run.findings[0].id,'accepted_risk','先给负责人看筹备版，周五补签字')
 const preview=await x.delivery.prepare(x.p.id,{...x.input(),note:''})
 expect(preview.assessment.conclusion).toBe('ready_with_notes')
 await x.delivery.export(x.p.id,preview.id)
 const zip=unzipSync((await x.delivery.download(x.p.id,preview.id,'zip')).bytes)
 expect(strFromU8(zip['风险说明.md'])).toContain('周五补签字')
 expect(JSON.parse(strFromU8(zip['manifest.json'])).risks).toHaveLength(1)
})
it('concurrent duplicate clicks return the same artifact and changed project cannot use a preview', async () => {
  const x = await setup(),
    preview = await x.delivery.prepare(x.p.id, x.input())
  const [one, two] = await Promise.all([
    x.delivery.export(x.p.id, preview.id),
    x.delivery.export(x.p.id, preview.id),
  ])
  expect(one.id).toBe(two.id)
  expect((await readdir(join(x.root, 'exports'))).filter((n) => !n.startsWith('.'))).toEqual([
    preview.id,
  ])
  const old = await x.delivery.prepare(x.p.id, x.input())
  await x.materials.updateProject(x.p.id, x.input().expectedRevision, {
    name: '新项目名',
    recipient: '同事',
    goal: '交活动方案',
  })
  await expect(x.delivery.export(x.p.id, old.id)).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  })
  expect((await x.delivery.detail(x.p.id, preview.id)).projectName).toBe('=中文活动<script>')
})
it('disk failure and cancellation never produce completed or remove an earlier export', async () => {
  const x = await setup(),
    earlier = await x.delivery.prepare(x.p.id, x.input())
  await x.delivery.export(x.p.id, earlier.id)
  const failed = await x.delivery.prepare(x.p.id, x.input())
  const bad = new (core as any).DeliveryService(x.materials, x.checks, x.root, {
    writeFile: async () => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    },
  })
  await expect(bad.export(x.p.id, failed.id)).rejects.toMatchObject({ code: 'RUNTIME_FAILED' })
  expect(x.materials.getDelivery(x.p.id, failed.id).state).toBe('failed')
  expect((await x.delivery.download(x.p.id, earlier.id, 'zip')).bytes.length).toBeGreaterThan(
    0,
  )
  const cancelled = await x.delivery.prepare(x.p.id, x.input()),
    abort = new AbortController()
  abort.abort()
  await expect(x.delivery.export(x.p.id, cancelled.id, abort.signal)).rejects.toMatchObject({
    code: 'CANCELLED',
  })
  expect(x.materials.getDelivery(x.p.id, cancelled.id).state).toBe('cancelled')
  expect((await readdir(join(x.root, 'exports'))).some((n) => n.startsWith('.tmp-'))).toBe(
    false,
  )
})
it('tampered snapshots or downloaded artifacts are rejected and project ownership is checked', async () => {
  const x = await setup(),
    preview = await x.delivery.prepare(x.p.id, x.input())
  await x.delivery.export(x.p.id, preview.id)
  await writeFile(join(x.root, 'exports', preview.id, '交付包.zip'), 'corrupt')
  await expect(x.delivery.download(x.p.id, preview.id, 'zip')).rejects.toBeDefined()
  const other = await x.materials.createProject({
    name: '其他项目',
    recipient: '',
    goal: '交材料',
  })
  await expect(x.delivery.detail(other.id, preview.id)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
  const next = await x.delivery.prepare(x.p.id, x.input())
  await chmod(join(x.root, 'snapshots', x.file.id), 0o600)
  await writeFile(join(x.root, 'snapshots', x.file.id), 'altered')
  await expect(x.delivery.export(x.p.id, next.id)).rejects.toMatchObject({
    code: 'SNAPSHOT_CHANGED',
  })
  expect(x.materials.getDelivery(x.p.id, next.id).state).toBe('failed')
})
it('restart settles unfinished exports as failed without inventing a completed package', async () => {
  const x = await setup(),
    preview = await x.delivery.prepare(x.p.id, x.input())
  await x.materials.exportDeliveryRecord(
    x.p.id,
    preview.id,
    async (record: any, _read: any, persist: () => void) => {
      record.state = 'writing'
      persist()
      return record
    },
  )
  const temporary = join(x.root, 'exports', `.tmp-${preview.id}-${randomUUID()}`)
  await mkdir(temporary, { recursive: true })
  await writeFile(join(temporary, 'partial.zip'), 'incomplete')
  const unrelated = join(x.root, 'exports', '.tmp-unrelated')
  await mkdir(unrelated)
  const outside = join(x.root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'keep.txt'), 'keep')
  const linked = join(x.root, 'exports', `.tmp-${preview.id}-${randomUUID()}`)
  await symlink(outside, linked)
  await x.materials.recoverInterrupted()
  expect(x.materials.getDelivery(x.p.id, preview.id).state).toBe('failed')
  expect(await x.delivery.history()).toEqual([])
  expect(await readdir(join(x.root, 'exports'))).not.toContain(temporary.split('/').at(-1))
  expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
  expect(await readdir(join(x.root, 'exports'))).toContain('.tmp-unrelated')
})
it('deleting a project removes its working copies but preserves sources, other projects and completed downloads', async () => {
  const x = await setup()
  const original = join(x.root, 'original.txt')
  await writeFile(original, 'source stays')
  const before = await readFile(original)
  const preview = await x.delivery.prepare(x.p.id, x.input())
  await x.delivery.export(x.p.id, preview.id)
  const zip = (await x.delivery.download(x.p.id, preview.id, 'zip')).bytes
  const staged = await x.materials.stageUpload(x.p.id, '未导入.txt', Buffer.from('private'))
  const other = await x.materials.createProject({name:'另一个',recipient:'',goal:'保留'})
  await (x.materials as any).deleteProject(x.p.id, x.input().expectedRevision)
  expect(() => x.materials.getProject(x.p.id)).toThrow()
  expect(x.materials.listProjects().map(p=>p.id)).toEqual([other.id])
  expect(await readdir(join(x.root, 'snapshots'))).not.toContain(x.file.id)
  expect(await readdir(join(x.root, 'staging'))).not.toContain(staged.token)
  expect(await readFile(original)).toEqual(before)
  expect((await x.delivery.download(x.p.id, preview.id, 'zip')).bytes).toEqual(zip)
  expect((await x.delivery.history())[0].available).toBe(true)
  await expect(x.materials.importSelection(other.id, staged.token, {expectedRevision:1,role:'reference',encoding:'utf-8'})).rejects.toMatchObject({code:'INVALID_SELECTION'})
})
it('project deletion rejects old revisions and active work without removing snapshots', async () => {
  const x=await setup()
  await expect((x.materials as any).deleteProject(x.p.id,1)).rejects.toMatchObject({code:'REVISION_CONFLICT'})
  const run=await x.materials.reserveRun(x.p.id,x.input().expectedRevision)
  await expect((x.materials as any).deleteProject(x.p.id,x.input().expectedRevision)).rejects.toMatchObject({code:'RUNTIME_BUSY'})
  expect(await readFile(join(x.root,'snapshots',x.file.id))).toEqual(Buffer.from('活动方案：<script>alert(1)</script>'))
  await x.materials.endRun(x.p.id,run,'interrupted')
})

it('database deletion failure rolls back project records and preserves snapshot bytes',async()=>{
  const x=await setup(),file=join(x.root,'snapshots',x.file.id),before=await readFile(file)
  const db=new DatabaseSync(join(x.root,'shouwei.sqlite'))
  db.exec("CREATE TRIGGER deny_deletion BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT,'injected disk transaction failure'); END")
  try {
    await expect(x.materials.deleteProject(x.p.id,x.input().expectedRevision)).rejects.toThrow()
    expect(x.materials.getProject(x.p.id).files[0].id).toBe(x.file.id)
    expect(await readFile(file)).toEqual(before)
    expect((await readdir(join(x.root,'.deletions'))).filter(n=>n.endsWith('.json'))).toEqual([])
  }finally{db.exec('DROP TRIGGER deny_deletion');db.close()}
})
it('interrupted deletion cleanup retries only its owned snapshots after restart recovery',async()=>{
  const x=await setup(),file=join(x.root,'snapshots',x.file.id)
  await rm(file);await mkdir(file);await writeFile(join(file,'obstruction'),'keeps cleanup from finishing')
  const result=await x.materials.deleteProject(x.p.id,x.input().expectedRevision)
  expect(result).toEqual({deleted:true,cleanupPending:true})
  expect((await readdir(join(x.root,'.deletions'))).filter(n=>n.endsWith('.json'))).toHaveLength(1)
  const outside=join(x.root,'unrelated.txt');await writeFile(outside,'keep')
  await rm(file,{recursive:true});await writeFile(file,'pending copy')
  await x.materials.recoverInterrupted()
  expect(await readdir(join(x.root,'snapshots'))).not.toContain(x.file.id)
  expect((await readdir(join(x.root,'.deletions'))).filter(n=>n.endsWith('.json'))).toEqual([])
  expect(await readFile(outside,'utf8')).toBe('keep')
})
it('truncated deletion journal never blocks startup recovery or removes a still-existing project',async()=>{
  const x=await setup(),before=await readFile(join(x.root,'snapshots',x.file.id))
  await mkdir(join(x.root,'.deletions'),{recursive:true})
  await writeFile(join(x.root,'.deletions',x.p.id+'.json'),'{"projectId":')
  await expect(x.materials.recoverInterrupted()).resolves.toBeUndefined()
  expect(x.materials.getProject(x.p.id).files[0].id).toBe(x.file.id)
  expect(await readFile(join(x.root,'snapshots',x.file.id))).toEqual(before)
  expect(x.materials.diagnosticsCounts()).toMatchObject({cleanupPending:true})
})
it('persistent cleanup obstruction remains pending without blocking other project recovery',async()=>{
  const x=await setup(),file=join(x.root,'snapshots',x.file.id)
  await rm(file);await mkdir(file);await writeFile(join(file,'obstruction'),'cannot unlink directory')
  const other=await x.materials.createProject({name:'unrelated',recipient:'',goal:'keep'})
  await x.materials.deleteProject(x.p.id,x.input().expectedRevision)
  await expect(x.materials.recoverInterrupted()).resolves.toBeUndefined()
  expect(x.materials.getProject(other.id).project.name).toBe('unrelated')
  expect(x.materials.diagnosticsCounts()).toMatchObject({cleanupPending:true})
})
