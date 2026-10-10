import { constants } from 'node:fs'
import { lstat, open, mkdir, realpath, unlink, writeFile, readdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fail } from './errors.js'
export const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
export const MAX_FILE = 20 * 1024 * 1024
export function validateName(name: string) {
  if (
    !name ||
    name.length > 240 ||
    name.startsWith('._') ||
    /[\\/\x00-\x1f\x7f:]/.test(name) ||
    name === '.' ||
    name === '..'
  )
    fail('INVALID_FILE', '文件名无效；不接受路径或 AppleDouble 副本。')
  if (!['.txt', '.md', '.pdf', '.docx'].includes(extname(name).toLowerCase()))
    fail('UNSUPPORTED_FILE', '目前支持 TXT、MD、DOCX 和 PDF。')
}
export async function safeRead(path: string, parent: string, limit = MAX_FILE) {
  if ((await realpath(parent)) !== parent) fail('INVALID_FILE', '材料目录不能是符号链接。')
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    fail('INVALID_FILE', '文件类型或大小无效。')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const start = await handle.stat()
    if (start.ino !== stat.ino || !start.isFile() || start.size > limit)
      fail('SNAPSHOT_CHANGED', '读取时文件发生变化，请重新选择。')
    const bytes = await handle.readFile()
    const end = await handle.stat()
    if (
      bytes.length > limit ||
      start.size !== end.size ||
      start.mtimeMs !== end.mtimeMs ||
      start.ctimeMs !== end.ctimeMs
    )
      fail('SNAPSHOT_CHANGED', '读取时文件发生变化，请重新选择。')
    return bytes
  } finally {
    await handle.close()
  }
}
interface Staged {
  projectId: string
  name: string
  sha256: string
  bytes: number
  expiresAt: number
}
export class SnapshotStore {
  private selections = new Map<string, Staged>()
  readonly staging: string
  readonly snapshots: string
  constructor(readonly root: string) {
    this.staging = join(root, 'staging')
    this.snapshots = join(root, 'snapshots')
  }
  async initialize() {
    for (const p of [this.staging, this.snapshots]) {
      await mkdir(p, { recursive: true, mode: 0o700 })
      if ((await realpath(p)) !== p) fail('INVALID_FILE', '材料目录不能是符号链接。')
    }
  }
  async stage(projectId: string, name: string, bytes: Uint8Array) {
    validateName(name)
    if (bytes.length > MAX_FILE) fail('FILE_LIMIT', '单文件不能超过 20 MiB。')
    await this.initialize()
    await this.expire()
    if (
      this.selections.size >= 30 ||
      [...this.selections.values()].reduce((n, s) => n + s.bytes, 0) + bytes.length >
        100 * 1024 * 1024
    )
      fail('FILE_LIMIT', '待导入材料过多，请先完成当前导入。')
    const token = randomUUID()
    const expiresAt = Date.now() + 10 * 60 * 1000
    await writeFile(join(this.staging, token), bytes, { flag: 'wx', mode: 0o600 })
    this.selections.set(token, {
      projectId,
      name,
      sha256: hash(bytes),
      bytes: bytes.length,
      expiresAt,
    })
    return { token, expiresAt }
  }
  async consume(projectId: string, token: string) {
    const entry = this.selections.get(token)
    if (!entry || entry.projectId !== projectId || entry.expiresAt < Date.now())
      fail('INVALID_SELECTION', '本次选择已失效，请重新选择文件。')
    this.selections.delete(token)
    try {
      const bytes = await safeRead(join(this.staging, token), this.staging)
      if (hash(bytes) !== entry.sha256) fail('SNAPSHOT_CHANGED', '文件内容发生变化，请重新选择。')
      return { ...entry, content: bytes }
    } finally {
      await unlink(join(this.staging, token)).catch(() => {})
    }
  }
  async save(id: string, bytes: Uint8Array) {
    await this.initialize()
    await writeFile(join(this.snapshots, id), bytes, { flag: 'wx', mode: 0o400 })
  }
  async remove(id: string) {
    await unlink(join(this.snapshots, id)).catch(() => {})
  }
  async read(id: string, expectedHash: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) fail('INVALID_FILE', '无效的快照标识。')
    const bytes = await safeRead(join(this.snapshots, id), this.snapshots)
    if (hash(bytes) !== expectedHash) fail('SNAPSHOT_CHANGED', '快照校验失败，请重新导入原材料。')
    return bytes
  }
  async expire() {
    for (const [token, s] of this.selections)
      if (s.expiresAt < Date.now()) {
        this.selections.delete(token)
        await unlink(join(this.staging, token)).catch(() => {})
      }
  }
  async cleanStaging() {
    await this.initialize()
    for (const name of await readdir(this.staging))
      if (/^[0-9a-f-]{36}$/.test(name)) await unlink(join(this.staging, name)).catch(() => {})
    this.selections.clear()
  }
  async removeProjectSelections(projectId: string) {
    await this.initialize()
    for (const [token, selected] of this.selections)
      if (selected.projectId === projectId) {
        await unlink(join(this.staging, token)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
        this.selections.delete(token)
      }
  }
}
