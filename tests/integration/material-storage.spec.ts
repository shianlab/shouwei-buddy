import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, symlink, chmod, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { MaterialService } from '../../packages/core/src/index.js'
const roots: string[] = []
const services: MaterialService[] = []
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'shouwei-storage-'))
  roots.push(root)
  const service = new MaterialService(root)
  services.push(service)
  return { root, service }
}
afterEach(async () => {
  for (const s of services.splice(0)) s.close()
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})
const input = { name: '真实材料', recipient: '活动负责人', goal: '核对日期和预算' }
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
it.each([false, true])(
  'reimport restores a corrupt snapshot without changing history (replace=%s)',
  async (replace) => {
    const { root, service } = await setup()
    const p = await service.createProject(input)
    const bytes = Buffer.from('原件😀')
    const first = await service.stageUpload(p.id, '材料.txt', bytes)
    const original = await service.importSelection(p.id, first.token, {
      expectedRevision: 1,
      role: 'deliverable',
      encoding: 'utf-8',
    })
    const path = join(root, 'snapshots', original.file.id)
    await chmod(path, 0o600)
    await writeFile(path, '损坏内容')
    const failed = await service.parseSnapshot(
      p.id,
      original.file.id,
      original.project.revision,
    )
    expect(failed.gaps[0]?.code).toBe('SNAPSHOT_CHANGED')
    const again = await service.stageUpload(p.id, '材料.txt', bytes)
    const restored = await service.importSelection(p.id, again.token, {
      expectedRevision: failed.project.revision,
      role: 'deliverable',
      encoding: 'utf-8',
      ...(replace ? { logicalFileId: original.file.logicalFileId } : {}),
    })
    expect(restored.duplicate).toBe(false)
    expect(restored.file.id).not.toBe(original.file.id)
    expect(restored.file.version).toBe(replace ? 2 : 1)
    const parsed = await service.parseSnapshot(
      p.id,
      restored.file.id,
      restored.project.revision,
    )
    expect(parsed.blocks.find((b) => b.fileSnapshotId === restored.file.id)?.text).toBe(
      '原件😀',
    )
    expect(await readFile(path, 'utf8')).toBe('损坏内容')
    const repeated = await service.stageUpload(p.id, '材料.txt', bytes)
    const deduped = await service.importSelection(p.id, repeated.token, {
      expectedRevision: parsed.project.revision,
      role: 'deliverable',
      encoding: 'utf-8',
    })
    expect(deduped.duplicate).toBe(true)
    expect(deduped.file.id).toBe(restored.file.id)
  },
)
it('persists projects and events across restart and rejects stale revisions', async () => {
  const { root, service } = await setup()
  const p = await service.createProject(input)
  await service.updateProject(p.id, p.revision, { ...input, name: '新名字' })
  await expect(service.updateProject(p.id, p.revision, input)).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  })
  service.close()
  const reopened = new MaterialService(root)
  services.push(reopened)
  expect(reopened.getProject(p.id).project.name).toBe('新名字')
  expect(reopened.getProject(p.id).project.revision).toBe(2)
  expect(reopened.getProject(p.id).events.map((e) => e.sequence)).toEqual([1, 2])
})
it('source bytes never change; case and Unicode colliding filenames get separate immutable IDs', async () => {
  const { root, service } = await setup()
  const p = await service.createProject(input)
  const source = join(root, 'source.txt')
  await writeFile(source, '原文😀')
  const before = await readFile(source)
  let revision = p.revision
  for (const name of ['A.txt', 'a.txt', 'é.txt', 'é.txt']) {
    const selection = await service.stageUpload(p.id, name, before)
    const result = await service.importSelection(p.id, selection.token, {
      expectedRevision: revision,
      role: 'deliverable',
      encoding: 'utf-8',
    })
    revision = result.project.revision
  }
  const detail = service.getProject(p.id)
  expect(detail.files).toHaveLength(4)
  expect(new Set(detail.files.map((f) => f.id)).size).toBe(4)
  expect(hash(await readFile(source))).toBe(hash(before))
  expect(detail.files.every((f) => f.sha256 === hash(before))).toBe(true)
})
it('tokens are project-bound and single-use; duplicate import does not grow snapshots', async () => {
  const { service } = await setup()
  const p = await service.createProject(input)
  const other = await service.createProject(input)
  const selected = await service.stageUpload(p.id, '材料.md', Buffer.from('text'))
  await expect(
    service.importSelection(other.id, selected.token, {
      expectedRevision: 1,
      role: 'reference',
      encoding: 'utf-8',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_SELECTION' })
  await service.importSelection(p.id, selected.token, {
    expectedRevision: 1,
    role: 'reference',
    encoding: 'utf-8',
  })
  await expect(
    service.importSelection(p.id, selected.token, {
      expectedRevision: 2,
      role: 'reference',
      encoding: 'utf-8',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_SELECTION' })
  const again = await service.stageUpload(p.id, '材料.md', Buffer.from('text'))
  const result = await service.importSelection(p.id, again.token, {
    expectedRevision: 2,
    role: 'reference',
    encoding: 'utf-8',
  })
  expect(result.duplicate).toBe(true)
  expect(service.getProject(p.id).files).toHaveLength(1)
})
it('rejects AppleDouble, traversal and oversized inputs before persistence', async () => {
  const { service } = await setup()
  const p = await service.createProject(input)
  for (const name of ['._foo.txt', '../foo.txt', 'a/b.txt', 'C:\\a.txt'])
    await expect(service.stageUpload(p.id, name, Buffer.from('x'))).rejects.toMatchObject({
      code: 'INVALID_FILE',
    })
  await expect(
    service.stageUpload(p.id, 'huge.txt', Buffer.alloc(20 * 1024 * 1024 + 1)),
  ).rejects.toMatchObject({ code: 'FILE_LIMIT' })
  expect(service.getProject(p.id).files).toHaveLength(0)
})
it('detects changed staged bytes and symlink replacement without importing them', async () => {
  const { service, root } = await setup()
  const p = await service.createProject(input)
  const first = await service.stageUpload(p.id, 'a.txt', Buffer.from('first'))
  await writeFile(join(root, 'staging', first.token), 'changed')
  await expect(
    service.importSelection(p.id, first.token, {
      expectedRevision: 1,
      role: 'deliverable',
      encoding: 'utf-8',
    }),
  ).rejects.toMatchObject({ code: 'SNAPSHOT_CHANGED' })
  const second = await service.stageUpload(p.id, 'b.txt', Buffer.from('safe'))
  const outside = join(root, 'outside.txt')
  await writeFile(outside, 'private')
  await rm(join(root, 'staging', second.token))
  await symlink(outside, join(root, 'staging', second.token))
  await expect(
    service.importSelection(p.id, second.token, {
      expectedRevision: 1,
      role: 'deliverable',
      encoding: 'utf-8',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_FILE' })
})
it('only one concurrent edit wins and only one active run can be reserved', async () => {
  const { service } = await setup()
  const p = await service.createProject(input)
  const edits = await Promise.allSettled([
    service.updateProject(p.id, 1, { ...input, name: '甲' }),
    service.updateProject(p.id, 1, { ...input, name: '乙' }),
  ])
  expect(edits.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  const run = await service.reserveRun(p.id, 2)
  await expect(service.reserveRun(p.id, 2)).rejects.toMatchObject({ code: 'RUNTIME_BUSY' })
  await expect(service.updateProject(p.id, 2, input)).rejects.toMatchObject({
    code: 'RUNTIME_BUSY',
  })
  await service.endRun(p.id, run, 'interrupted')
  expect(service.getProject(p.id).project.activeRunId).toBe(null)
})
it('snapshot versions retain previous bytes and count limits reject the 31st file', async () => {
  const { service } = await setup()
  const p = await service.createProject(input)
  let revision = 1
  for (let i = 0; i < 30; i++) {
    const s = await service.stageUpload(p.id, `材料${i}.txt`, Buffer.from(String(i)))
    revision = (
      await service.importSelection(p.id, s.token, {
        expectedRevision: revision,
        role: 'deliverable',
        encoding: 'utf-8',
      })
    ).project.revision
  }
  const more = await service.stageUpload(p.id, 'extra.txt', Buffer.from('extra'))
  await expect(
    service.importSelection(p.id, more.token, {
      expectedRevision: revision,
      role: 'deliverable',
      encoding: 'utf-8',
    }),
  ).rejects.toMatchObject({ code: 'FILE_LIMIT' })
})
it('failed migrations preserve the original schema and project records', async () => {
  const { root, service } = await setup()
  const p = await service.createProject(input)
  service.close()
  const { migrate } = await import('../../packages/core/src/storage.js')
  const db = new DatabaseSync(join(root, 'shouwei.sqlite'))
  expect(() =>
    migrate(db, [
      { version: 5, sql: 'ALTER TABLE projects ADD COLUMN temporary TEXT; INVALID SQL;' },
    ]),
  ).toThrow()
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(4)
  expect(db.prepare('SELECT name FROM projects WHERE id=?').get(p.id)?.name).toBe(input.name)
  expect(
    db
      .prepare('PRAGMA table_info(projects)')
      .all()
      .some((c) => c.name === 'temporary'),
  ).toBe(false)
  db.close()
})
it('schema 1 upgrades with its project intact and an independently readable pre-migration backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shouwei-upgrade-'))
  roots.push(root)
  const { migrate, migrations } = await import('../../packages/core/src/storage.js')
  const legacy = new DatabaseSync(join(root, 'shouwei.sqlite'))
  migrate(legacy, [migrations[0]!])
  const id = 'b980fb94-601a-42d7-9185-98b2ac73913b'
  const time = new Date().toISOString()
  legacy.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)').run(id, input.name, input.recipient, input.goal, 1, null, time, time)
  legacy.close()
  const upgraded = new MaterialService(root)
  services.push(upgraded)
  expect(upgraded.getProject(id).project.name).toBe(input.name)
  expect(upgraded.getWorkflow(id).requirements).toEqual([])
  await upgraded.editWorkflow(id, 1, w => { w.selectedSnapshotIds = [] })
  const backups = (await readdir(root)).filter(name => name.startsWith('backup-before-v4-'))
  expect(backups).toHaveLength(1)
  const backup = new DatabaseSync(join(root, backups[0]!), { readOnly: true })
  try {
    expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1)
    expect(backup.prepare('SELECT name,revision FROM projects WHERE id=?').get(id)).toMatchObject({name: input.name, revision: 1})
  } finally {
    backup.close()
  }
})
it('schema 2 workflows survive the schema 4 delivery migration and its backup', async () => {
  const root=await mkdtemp(join(tmpdir(),'shouwei-v2-upgrade-'));roots.push(root)
  const {migrate,migrations}=await import('../../packages/core/src/storage.js')
  const {emptyWorkflow}=await import('@shouwei/contracts')
  const db=new DatabaseSync(join(root,'shouwei.sqlite'))
  migrate(db,migrations.slice(0,2))
  const id='d96970d6-5642-40fa-9bc2-5186b89bb8f6',time=new Date().toISOString()
  db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)').run(id,input.name,input.recipient,input.goal,5,null,time,time)
  const workflow=emptyWorkflow();workflow.requirementsVersion=7
  db.prepare('INSERT INTO workflows VALUES (?,?)').run(id,JSON.stringify(workflow));db.close()
  const service=new MaterialService(root);services.push(service)
  expect(service.getWorkflow(id).requirementsVersion).toBe(7)
  expect(service.listDeliveries()).toEqual([])
  const name=(await readdir(root)).find(n=>n.startsWith('backup-before-v4-'))!
  const backup=new DatabaseSync(join(root,name),{readOnly:true})
  try {expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(2);expect(JSON.parse(String(backup.prepare('SELECT json FROM workflows WHERE projectId=?').get(id)?.json)).requirementsVersion).toBe(7)}finally{backup.close()}
})
it('real parsing persists anchors after restart and new versions retain old snapshots', async () => {
  const { root, service } = await setup()
  const p = await service.createProject(input)
  let s = await service.stageUpload(p.id, '材料.md', Buffer.from('第一行\n日期😀'))
  const first = await service.importSelection(p.id, s.token, {
    expectedRevision: 1,
    role: 'requirement',
    encoding: 'utf-8',
  })
  let detail = await service.parseSnapshot(p.id, first.file.id, first.project.revision)
  expect(detail.blocks[1]?.text).toBe('日期😀')
  expect(detail.files[0]?.parseStatus).toBe('complete')
  s = await service.stageUpload(p.id, '材料.md', Buffer.from('第二版'))
  const second = await service.importSelection(p.id, s.token, {
    expectedRevision: detail.project.revision,
    role: 'requirement',
    encoding: 'utf-8',
    logicalFileId: first.file.logicalFileId,
  })
  expect(second.file.version).toBe(2)
  expect(second.file.id).not.toBe(first.file.id)
  service.close()
  const reopened = new MaterialService(root)
  services.push(reopened)
  detail = reopened.getProject(p.id)
  expect(detail.files).toHaveLength(2)
  expect(detail.blocks[1]?.text).toBe('日期😀')
})
it('project aggregate codepoint budget includes previously parsed files', async () => {
  const { service } = await setup()
  const p = await service.createProject(input)
  let revision = 1
  for (const [name, text] of [
    ['one.txt', '字'.repeat(199999)],
    ['two.txt', '三个字'],
  ]) {
    const s = await service.stageUpload(p.id, name!, Buffer.from(text!))
    const imported = await service.importSelection(p.id, s.token, {
      expectedRevision: revision,
      role: 'deliverable',
      encoding: 'utf-8',
    })
    revision = (await service.parseSnapshot(p.id, imported.file.id, imported.project.revision))
      .project.revision
  }
  const detail = service.getProject(p.id)
  expect(detail.blocks.reduce((sum, b) => sum + Array.from(b.text).length, 0)).toBe(200000)
  expect(detail.gaps.some((g) => g.code === 'TEXT_LIMIT')).toBe(true)
})
it('project total byte limit rejects the sixth 20 MiB snapshot', async () => {
  const { service } = await setup()
  const p = await service.createProject(input)
  let revision = 1
  const bytes = Buffer.alloc(20 * 1024 * 1024, 65)
  for (let i = 0; i < 5; i++) {
    const s = await service.stageUpload(p.id, `大文件${i}.txt`, bytes)
    revision = (
      await service.importSelection(p.id, s.token, {
        expectedRevision: revision,
        role: 'reference',
        encoding: 'utf-8',
      })
    ).project.revision
  }
  const s = await service.stageUpload(p.id, '超额.txt', bytes)
  await expect(
    service.importSelection(p.id, s.token, {
      expectedRevision: revision,
      role: 'reference',
      encoding: 'utf-8',
    }),
  ).rejects.toMatchObject({ code: 'FILE_LIMIT' })
  expect(service.getProject(p.id).files).toHaveLength(5)
})
it('expired selections are rejected and interrupted runs recover on server restart', async () => {
  const { service, root } = await setup()
  const p = await service.createProject(input)
  const { vi } = await import('vitest')
  const selected = await service.stageUpload(p.id, 'x.txt', Buffer.from('x'))
  const realNow = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(realNow + 11 * 60 * 1000)
  try {
    await expect(
      service.importSelection(p.id, selected.token, {
        expectedRevision: 1,
        role: 'reference',
        encoding: 'utf-8',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SELECTION' })
  } finally {
    vi.restoreAllMocks()
  }
  await service.reserveRun(p.id, 1)
  service.close()
  const reopened = new MaterialService(root)
  services.push(reopened)
  await reopened.recoverInterrupted()
  expect(reopened.getProject(p.id).project.activeRunId).toBe(null)
  expect(reopened.getProject(p.id).events.at(-1)?.type).toBe('parse_interrupted')
})

it('schema 3 delivery records remain byte-identical after upgrade with a readable schema 3 backup',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shouwei-v3-'));roots.push(root)
  const {migrate,migrations}=await import('../../packages/core/src/storage.js')
  const legacy=new DatabaseSync(join(root,'shouwei.sqlite'));migrate(legacy,migrations.slice(0,3))
  const id='5a305982-c1e0-45ed-9cc1-e08d472cd65e',time=new Date().toISOString()
  legacy.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)').run(id,'旧项目','','交付',1,null,time,time)
  const raw=JSON.stringify({id:'afcf3809-07e5-4d57-986e-413656c9e716',projectId:id,state:'completed',note:'旧交付记录'})
  legacy.prepare('INSERT INTO deliveries VALUES (?,?,?)').run('afcf3809-07e5-4d57-986e-413656c9e716',id,raw);legacy.close()
  const current=new MaterialService(root);services.push(current)
  expect(current.diagnosticsCounts().schema).toBe(4)
  expect(current.listDeliveries()).toEqual([JSON.parse(raw)])
  const backup=(await readdir(root)).find(n=>n.startsWith('backup-before-v4-'))!
  const db=new DatabaseSync(join(root,backup),{readOnly:true})
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(3)
  expect(db.prepare('SELECT json FROM deliveries').get()?.json).toBe(raw);db.close()
})
