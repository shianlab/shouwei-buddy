import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, writeFile, rename, rm, realpath, lstat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { zipSync, unzipSync, strToU8 } from 'fflate'
import {
  DeliveryInputSchema,
  type DeliveryRecord,
  type DeliveryHistoryItem,
} from '@shouwei/contracts'
import { MaterialService } from '../projects.js'
import { CheckService } from '../checks/service.js'
import { MaterialError, fail } from '../errors.js'
import { hash, safeRead } from '../files.js'
import { deliveryConclusion } from './conclusion.js'
import { deliveryDocuments } from './report.js'
export class DeliveryService {
  private root: string
  constructor(
    private materials: MaterialService,
    private checks: CheckService,
    dataDir: string,
    private io: { writeFile?: typeof writeFile } = {},
  ) {
    this.root = join(realpathSync(resolve(dataDir)), 'exports')
  }
  prepare(projectId: string, input: unknown, persist = true) {
    const data = DeliveryInputSchema.parse(input)
    return this.materials.prepareDeliveryRecord(
      projectId,
      data.expectedRevision,
      () => {
        const view = this.checks.view(projectId),
          run = view.workflow.runs.findLast((r) => r.kind === 'check')
        const assessment = deliveryConclusion(view, data.files, data.requirementRisks)
        const record: DeliveryRecord = {
          id: randomUUID(),
          projectId,
          projectName: view.project.name,
          recipient: view.project.recipient,
          runId: run?.id ?? null,
          inputRevision: view.project.revision,
          inputHash: run?.inputHash ?? null,
          createdAt: new Date().toISOString(),
          completedAt: null,
          state: 'preparing',
          assessment,
          files: data.files.map((f) => {
            const source = view.material.files.find((s) => s.id === f.snapshotId)
            if (!source) fail('INVALID_FILE', '附件不属于本项目。')
            return {
              snapshotId: source.id,
              logicalFileId: source.logicalFileId,
              version: source.version,
              name: f.name,
              sha256: source.sha256,
              bytes: source.bytes,
            }
          }),
          note: data.note,
          frozen: structuredClone(view),
          manifestHash: null,
          zipHash: null,
          reportHash: null,
          error: null,
        }
        return record
      },
      persist,
    )
  }
  async detail(projectId: string, id: string) {
    return this.materials.getDelivery(projectId, id)
  }
  async history(): Promise<DeliveryHistoryItem[]> {
    const items:DeliveryHistoryItem[]=[]
    for(const r of this.materials.listDeliveries().filter(r=>r.state==='completed')) {
      items.push({
          id: r.id,
          projectId: r.projectId,
          projectName: r.projectName,
          state: r.state,
          conclusion: r.assessment.conclusion,
          fileCount: r.files.length,
          createdAt: r.createdAt,
          completedAt: r.completedAt,
          modelName:
            r.frozen.workflow.runs.find((run) => run.id === r.runId)?.model.displayName ??
            '未知',
          available: await this.download(r.projectId, r.id, 'zip').then(
            () => true,
            () => false,
          ),
      })
    }
    return items
  }
  export(projectId: string, id: string, signal?: AbortSignal) {
    return this.materials.exportDeliveryRecord(
      projectId,
      id,
      async (record, read, persist) => {
        if (!['ready', 'ready_with_notes'].includes(record.assessment.conclusion))
          fail('INVALID_INPUT', '当前交付仍有阻塞项，请先处理。')
        const abort = () => {
          if (signal?.aborted) fail('CANCELLED', '这次导出已停止，可以重新预览。')
        }
        let temporary: string | undefined
        try {
          abort()
          const current = this.checks.view(projectId),
            latest = current.workflow.runs.findLast((r) => r.kind === 'check')
          if (
            current.stale ||
            latest?.id !== record.runId ||
            latest?.inputHash !== record.inputHash
          )
            fail('REVISION_CONFLICT', '检查结果已变化，请重新预览。')
          record.state = 'writing'
          persist()
          await mkdir(this.root, { recursive: true, mode: 0o700 })
          if ((await realpath(this.root)) !== this.root)
            fail('INVALID_FILE', '导出目录不能是符号链接。')
          temporary = join(this.root, `.tmp-${id}-${randomUUID()}`)
          await mkdir(temporary, { mode: 0o700 })
          const documents = deliveryDocuments(record),
            entries: Record<string, Uint8Array> = Object.create(null)
          entries['交付说明.md'] = strToU8(documents.note)
          entries['风险说明.md'] = strToU8(documents.riskNote)
          entries['manifest.json'] = strToU8(documents.manifest)
          entries['附件清单.csv'] = strToU8(documents.list)
          for (const file of record.files) {
            abort()
            const bytes = await read(file.snapshotId)
            if (hash(bytes) !== file.sha256 || bytes.length !== file.bytes)
              fail('SNAPSHOT_CHANGED', '附件校验发生变化，请重新导入。')
            entries['材料/' + file.name] = bytes
          }
          const zip = zipSync(entries, { level: 0 }),
            writer = this.io.writeFile ?? writeFile
          await writer(join(temporary, '交付包.zip'), zip, { flag: 'wx', mode: 0o600 })
          abort()
          await writer(join(temporary, '检查报告.html'), documents.report, {
            flag: 'wx',
            mode: 0o600,
          })
          abort()
          record.state = 'verifying'
          persist()
          const stored = await safeRead(
              join(temporary, '交付包.zip'),
              temporary,
              105 * 1024 * 1024,
            ),
            unpacked = unzipSync(stored)
          for (const file of record.files)
            if (hash(unpacked['材料/' + file.name]) !== file.sha256)
              fail('SNAPSHOT_CHANGED', '交付包附件核验失败。')
          if (hash(unpacked['manifest.json']) !== hash(documents.manifest))
            fail('SNAPSHOT_CHANGED', '交付包清单核验失败。')
          const report = await safeRead(
            join(temporary, '检查报告.html'),
            temporary,
            10 * 1024 * 1024,
          )
          if (hash(report) !== hash(documents.report))
            fail('SNAPSHOT_CHANGED', '内部报告核验失败。')
          const final = join(this.root, id)
          if (
            await lstat(final).then(
              () => true,
              (e) => {
                if (e.code === 'ENOENT') return false
                throw e
              },
            )
          )
            fail('INVALID_FILE', '同名产物已存在，请重新预览。')
          abort()
          await rename(temporary, final)
          temporary = undefined
          record.manifestHash = hash(documents.manifest)
          record.zipHash = hash(stored)
          record.reportHash = hash(report)
          record.completedAt = new Date().toISOString()
          record.state = 'completed'
          persist()
          return record
        } catch (error) {
          record.state = signal?.aborted ? 'cancelled' : 'failed'
          record.error = signal?.aborted
            ? '导出已停止；之前的交付记录仍保留。'
            : '导出未完成；请检查本机空间或材料后重新预览。'
          persist()
          if (error instanceof MaterialError) throw error
          throw new MaterialError('RUNTIME_FAILED', record.error, true)
        } finally {
          if (temporary) await rm(temporary, { recursive: true, force: true })
        }
      },
    )
  }
  async download(projectId: string, id: string, kind: 'zip' | 'report') {
    const record = this.materials.getDelivery(projectId, id)
    if (record.state !== 'completed') fail('INVALID_INPUT', '这份交付还没有完成。')
    const parent = join(this.root, id),
      name = kind === 'zip' ? '交付包.zip' : '检查报告.html'
    let bytes: Buffer
    try {
      bytes = await safeRead(
        join(parent, name),
        parent,
        kind === 'zip' ? 105 * 1024 * 1024 : 10 * 1024 * 1024,
      )
    } catch {
      fail('NOT_FOUND', '产物已移动、删除或无法读取；交付历史仍保留。')
    }
    if (hash(bytes) !== (kind === 'zip' ? record.zipHash : record.reportHash))
      fail('SNAPSHOT_CHANGED', '保存的产物校验失败；交付历史仍保留。')
    return {
      bytes,
      name:
        record.projectName.replace(/[\\/<>:"|?*\x00-\x1f]/g, '_').slice(0, 60) +
        (kind === 'zip' ? '-交付包.zip' : '-检查报告.html'),
    }
  }
}
