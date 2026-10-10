import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
import { realpathSync } from 'node:fs'
import { mkdir, readdir, unlink, rm, lstat, realpath, rename, open } from 'node:fs/promises'
import { z } from 'zod'
import {
  emptyWorkflow,
  type CheckWorkflow,
  ProjectInputSchema,
  ImportOptionsSchema,
  type ProjectInput,
  type Project,
  type ProjectDetail,
  type AuditEvent,
  type FileSnapshot,
  type ImportOptions,
  type ImportResult,
  type ParseResult,
  type DeliveryRecord,
} from '@shouwei/contracts'
import { openDatabase } from './storage.js'
import { SnapshotStore, safeRead } from './files.js'
import { fail, MaterialError } from './errors.js'
import { parseIsolated } from './parsers/process.js'
export class MaterialService {
  private readonly db
  private readonly store: SnapshotStore
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private cleanupPending = false
  constructor(root: string) {
    const absolute = resolve(root)
    this.db = openDatabase(absolute)
    this.store = new SnapshotStore(realpathSync(absolute))
  }
  close() {
    if (!this.closed) {
      this.db.close()
      this.closed = true
    }
  }
  async idle() {
    await this.queue
  }
  getWorkflow(id: string): CheckWorkflow {
    this.project(id)
    const row = this.db.prepare('SELECT json FROM workflows WHERE projectId=?').get(id)
    return row ? (JSON.parse(String(row.json)) as CheckWorkflow) : emptyWorkflow()
  }
  private saveWorkflow(id: string, value: CheckWorkflow) {
    this.db
      .prepare(
        'INSERT INTO workflows VALUES (?,?) ON CONFLICT(projectId) DO UPDATE SET json=excluded.json',
      )
      .run(id, JSON.stringify(value))
  }
  editWorkflow(id: string, revision: number, edit: (value: CheckWorkflow) => void) {
    return this.write(() =>
      this.transaction(() => {
        this.assertWritable(id, revision)
        const value = this.getWorkflow(id)
        edit(value)
        this.saveWorkflow(id, value)
        this.bump(id)
        this.event(id, 'review_updated')
        return this.project(id)
      }),
    )
  }
  startWorkflow(
    id: string,
    revision: number,
    edit: (value: CheckWorkflow, runId: string) => void,
  ) {
    return this.write(() =>
      this.transaction(() => {
        this.assertWritable(id, revision)
        const runId = randomUUID(),
          value = this.getWorkflow(id)
        edit(value, runId)
        this.db
          .prepare('INSERT INTO runs VALUES (?,?,?,?)')
          .run(runId, id, revision, 'running')
        this.db.prepare('UPDATE projects SET activeRunId=? WHERE id=?').run(runId, id)
        this.saveWorkflow(id, value)
        this.event(id, 'model_started', { runId })
        return runId
      }),
    )
  }
  checkpoint(
    id: string,
    runId: string,
    edit: (value: CheckWorkflow) => void,
    event: string,
    terminal?: string,
  ) {
    return this.write(() =>
      this.transaction(() => {
        if (this.project(id).activeRunId !== runId)
          fail('REVISION_CONFLICT', '检查任务已变更。')
        const value = this.getWorkflow(id)
        edit(value)
        this.saveWorkflow(id, value)
        if (terminal && terminal !== 'stop_unconfirmed') {
          this.db.prepare('UPDATE runs SET state=? WHERE id=?').run(terminal, runId)
          this.db.prepare('UPDATE projects SET activeRunId=NULL WHERE id=?').run(id)
        }
        this.event(id, event, { runId })
      }),
    )
  }
  async verifySnapshots(id: string, ids: string[]) {
    const files = this.getProject(id).files
    for (const snapshotId of ids) {
      const file = files.find((f) => f.id === snapshotId)
      if (!file) fail('INVALID_FILE', '选定材料不属于此项目。')
      await this.store.read(file.id, file.sha256)
    }
  }
  getDelivery(projectId: string, id: string): DeliveryRecord {
    const row = this.db
      .prepare('SELECT json FROM deliveries WHERE id=? AND projectId=?')
      .get(id, projectId)
    if (!row) fail('NOT_FOUND', '没有找到这份交付记录。')
    return JSON.parse(String(row.json)) as DeliveryRecord
  }
  listDeliveries(): DeliveryRecord[] {
    return this.db
      .prepare('SELECT json FROM deliveries ORDER BY rowid DESC')
      .all()
      .map((row) => JSON.parse(String(row.json)) as DeliveryRecord)
  }
  private saveDelivery(record: DeliveryRecord) {
    this.db
      .prepare(
        'INSERT INTO deliveries VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',
      )
      .run(record.id, record.projectId, JSON.stringify(record))
  }
  prepareDeliveryRecord(
    projectId: string,
    revision: number,
    create: () => DeliveryRecord,
    persist = true,
  ) {
    return this.write(() =>
      this.transaction(() => {
        this.assertWritable(projectId, revision)
        const record = create()
        if (persist) {
          this.saveDelivery(record)
          this.event(projectId, 'delivery_prepared', { deliveryId: record.id })
        }
        return record
      }),
    )
  }
  exportDeliveryRecord(
    projectId: string,
    id: string,
    perform: (
      record: DeliveryRecord,
      read: (fileId: string) => Promise<Buffer>,
      persist: () => void,
    ) => Promise<DeliveryRecord>,
  ) {
    return this.write(async () => {
      const record = this.getDelivery(projectId, id)
      if (record.state === 'completed') return record
      this.assertWritable(projectId, record.inputRevision)
      if (record.state !== 'preparing')
        fail('INVALID_INPUT', '这次导出已结束，请重新预览后再导出。')
      const files = this.getProject(projectId).files
      const persist = () =>
        this.transaction(() => {
          this.saveDelivery(record)
          this.event(projectId, 'delivery_state', { deliveryId: id, state: record.state })
        })
      return perform(
        record,
        async (fileId) => {
          const file = files.find((f) => f.id === fileId)
          if (!file) fail('INVALID_FILE', '交付材料不属于本项目。')
          return this.store.read(file.id, file.sha256)
        },
        persist,
      )
    })
  }
  private write<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(fn)
    this.queue = next.catch(() => {})
    return next
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  private project(id: string): Project {
    const row = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id)
    if (!row) fail('NOT_FOUND', '没有找到这个项目。')
    return row as unknown as Project
  }
  private assertWritable(id: string, revision: number) {
    const p = this.project(id)
    if (p.revision !== revision)
      fail('REVISION_CONFLICT', '材料已在另一个页面更新，请刷新后重试。', true)
    if (p.activeRunId) fail('RUNTIME_BUSY', '正在读取材料，请完成后再修改。', true)
    return p
  }
  private event(projectId: string, type: string, payload: Record<string, unknown> = {}) {
    this.db
      .prepare(
        'INSERT INTO events VALUES (?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM events WHERE projectId=?),?,?,1,?)',
      )
      .run(
        randomUUID(),
        projectId,
        projectId,
        type,
        new Date().toISOString(),
        JSON.stringify(payload),
      )
  }
  private bump(id: string) {
    this.db
      .prepare('UPDATE projects SET revision=revision+1,updatedAt=? WHERE id=?')
      .run(new Date().toISOString(), id)
  }
  listProjects(): Project[] {
    return this.db
      .prepare('SELECT * FROM projects ORDER BY updatedAt DESC,id')
      .all() as unknown as Project[]
  }
  diagnosticsCounts() {
    const count = (table: string) => Number(this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)
    return { schema: Number(this.db.prepare('PRAGMA user_version').get()?.user_version), projects: count('projects'), snapshots: count('files'), deliveries: count('deliveries'), activeRuns: this.listProjects().filter(p=>p.activeRunId).length, cleanupPending: this.cleanupPending }
  }
  async deleteProject(id: string, revision: number) {
    return this.write(async () => {
      this.assertWritable(id, revision)
      const snapshotIds = this.getProject(id).files.map(f => f.id)
      const directory = join(this.store.root, '.deletions')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      if (await realpath(directory) !== directory) fail('INVALID_FILE', '清理目录不能是符号链接。')
      const journal = join(directory, `${id}.json`)
      const temporary = journal + '.' + randomUUID() + '.tmp'
      try {
        const handle = await open(temporary, 'wx', 0o600)
        try { await handle.writeFile(JSON.stringify({ projectId: id, snapshotIds })); await handle.sync() }
        finally { await handle.close() }
        // A prior pending record is never silently overwritten.
        try { await lstat(journal); fail('INVALID_FILE', '上次清理记录仍待处理，请重启后查看本地数据提示。') }
        catch(error) { if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        await rename(temporary, journal)
      } finally { await unlink(temporary).catch(() => {}) }
      try {
        this.transaction(() => {
          this.db.prepare('DELETE FROM parses WHERE fileId IN (SELECT id FROM files WHERE projectId=?)').run(id)
          for (const table of ['files', 'workflows', 'runs', 'events'])
            this.db.prepare(`DELETE FROM ${table} WHERE projectId=?`).run(id)
          this.db.prepare("DELETE FROM deliveries WHERE projectId=? AND json_extract(json,'$.state')!='completed'").run(id)
          this.db.prepare('DELETE FROM projects WHERE id=?').run(id)
        })
      } catch (error) {
        await unlink(journal).catch(() => {})
        throw error
      }
      let cleanupPending = false
      try {
        await this.store.removeProjectSelections(id)
        await this.cleanDeletion(journal)
      } catch { cleanupPending = true; this.cleanupPending = true }
      return { deleted: true, cleanupPending }
    })
  }
  private async cleanDeletion(path: string) {
    const directory = join(this.store.root, '.deletions')
    if (await realpath(directory) !== directory || !(await lstat(path)).isFile())
      fail('INVALID_FILE', '清理记录无效。')
    const entry = z.object({ projectId: z.uuid(), snapshotIds: z.array(z.uuid()).max(30) }).strict().parse(JSON.parse((await safeRead(path,directory,16384)).toString()))
    if(path !== join(directory,entry.projectId+'.json')) fail('INVALID_FILE','清理记录与项目不匹配。')
    if (this.db.prepare('SELECT id FROM projects WHERE id=?').get(entry.projectId)) {
      await unlink(path)
      return
    }
    await this.store.initialize()
    for (const id of entry.snapshotIds) {
      if (this.db.prepare('SELECT id FROM files WHERE id=?').get(id)) continue
      await unlink(join(this.store.snapshots, id)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
    await unlink(path)
  }
  private async cleanInterruptedExports() {
    const root = join(this.store.root, 'exports')
    try {
      if (await realpath(root) !== root) return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    const pattern = new RegExp(`^\\.tmp-(${uuid})-${uuid}$`)
    const interrupted = new Set(this.listDeliveries().filter(d => ['writing','verifying','failed','cancelled','completed'].includes(d.state)).map(d=>d.id))
    for (const name of await readdir(root)) {
      const match = pattern.exec(name)
      if (!match || !interrupted.has(match[1])) continue
      const path = join(root, name), stat = await lstat(path)
      if (stat.isDirectory() && !stat.isSymbolicLink()) await rm(path, {recursive:true})
    }
  }
  getProject(id: string): ProjectDetail {
    const project = this.project(id)
    const files = this.db
      .prepare('SELECT * FROM files WHERE projectId=? ORDER BY createdAt,id')
      .all(id) as unknown as FileSnapshot[]
    const parsed = this.db
      .prepare(
        'SELECT json FROM parses JOIN files ON files.id=parses.fileId WHERE files.projectId=?',
      )
      .all(id)
      .map((row) => JSON.parse(String(row.json)) as ParseResult)
    const events = this.db
      .prepare('SELECT * FROM events WHERE projectId=? ORDER BY sequence')
      .all(id)
      .map((row) => ({
        ...row,
        payload: JSON.parse(String(row.payload)),
      })) as unknown as AuditEvent[]
    return {
      project,
      files,
      blocks: parsed.flatMap((p) => p.blocks),
      gaps: parsed.flatMap((p) => p.gaps),
      events,
    }
  }
  createProject(input: ProjectInput) {
    return this.write(() => {
      const data = ProjectInputSchema.parse(input)
      return this.transaction(() => {
        const id = randomUUID(),
          now = new Date().toISOString()
        this.db
          .prepare('INSERT INTO projects VALUES (?,?,?,?,1,NULL,?,?)')
          .run(id, data.name, data.recipient, data.goal, now, now)
        this.event(id, 'project_created')
        return this.project(id)
      })
    })
  }
  updateProject(id: string, revision: number, input: ProjectInput) {
    return this.write(() => {
      const data = ProjectInputSchema.parse(input)
      return this.transaction(() => {
        this.assertWritable(id, revision)
        this.db
          .prepare('UPDATE projects SET name=?,recipient=?,goal=? WHERE id=?')
          .run(data.name, data.recipient, data.goal, id)
        this.bump(id)
        this.event(id, 'project_updated')
        return this.project(id)
      })
    })
  }
  stageUpload(projectId: string, name: string, bytes: Uint8Array) {
    return this.write(() => {
      this.project(projectId)
      return this.store.stage(projectId, name, bytes)
    })
  }
  importSelection(
    projectId: string,
    token: string,
    input: ImportOptions,
  ): Promise<ImportResult> {
    return this.write(async () => {
      const options = ImportOptionsSchema.parse(input)
      this.assertWritable(projectId, options.expectedRevision)
      const staged = await this.store.consume(projectId, token)
      const detail = this.getProject(projectId)
      const prior = options.logicalFileId
        ? detail.files
            .filter((f) => f.logicalFileId === options.logicalFileId)
            .sort((a, b) => b.version - a.version)[0]
        : undefined
      if (options.logicalFileId && !prior)
        fail('INVALID_FILE', '待更新的材料版本不属于此项目。')
      const candidates = detail.files.filter(
        (f) =>
          f.originalName === staged.name &&
          f.sha256 === staged.sha256 &&
          f.role === options.role &&
          f.encoding === options.encoding &&
          (!prior || f.id === prior.id),
      )
      for (const duplicate of candidates) {
        try {
          await this.store.read(duplicate.id, duplicate.sha256)
          return { project: detail.project, file: duplicate, duplicate: true }
        } catch {
          // Keep damaged history; a fresh immutable copy lets reimport recover it.
        }
      }
      if (
        detail.files.length >= 30 ||
        detail.files.reduce((n, f) => n + f.bytes, 0) + staged.bytes > 100 * 1024 * 1024
      )
        fail('FILE_LIMIT', '项目最多保存 30 份快照、总计 100 MiB。')
      const id = randomUUID()
      await this.store.save(id, staged.content)
      try {
        return this.transaction(() => {
          this.assertWritable(projectId, options.expectedRevision)
          const file: FileSnapshot = {
            id,
            projectId,
            logicalFileId: prior?.logicalFileId ?? randomUUID(),
            version: (prior?.version ?? 0) + 1,
            role: options.role,
            originalName: staged.name,
            sha256: staged.sha256,
            bytes: staged.bytes,
            encoding: options.encoding,
            parseStatus: 'queued',
            createdAt: new Date().toISOString(),
          }
          this.db
            .prepare('INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            .run(
              file.id,
              file.projectId,
              file.logicalFileId,
              file.version,
              file.role,
              file.originalName,
              file.sha256,
              file.bytes,
              file.encoding,
              file.parseStatus,
              file.createdAt,
            )
          this.bump(projectId)
          this.event(projectId, 'file_imported', {
            snapshotId: id,
            sha256: file.sha256,
            version: file.version,
          })
          return { project: this.project(projectId), file, duplicate: false }
        })
      } catch (error) {
        await this.store.remove(id)
        throw error
      }
    })
  }
  reserveRun(projectId: string, revision: number) {
    return this.write(() =>
      this.transaction(() => {
        this.assertWritable(projectId, revision)
        const id = randomUUID()
        this.db
          .prepare('INSERT INTO runs VALUES (?,?,?,?)')
          .run(id, projectId, revision, 'running')
        this.db.prepare('UPDATE projects SET activeRunId=? WHERE id=?').run(id, projectId)
        this.event(projectId, 'parse_started', { runId: id })
        return id
      }),
    )
  }
  endRun(projectId: string, runId: string, state: 'completed' | 'failed' | 'interrupted') {
    return this.write(() =>
      this.transaction(() => {
        if (this.project(projectId).activeRunId !== runId)
          fail('INVALID_INPUT', '读取记录不匹配。')
        this.db
          .prepare('UPDATE runs SET state=? WHERE id=? AND projectId=?')
          .run(state, runId, projectId)
        this.db.prepare('UPDATE projects SET activeRunId=NULL WHERE id=?').run(projectId)
        this.event(projectId, `parse_${state}`, { runId })
      }),
    )
  }
  private parsing = 0
  async parseSnapshot(
    projectId: string,
    snapshotId: string,
    revision: number,
  ): Promise<ProjectDetail> {
    if (this.parsing >= 2) fail('RUNTIME_BUSY', '已有材料正在读取，请稍后重试。', true)
    const detail = this.getProject(projectId),
      file = detail.files.find((f) => f.id === snapshotId)
    if (!file) fail('NOT_FOUND', '没有找到本项目中的材料。')
    this.parsing++
    let runId: string | undefined
    try {
      runId = await this.reserveRun(projectId, revision)
      await this.write(() => {
        this.db.prepare("UPDATE files SET parseStatus='parsing' WHERE id=?").run(snapshotId)
      })
      let result: ParseResult
      try {
        const bytes = await this.store.read(snapshotId, file.sha256)
        const used = detail.blocks
          .filter((b) => b.fileSnapshotId !== snapshotId)
          .reduce((n, b) => n + Array.from(b.text).length, 0)
        result = await parseIsolated({
          snapshotId,
          name: file.originalName,
          bytes,
          encoding: file.encoding,
          maxCodePoints: Math.max(0, 200000 - used),
        })
      } catch (error) {
        result = {
          status: 'failed',
          blocks: [],
          gaps: [
            {
              id: randomUUID(),
              fileSnapshotId: snapshotId,
              code: error instanceof MaterialError ? error.code : 'PARSE_FAILED',
              reason:
                error instanceof MaterialError
                  ? error.userMessage
                  : '读取失败，原文件未修改。',
            },
          ],
        }
      }
      await this.write(() =>
        this.transaction(() => {
          this.db
            .prepare(
              'INSERT INTO parses VALUES (?,?) ON CONFLICT(fileId) DO UPDATE SET json=excluded.json',
            )
            .run(snapshotId, JSON.stringify(result))
          this.db
            .prepare('UPDATE files SET parseStatus=? WHERE id=?')
            .run(result.status, snapshotId)
          this.bump(projectId)
          this.event(projectId, 'file_parsed', {
            snapshotId,
            status: result.status,
            blockCount: result.blocks.length,
            gapCount: result.gaps.length,
          })
        }),
      )
      await this.endRun(projectId, runId, result.status === 'failed' ? 'failed' : 'completed')
      runId = undefined
      return this.getProject(projectId)
    } finally {
      if (runId) await this.endRun(projectId, runId, 'failed')
      this.parsing--
    }
  }
  async recoverInterrupted() {
    await this.store.cleanStaging()
    await this.cleanInterruptedExports()
    const cleanup = join(this.store.root, '.deletions')
    this.cleanupPending = false
    try {
      if (await realpath(cleanup) !== cleanup) this.cleanupPending = true
      else for (const name of await readdir(cleanup)) {
        if(name.includes('.invalid-')) { this.cleanupPending=true; continue }
        if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue
        const path=join(cleanup,name)
        try { await this.cleanDeletion(path) }
        catch(error) {
          this.cleanupPending=true
          // Invalid records retain their bytes for manual recovery, never drive deletion.
          if(error instanceof SyntaxError || error instanceof z.ZodError)
            await rename(path,path+'.invalid-'+randomUUID()).catch(()=>{})
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.cleanupPending=true
    }
    return this.write(() =>
      this.transaction(() => {
        for (const delivery of this.listDeliveries())
          if (['writing', 'verifying'].includes(delivery.state)) {
            delivery.state = 'failed'
            delivery.error = '应用曾在导出过程中退出，请重新预览；已有交付记录仍保留。'
            this.saveDelivery(delivery)
            this.event(delivery.projectId, 'delivery_interrupted', { deliveryId: delivery.id })
          }
        for (const p of this.listProjects())
          if (p.activeRunId) {
            this.db
              .prepare("UPDATE runs SET state='interrupted' WHERE id=?")
              .run(p.activeRunId)
            this.db.prepare('UPDATE projects SET activeRunId=NULL WHERE id=?').run(p.id)
            this.db
              .prepare(
                "UPDATE files SET parseStatus='queued' WHERE projectId=? AND parseStatus='parsing'",
              )
              .run(p.id)
            this.event(p.id, 'parse_interrupted')
            const workflow = this.getWorkflow(p.id)
            for (const run of workflow.runs)
              if (['running', 'cancelling', 'stop_unconfirmed'].includes(run.state)) {
                run.state = 'interrupted'
                run.endedAt = new Date().toISOString()
                run.coverageComplete = false
              }
            this.saveWorkflow(p.id, workflow)
          }
      }),
    )
  }
}
