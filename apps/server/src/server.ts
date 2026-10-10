import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, realpath, open, mkdir, unlink } from 'node:fs/promises'
import { resolve, join, extname, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { MaterialService, MaterialError, CheckService, DeliveryService } from '@shouwei/core'
import { LocalModel } from './model.js'
import { DecisionActionSchema, APP_VERSION, type SystemInfo, type Diagnostics } from '@shouwei/contracts'
import { ImportOptionsSchema, ProjectInputSchema } from '@shouwei/contracts'
const LIMIT = 28 * 1024 * 1024
const revision = z.number().int().positive()
const id = z.uuid()
const uploadSchema = z
  .object({
    name: z.string().min(1).max(240),
    base64: z
      .string()
      .max(LIMIT)
      .refine((value) => {
        const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
        return (
          value.length % 4 === 0 &&
          !/[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding))
        )
      }),
  })
  .strict()
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}
async function body(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new MaterialError('INVALID_INPUT', '请使用 JSON 请求。')
  if (Number(req.headers['content-length'] ?? 0) > LIMIT)
    throw new MaterialError('FILE_LIMIT', '上传文件过大。')
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > LIMIT) throw new MaterialError('FILE_LIMIT', '上传文件过大。')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new MaterialError('INVALID_INPUT', '请求内容无效。')
  }
}
async function lockDirectory(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const path = join(root, '.server.lock')
  const token = randomUUID()
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.writeFile(JSON.stringify({ pid: process.pid, token }))
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    throw new Error(
      'This data directory is already locked. Stop its server before starting another. After a crash, verify its recorded PID has exited before removing .server.lock.',
    )
  }
  return async () => {
    try {
      const value = JSON.parse(await readFile(path, 'utf8'))
      if (value.token === token) await unlink(path)
    } catch {
      /* Never remove an unrelated lock. */
    }
  }
}
export interface LocalServerOptions {
  dataDir: string
  port: number
  webRoot?: string
  devOrigin?: string
}
export async function createLocalServer(options: LocalServerOptions) {
  // Validate the build before acquiring any data-directory resources.
  const webRoot = options.webRoot ? await realpath(options.webRoot) : undefined
  const release = await lockDirectory(resolve(options.dataDir))
  let service: MaterialService | undefined
  try {
    service = new MaterialService(options.dataDir)
    await service.recoverInterrupted()
  } catch (error) {
    service?.close()
    await release()
    throw error
  }
  const materials = service
  const model = new LocalModel(join(resolve(options.dataDir), 'model-runtime'))
  await model.initialize()
  const checks = new CheckService(materials, model)
  const deliveries = new DeliveryService(materials, checks, options.dataDir)
  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number }).port
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
    const origins = new Set(hosts.map((h) => `http://${h}`))
    if (options.devOrigin && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(options.devOrigin))
      origins.add(options.devOrigin)
    try {
      if (
        !hosts.includes(req.headers.host ?? '') ||
        (req.headers.origin && !origins.has(req.headers.origin))
      )
        throw new MaterialError('FORBIDDEN', '请求来源不被允许。')
      const path = new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname
      if (path.startsWith('/api/')) {
        if (req.headers['x-shouwei-request'] !== 'local')
          throw new MaterialError('FORBIDDEN', '缺少本机应用请求标记。')
        if (req.method === 'GET' && (path === '/api/system' || path === '/api/diagnostics')) {
          const info: SystemInfo = { version: APP_VERSION, platform: process.platform, arch: process.arch, nodeVersion: process.versions.node, dataDir: resolve(options.dataDir), distribution: process.env.SHOUWEI_DISTRIBUTION === 'macos-test' ? 'macos-test' : 'source' }
          if (path === '/api/system') return json(res,200,{ok:true,data:info})
          const { dataDir, ...app } = info, status = model.status()
          const diagnostic: Diagnostics = {schema:1,generatedAt:new Date().toISOString(),app,storage:materials.diagnosticsCounts(),model:{configured:status.configured,tested:status.tested,busy:status.busy,credentialStorage:status.credentialStorage??'none',needsCredential:!!status.needsCredential,restoreWarning:!!status.restoreWarning,cleanupPending:!!status.cleanupPending}}
          return json(res,200,{ok:true,data:diagnostic})
        }
        if (path === '/api/deliveries' && req.method === 'GET')
          return json(res, 200, { ok: true, data: await deliveries.history() })
        const previewRoute = /^\/api\/projects\/([^/]+)\/deliveries\/preview$/.exec(path)
        if (previewRoute && req.method === 'POST')
          return json(res, 200, {
            ok: true,
            data: await deliveries.prepare(id.parse(previewRoute[1]), await body(req), false),
          })
        const deliveryRoute =
          /^\/api\/projects\/([^/]+)\/deliveries(?:\/([^/]+)(?:\/(export|download)(?:\/(zip|report))?)?)?$/.exec(
            path,
          )
        if (deliveryRoute) {
          const projectId = id.parse(deliveryRoute[1]),
            deliveryId = deliveryRoute[2] ? id.parse(deliveryRoute[2]) : null
          if (!deliveryId && req.method === 'POST')
            return json(res, 200, {
              ok: true,
              data: await deliveries.prepare(projectId, await body(req)),
            })
          if (deliveryId && !deliveryRoute[3] && req.method === 'GET')
            return json(res, 200, {
              ok: true,
              data: await deliveries.detail(projectId, deliveryId),
            })
          if (
            deliveryId &&
            deliveryRoute[3] === 'export' &&
            !deliveryRoute[4] &&
            req.method === 'POST'
          ) {
            z.object({})
              .strict()
              .parse(await body(req))
            const abort = new AbortController()
            res.on('close', () => {
              if (!res.writableEnded) abort.abort()
            })
            return json(res, 200, {
              ok: true,
              data: await deliveries.export(projectId, deliveryId, abort.signal),
            })
          }
          if (
            deliveryId &&
            deliveryRoute[3] === 'download' &&
            deliveryRoute[4] &&
            req.method === 'GET'
          ) {
            const kind = z.enum(['zip', 'report']).parse(deliveryRoute[4]),
              artifact = await deliveries.download(projectId, deliveryId, kind)
            res.writeHead(200, {
              'Content-Type': kind === 'zip' ? 'application/zip' : 'text/html; charset=utf-8',
              'Content-Disposition': `attachment; filename="${kind === 'zip' ? 'delivery.zip' : 'report.html'}"; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
              'Content-Length': artifact.bytes.length,
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
            })
            return res.end(artifact.bytes)
          }
          throw new MaterialError('NOT_FOUND', '没有找到这个交付操作。')
        }
        if (path === '/api/model' && req.method === 'GET')
          return json(res, 200, { ok: true, data: model.status() })
        if (path === '/api/model' && req.method === 'POST') {
          if (checks.isBusy())
            throw new MaterialError('RUNTIME_BUSY', '请先停止正在运行的检查。')
          return json(res, 200, { ok: true, data: await model.configure(await body(req)) })
        }
        if (path === '/api/model' && req.method === 'DELETE') {
          z.object({confirm:z.literal(true)}).strict().parse(await body(req))
          if(checks.isBusy()) throw new MaterialError('RUNTIME_BUSY','请先停止正在运行的检查。')
          return json(res,200,{ok:true,data:await model.forget()})
        }
        if (path === '/api/model/test' && req.method === 'POST') {
          if (checks.isBusy())
            throw new MaterialError('RUNTIME_BUSY', '请先停止正在运行的检查。')
          return json(res, 200, { ok: true, data: await model.test() })
        }
        const analysis =
          /^\/api\/projects\/([^/]+)\/analysis(?:\/(scope|confirm|start|cancel|decide))?$/.exec(
            path,
          )
        if (analysis) {
          const projectId = id.parse(analysis[1]),
            action = analysis[2]
          if (!action && req.method === 'GET')
            return json(res, 200, { ok: true, data: checks.view(projectId) })
          if (req.method === 'POST') {
            const input = await body(req)
            let data: unknown
            if (action === 'scope') {
              const p = z
                .object({
                  expectedRevision: revision,
                  snapshotIds: z.array(id).min(1).max(30),
                })
                .strict()
                .parse(input)
              data = await checks.setScope(projectId, p.expectedRevision, p.snapshotIds)
            } else if (action === 'confirm') {
              const p = z
                .object({
                  expectedRevision: revision,
                  edits: z.array(z.unknown()).min(1).max(80),
                })
                .strict()
                .parse(input)
              data = await checks.confirm(projectId, p.expectedRevision, p.edits)
            } else if (action === 'start') {
              const p = z
                .object({
                  expectedRevision: revision,
                  kind: z.enum(['requirements', 'check']),
                  consent: z.literal(true),
                  modelConnectionId: id,
                })
                .strict()
                .parse(input)
              data = await checks.start(
                projectId,
                p.expectedRevision,
                p.kind,
                p.modelConnectionId,
              )
            } else if (action === 'cancel') {
              const p = z.object({ runId: id }).strict().parse(input)
              data = await checks.cancel(projectId, p.runId)
            } else if (action === 'decide') {
              const p = z
                .object({
                  expectedRevision: revision,
                  runId: id,
                  findingId: id,
                  action: DecisionActionSchema,
                  reason: z.string().min(1).max(1000),
                })
                .strict()
                .parse(input)
              data = await checks.decide(
                projectId,
                p.expectedRevision,
                p.runId,
                p.findingId,
                p.action,
                p.reason,
              )
            } else throw new MaterialError('NOT_FOUND', '没有这个检查操作。')
            return json(res, 200, { ok: true, data })
          }
        }
        if (req.method === 'GET' && path === '/api/projects')
          return json(res, 200, { ok: true, data: materials.listProjects() })
        if (req.method === 'POST' && path === '/api/projects')
          return json(res, 201, {
            ok: true,
            data: await materials.createProject(ProjectInputSchema.parse(await body(req))),
          })
        const match = /^\/api\/projects\/([^/]+)(?:\/(selections|imports|parse))?$/.exec(path)
        if (match) {
          const projectId = id.parse(match[1])
          const action = match[2]
          if (req.method === 'GET' && !action)
            return json(res, 200, { ok: true, data: materials.getProject(projectId) })
          if (req.method === 'PATCH' && !action) {
            const parsed = z
              .object({ expectedRevision: revision, input: ProjectInputSchema })
              .strict()
              .parse(await body(req))
            return json(res, 200, {
              ok: true,
              data: await materials.updateProject(
                projectId,
                parsed.expectedRevision,
                parsed.input,
              ),
            })
          }
          if (req.method === 'DELETE' && !action) {
            const input=z.object({expectedRevision:revision,confirm:z.literal(true)}).strict().parse(await body(req))
            const result=await materials.deleteProject(projectId,input.expectedRevision)
            const calls=await model.cleanupProject(projectId)
            return json(res,200,{ok:true,data:{...result,cleanupPending:result.cleanupPending||calls.pending}})
          }
          if (req.method === 'POST' && action === 'selections') {
            const parsed = uploadSchema.parse(await body(req))
            return json(res, 201, {
              ok: true,
              data: await materials.stageUpload(
                projectId,
                parsed.name,
                Buffer.from(parsed.base64, 'base64'),
              ),
            })
          }
          if (req.method === 'POST' && action === 'imports') {
            const parsed = ImportOptionsSchema.extend({ token: id }).parse(await body(req))
            const { token, ...rest } = parsed
            return json(res, 200, {
              ok: true,
              data: await materials.importSelection(projectId, token, rest),
            })
          }
          if (req.method === 'POST' && action === 'parse') {
            const parsed = z
              .object({ snapshotId: id, expectedRevision: revision })
              .strict()
              .parse(await body(req))
            return json(res, 200, {
              ok: true,
              data: await materials.parseSnapshot(
                projectId,
                parsed.snapshotId,
                parsed.expectedRevision,
              ),
            })
          }
        }
        throw new MaterialError('NOT_FOUND', '没有这个本机接口。')
      }
      if (req.method !== 'GET' || !webRoot)
        throw new MaterialError('NOT_FOUND', '没有找到这个页面。')
      const decoded = decodeURIComponent(path)
      if (
        decoded.includes('..') ||
        decoded.includes('\\') ||
        decoded.split('/').some((p) => p.startsWith('.'))
      )
        throw new MaterialError('NOT_FOUND', '没有找到这个页面。')
      const asset = decoded.startsWith('/assets/') || decoded.startsWith('/licenses/')
      const target = asset ? resolve(webRoot, '.' + decoded) : join(webRoot, 'index.html')
      const actual = await realpath(target)
      if (!actual.startsWith(webRoot + sep))
        throw new MaterialError('FORBIDDEN', '不能读取这个文件。')
      const contents = await readFile(actual)
      res.writeHead(200, {
        'Content-Type':
          ({
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.html': 'text/html',
            '.txt': 'text/plain',
          }[extname(actual)] ?? 'application/octet-stream') + '; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      })
      res.end(contents)
    } catch (error) {
      const e =
        error instanceof MaterialError
          ? error
          : error instanceof z.ZodError
            ? new MaterialError('INVALID_INPUT', '输入内容或版本无效。')
            : new MaterialError('LOCAL_FAILED', '本机操作未完成，请重试并检查磁盘空间。', true)
      const status =
        e.code === 'FORBIDDEN'
          ? 403
          : e.code === 'NOT_FOUND'
            ? 404
            : e.code === 'FILE_LIMIT'
              ? 413
              : e.code === 'REVISION_CONFLICT' || e.code === 'RUNTIME_BUSY'
                ? 409
                : e.code === 'LOCAL_FAILED'
                  ? 500
                  : 400
      if (!res.headersSent)
        json(res, status, {
          ok: false,
          error: {
            code: e.code,
            userMessage: e.userMessage,
            retryable: e.retryable,
            diagnosticId: e.diagnosticId,
          },
        })
    }
  })
  server.requestTimeout = 60000
  server.headersTimeout = 10000
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port, '127.0.0.1', () => resolve())
    })
  } catch (error) {
    materials.close()
    await release()
    throw error
  }
  const port = (server.address() as { port: number }).port
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await checks.close()
      await model.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      await materials.idle()
      materials.close()
      await release()
    },
  }
}
