import { z } from 'zod'

export const CapabilityStatusSchema = z.enum(['verified', 'unsupported', 'untested'])

export const ModelCapabilitiesSchema = z.object({
  text: CapabilityStatusSchema,
  stream: CapabilityStatusSchema,
  jsonMode: CapabilityStatusSchema,
  tools: CapabilityStatusSchema,
  vision: CapabilityStatusSchema,
  usage: CapabilityStatusSchema,
})

export const ModelConnectionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  protocol: z.enum(['openai-chat']),
  baseUrl: z.url().refine(value => {
    try {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash && !url.search
    } catch { return false }
  }, '必须使用不含凭据、查询参数和片段的 HTTP(S) 服务地址'),
  modelId: z.string().min(1),
  credentialRef: z.string().nullable(),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  requestTimeoutMs: z.number().int().positive().max(2_147_483_647),
  extraHeaderRefs: z.record(z.string(), z.string()).optional(),
  capabilities: ModelCapabilitiesSchema,
  verifiedAt: z.string().optional(),
}).refine(value => value.maxOutputTokens < value.contextWindow, '输出上限必须小于上下文容量')

export const TokenUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
})
