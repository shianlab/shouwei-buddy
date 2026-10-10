import type { ZodType } from 'zod'

/** 首版支持的模型协议；后续由协议注册表扩展。 */
export type ModelProtocol = 'openai-chat'

/** 能力状态：已验证 / 不支持 / 未测试。所有能力默认未测试，必须显式更新。 */
export type CapabilityStatus = 'verified' | 'unsupported' | 'untested'

/** 模型能力矩阵；每项独立验证，不以"网络可连"代替能力验证。 */
export interface ModelCapabilities {
  text: CapabilityStatus
  stream: CapabilityStatus
  jsonMode: CapabilityStatus
  tools: CapabilityStatus
  vision: CapabilityStatus
  usage: CapabilityStatus
}

/** 一个用户自配的模型连接（产品自定义类型）。 */
export interface ModelConnection {
  id: string
  displayName: string
  protocol: ModelProtocol
  /** 校验过的服务根地址，不接受带明文密码的 URL。 */
  baseUrl: string
  /** 模型 / 接入点 ID，不是界面展示名。 */
  modelId: string
  /** 凭据存储引用；null 表示显式无凭据模式（本机服务）。 */
  credentialRef: string | null
  /** 上下文容量；无法自动发现时由用户确认，不套用默认值。 */
  contextWindow: number
  maxOutputTokens: number
  requestTimeoutMs: number
  /** 额外请求头：键为头名称，值为凭据引用；禁止覆盖 Host 等传输头。 */
  extraHeaderRefs?: Record<string, string>
  capabilities: ModelCapabilities
  /** 最近验证时间，ISO 8601 字符串。 */
  verifiedAt?: string
}

/** 供应商返回的 token 用量；供应商未提供时整体为 null。 */
export interface TokenUsage {
  promptTokens?: number
  completionTokens?: number
}

/** 业务分析阶段标识；对应 03 的阶段编排。 */
export type AnalysisStage = 'requirements' | 'extract' | 'check' | 'recheck'

/** 一次模型分析调用的请求。outputSchema 为受信业务层提供的 Zod 校验器。 */
export interface AnalysisRequest<T> {
  projectId?: string
  runId: string
  stage: AnalysisStage
  schemaVersion: number
  systemInstruction: string
  dataBlocks: string[]
  modelConnectionId: string
  inputHash: string
  outputSchema: ZodType<T>
}

/** 一次模型分析调用的结果；经过 Schema 校验的数据及用量。 */
export interface AnalysisResult<T> {
  data: T
  usage: TokenUsage | null
  sessionId: string
  durationMs: number
}

/** 稳定错误码，供日志和测试断言。 */
export type AppErrorCode =
  | 'CANCELLED'
  | 'INVALID_INPUT'
  | 'RUNTIME_BUSY'
  | 'MODEL_UNREGISTERED'
  | 'INVALID_CREDENTIAL'
  | 'MODEL_OUTPUT_INVALID'
  | 'REQUEST_TIMEOUT'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'RUNTIME_FAILED'
  | 'STOP_UNCONFIRMED'
  | 'REVISION_CONFLICT'
  | 'NOT_FOUND'
  | 'INVALID_FILE'
  | 'UNSUPPORTED_FILE'
  | 'FILE_LIMIT'
  | 'INVALID_SELECTION'
  | 'SNAPSHOT_CHANGED'
  | 'FORBIDDEN'
  | 'LOCAL_FAILED'

/** 面向用户的结构化错误；不含堆栈、密钥和正文。 */
export interface AppError {
  code: AppErrorCode
  userMessage: string
  retryable: boolean
  diagnosticId: string
}

/** 统一返回结构。 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

/** 模型连接测试结果；逐项能力，不做模型商店。 */
export interface ConnectionTestResult {
  urlReachable: CapabilityStatus
  textReply: CapabilityStatus
  structuredOutput: CapabilityStatus
  streaming: CapabilityStatus
  testedAt: string
  error?: AppError
}
