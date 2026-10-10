import { z } from 'zod'
export const ProjectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    recipient: z.string().trim().max(150),
    goal: z.string().trim().min(1).max(1000),
  })
  .strict()
export type ProjectInput = z.infer<typeof ProjectInputSchema>
export const FileRoleSchema = z.enum(['requirement', 'deliverable', 'reference'])
export const EncodingSchema = z.enum(['utf-8', 'utf-16le', 'gb18030'])
export const ImportOptionsSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    role: FileRoleSchema,
    encoding: EncodingSchema,
    logicalFileId: z.uuid().optional(),
  })
  .strict()
export type ImportOptions = z.infer<typeof ImportOptionsSchema>
export type FileRole = z.infer<typeof FileRoleSchema>
export type TextEncoding = z.infer<typeof EncodingSchema>
export type ParseStatus = 'queued' | 'parsing' | 'complete' | 'partial' | 'failed' | 'unsupported'
export interface Project extends ProjectInput {
  id: string
  revision: number
  activeRunId: string | null
  createdAt: string
  updatedAt: string
}
export interface FileSnapshot {
  id: string
  projectId: string
  logicalFileId: string
  version: number
  role: FileRole
  originalName: string
  sha256: string
  bytes: number
  encoding: TextEncoding
  parseStatus: ParseStatus
  createdAt: string
}
export type Locator =
  | { kind: 'lines'; startLine: number; endLine: number; part: number }
  | { kind: 'paragraph'; paragraph: number; part: number }
  | { kind: 'cell'; table: number; row: number; column: number; part: number }
  | { kind: 'page'; page: number; part: number }
export interface TextBlock {
  id: string
  fileSnapshotId: string
  text: string
  textHash: string
  locator: Locator
  coverage: 'extracted'
}
export interface CoverageGap {
  id: string
  fileSnapshotId: string
  code: string
  reason: string
  page?: number
}
export interface ParseResult {
  status: ParseStatus
  blocks: TextBlock[]
  gaps: CoverageGap[]
}
export interface AuditEvent {
  id: string
  projectId: string
  sequence: number
  type: string
  time: string
  payloadVersion: 1
  payload: Record<string, unknown>
}
export interface ProjectDetail {
  project: Project
  files: FileSnapshot[]
  blocks: TextBlock[]
  gaps: CoverageGap[]
  events: AuditEvent[]
}
export interface Selection {
  token: string
  expiresAt: number
}
export interface ImportResult {
  project: Project
  file: FileSnapshot
  duplicate: boolean
}
export interface EvidenceRef {
  snapshotId: string
  blockId: string
  start: number
  end: number
  quote: string
}
export interface EvidenceValidation {
  valid: boolean
  reason?: string
}
