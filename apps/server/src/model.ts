import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile, rename, realpath } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { HarnessGateway, MacKeychain, type CredentialStore } from '@shouwei/harness-adapter'
import {
  ModelSettingsSchema,
  ModelConnectionSchema,
  type ModelConnection,
  type ModelStatus,
  type AnalysisRequest,
  type AnalysisResult,
  type Result,
} from '@shouwei/contracts'
import { MaterialError, safeRead, type CheckModel } from '@shouwei/core'
import { cleanRuntimeCalls, recordCallOwner } from './runtime-cleanup.js'
const SavedSchema=z.object({schema:z.literal(1),connection:ModelConnectionSchema,noCredential:z.boolean(),credentialRef:z.string().nullable()}).strict().refine(value => {
  const url=new URL(value.connection.baseUrl),local=['127.0.0.1','localhost','[::1]'].includes(url.hostname)
  if(url.protocol!=='https:' && !(local && url.protocol==='http:'))return false
  if(value.noCredential)return local && value.credentialRef===null && value.connection.credentialRef===null
  return value.credentialRef===null ? value.connection.credentialRef==='session-key' : value.credentialRef===`shouwei-${value.connection.id}` && value.connection.credentialRef===value.credentialRef && z.uuid().safeParse(value.connection.id).success
})
export class LocalModel implements CheckModel {
  private connection: ModelConnection | null = null
  private key: string | null = null
  private tested = false
  private active: HarnessGateway | null = null
  private pending: Promise<unknown> | null = null
  private stopping = false
  private tainted = false
  private credentials: CredentialStore
  private saved: z.infer<typeof SavedSchema> | null = null
  private configuring = false
  private restoreWarning = false
  private cleanupPending = false
  constructor(private root: string, options: {credentials?: CredentialStore} = {}) {
    this.root=join(realpathSync(dirname(root)),basename(root))
    this.credentials=options.credentials??new MacKeychain(process.env.SHOUWEI_KEYCHAIN_HELPER??fileURLToPath(new URL('../../../native/build/keychain',import.meta.url)))
  }
  private get settingsPath(){return join(dirname(this.root),'model-settings.json')}
  async initialize() {
    const cleanup=await cleanRuntimeCalls(this.root)
    this.cleanupPending=cleanup.pending;this.tainted=cleanup.active
    try {
      const parent=await realpath(dirname(this.root))
      const saved=SavedSchema.parse(JSON.parse((await safeRead(join(parent,'model-settings.json'),parent,16384)).toString()))
      this.saved=saved;this.connection=saved.connection
      this.key=saved.noCredential?null:saved.credentialRef?await this.credentials.get(saved.credentialRef):null
    } catch (error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT') this.restoreWarning=true
    }
  }
  status(): ModelStatus {
    const { credentialRef, ...safe } = this.connection ?? ({} as ModelConnection)
    return {
      configured: !!this.connection && (!!this.key || !!this.saved?.noCredential),
      connection: this.connection ? safe : null,
      tested: this.tested,
      busy: !!this.pending || this.tainted || this.configuring,
      credentialStorage: this.saved?.noCredential?'none':this.saved?.credentialRef?'keychain':this.key?'session':'none',
      credentialStoreAvailable: this.credentials.available,
      needsCredential: !!this.connection && !this.key && !this.saved?.noCredential,
      restoreWarning: this.restoreWarning,
      cleanupPending: this.cleanupPending,
    }
  }
  async configure(input: unknown) {
    if (this.pending || this.stopping || this.tainted || this.configuring)
      throw new MaterialError('RUNTIME_BUSY', '模型任务尚未停止，请稍后重试。')
    const value = ModelSettingsSchema.parse(input),
      url = new URL(value.baseUrl)
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      throw new MaterialError('INVALID_INPUT', '远程服务请使用 HTTPS；HTTP 仅用于本机模型。')
    if ((value.noCredential && !local) || (!value.noCredential && !value.apiKey.trim()))
      throw new MaterialError('INVALID_CREDENTIAL', '请填写密钥；无凭据模式只支持本机服务。')
    const connection = ModelConnectionSchema.parse({
      id: randomUUID(),
      displayName: value.displayName,
      protocol: 'openai-chat',
      baseUrl: value.baseUrl.replace(/\/$/, ''),
      modelId: value.modelId,
      credentialRef: value.noCredential ? null : 'session-key',
      contextWindow: value.contextWindow,
      maxOutputTokens: value.maxOutputTokens,
      requestTimeoutMs: value.requestTimeoutMs,
      capabilities: {
        text: 'untested',
        stream: 'untested',
        jsonMode: 'untested',
        tools: 'untested',
        vision: 'untested',
        usage: 'untested',
      },
    })
    this.configuring=true
    const credentialRef=value.persistCredential && !value.noCredential?`shouwei-${connection.id}`:null
    const saved={schema:1 as const,connection:{...connection,credentialRef:value.noCredential?null:credentialRef??'session-key'},noCredential:value.noCredential,credentialRef}
    const temporary=this.settingsPath+'.'+randomUUID()+'.tmp'
    try {
      if(credentialRef) {
        try {await this.credentials.set(credentialRef,value.apiKey)}
        catch {throw new MaterialError('INVALID_CREDENTIAL','系统凭据保存未完成，原连接未改变；可选择仅本次使用。')}
      }
      await writeFile(temporary,JSON.stringify(saved),{flag:'wx',mode:0o600})
      await rename(temporary,this.settingsPath)
      const old=this.saved?.credentialRef
      this.saved=saved;this.connection=saved.connection;this.key=value.noCredential?null:value.apiKey
      this.tested=false;this.restoreWarning=false
      if(old && old!==credentialRef) await this.credentials.delete(old).catch(()=>{this.restoreWarning=true})
    } catch(error) {
      if(credentialRef)await this.credentials.delete(credentialRef).catch(()=>{})
      throw error
    } finally {await rm(temporary,{force:true}).catch(()=>{});this.configuring=false}
    return this.status()
  }
  async forget() {
    if(this.status().busy || this.stopping) throw new MaterialError('RUNTIME_BUSY','请先停止模型任务。')
    this.configuring=true
    try {
      if(this.saved?.credentialRef) {
        try {await this.credentials.delete(this.saved.credentialRef)}
        catch {throw new MaterialError('INVALID_CREDENTIAL','系统凭据移除未完成，请稍后重试。')}
      }
      await rm(this.settingsPath,{force:true})
      this.connection=null;this.key=null;this.saved=null;this.tested=false
    } finally {this.configuring=false}
    return this.status()
  }
  snapshot() {
    if (!this.status().configured || !this.connection)
      throw new MaterialError('MODEL_UNREGISTERED', '请先在本机模型设置中配置自己的连接。')
    return structuredClone(this.connection)
  }
  async cleanupProject(projectId:string) {
    const result=await cleanRuntimeCalls(this.root,projectId)
    this.cleanupPending ||= result.pending
    this.tainted ||= result.active
    return result
  }
  private async withGateway<T>(fn: (gateway: HarnessGateway) => Promise<T>,projectId:string|null=null,runId:string|null=null): Promise<T> {
    if (this.pending || this.stopping || this.tainted || this.configuring)
      throw new MaterialError('RUNTIME_BUSY', '模型连接正在使用，请等待。')
    const connection = this.snapshot(),
      key = this.key
    const operation = (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      if(await realpath(this.root)!==this.root)throw new MaterialError('INVALID_FILE','运行目录不能是符号链接。')
      const runRoot = await mkdtemp(join(this.root, 'call-'))
      try {await recordCallOwner(runRoot,projectId,runId)}
      catch(error){await rm(runRoot,{recursive:true,force:true});throw error}
      const gateway = new HarnessGateway({
        getConnection: (id) => (id === connection.id ? connection : null),
        getSecret: () => key,
        runRoot,
      })
      this.active = gateway
      try {
        return await fn(gateway)
      } finally {
        const stopped = await gateway.close()
        this.active = null
        if (stopped.confirmed) await rm(runRoot, { recursive: true, force: true })
        else this.tainted = true
      }
    })()
    this.pending = operation
    try {
      return await operation
    } finally {
      this.pending = null
    }
  }
  analyze<T>(
    request: AnalysisRequest<T>,
    signal: AbortSignal,
  ): Promise<Result<AnalysisResult<T>>> {
    return this.withGateway((gateway) => gateway.analyze(request, signal),request.projectId??null,request.runId)
  }
  async test() {
    const c = this.snapshot()
    const result = await this.withGateway((g) => g.testConnection(c))
    if (result.error)
      throw new MaterialError(
        result.error.code,
        result.error.userMessage,
        result.error.retryable,
      )
    this.tested = true
    this.connection!.verifiedAt = result.testedAt
    this.connection!.capabilities.text = 'verified'
    return this.status()
  }
  async close() {
    this.stopping = true
    await this.active?.close()
    await this.pending
    this.key = null
    this.connection = null
  }
}
