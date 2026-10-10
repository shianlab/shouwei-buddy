import { z } from 'zod'
import type { ModelConnection, AppError, TokenUsage } from './domain.js'
import type { Project, ProjectDetail } from './materials.js'
export const EvidenceSchema = z
  .object({
    snapshotId: z.string().min(1),
    blockId: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z.string().min(1).max(6000),
  })
  .strict()
export const RequirementCandidateSchema = z
  .object({
    text: z.string().trim().min(1).max(1000),
    importance: z.enum(['must', 'should']),
    originKind: z.enum(['source', 'suggested']),
    sourceEvidence: z.array(EvidenceSchema).max(10),
  })
  .strict()
export const RequirementEditSchema = RequirementCandidateSchema.extend({
  id: z.string().min(1),
  originKind: z.enum(['source', 'suggested', 'user']),
  applicability: z.enum(['applicable', 'not_applicable']),
  reason: z.string().max(1000),
}).strict()
export type RequirementEdit = z.infer<typeof RequirementEditSchema>
export interface Requirement extends RequirementEdit {
  version: number
  userConfirmedAt: string | null
}
export const RequirementsOutputSchema = z
  .object({ requirements: z.array(RequirementCandidateSchema).max(80) })
  .strict()
export const FactSchema = z
  .object({
    entityKey: z.string().min(1).max(200),
    field: z.enum(['date', 'location', 'person', 'amount', 'version', 'placeholder', 'other']),
    value: z.string().min(1).max(500),
    qualifiers: z.string().max(300),
    isExample: z.boolean(),
    evidence: z.array(EvidenceSchema).min(1).max(6),
  })
  .strict()
export type Fact = z.infer<typeof FactSchema>
export const MatchSchema = z
  .object({
    requirementId: z.string().min(1),
    status: z.enum(['met', 'unmet', 'unknown']),
    evidence: z.array(EvidenceSchema).max(10),
  })
  .strict()
export type RequirementMatch = z.infer<typeof MatchSchema>
export const ExtractOutputSchema = z
  .object({ facts: z.array(FactSchema).max(100), matches: z.array(MatchSchema).max(80) })
  .strict()
export const FindingCandidateSchema = z
  .object({
    kind: z.enum([
      'missing_material',
      'placeholder',
      'fact_conflict',
      'version_ambiguity',
      'duplicate',
      'requirement_gap',
      'naming',
    ]),
    severity: z.enum(['blocker', 'attention', 'suggestion']),
    title: z.string().min(1).max(200),
    explanation: z.string().min(1).max(2000),
    requirementIds: z.array(z.string()).max(80),
    evidence: z.array(EvidenceSchema).max(12),
  })
  .strict()
export type FindingCandidate = z.infer<typeof FindingCandidateSchema>
export const CheckOutputSchema = z
  .object({
    findings: z.array(FindingCandidateSchema).max(100),
    results: z.array(MatchSchema).max(80),
  })
  .strict()
export type ReviewState =
  'open' | 'pending_recheck' | 'resolved_verified' | 'dismissed' | 'accepted_risk' | 'stale'
export interface Finding extends FindingCandidate {
  id: string
  fingerprint: string
  searchedSnapshotIds: string[]
  reviewState: ReviewState
}
export const DecisionActionSchema = z.enum(['pending_recheck', 'dismissed', 'accepted_risk'])
export type DecisionAction = z.infer<typeof DecisionActionSchema>
export interface Decision {
  id: string
  runId: string
  findingId: string
  fingerprint: string
  inputHash: string
  action: DecisionAction
  reason: string
  createdAt: string
}
export interface ModelRun {
  id: string
  kind: 'requirements' | 'check'
  inputRevision: number
  requirementsVersion: number
  inputHash: string
  model: Omit<ModelConnection, 'credentialRef'>
  state:
    | 'running'
    | 'cancelling'
    | 'cancelled'
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'stop_unconfirmed'
  stage: string
  completedBatches: number
  totalBatches: number
  cachedBatches: number
  selectedSnapshotIds: string[]
  startedAt: string
  endedAt: string | null
  facts: Fact[]
  findings: Finding[]
  results: RequirementMatch[]
  rejected: { reason: string; title: string }[]
  gaps: string[]
  coverageComplete: boolean
  error: AppError | null
  usage: TokenUsage | null
  calls: number
  durationMs: number
}
export interface CheckWorkflow {
  requirementsVersion: number
  requirements: Requirement[]
  draft: Requirement[]
  draftInputHash: string | null
  requirementsSourceHash?: string
  extractCache?: Record<string, z.infer<typeof ExtractOutputSchema>>
  selectedSnapshotIds: string[] | null
  runs: ModelRun[]
  decisions: Decision[]
}
export const emptyWorkflow = (): CheckWorkflow => ({
  requirementsVersion: 0,
  requirements: [],
  draft: [],
  draftInputHash: null,
  selectedSnapshotIds: null,
  runs: [],
  decisions: [],
})
export interface CheckView {
  project: Project
  workflow: CheckWorkflow
  stale: boolean
  findings: Finding[]
  material: ProjectDetail
}
export const ModelSettingsSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    baseUrl: z.url().max(2000),
    modelId: z.string().trim().min(1).max(200),
    contextWindow: z.number().int().min(4096).max(2000000),
    maxOutputTokens: z.number().int().min(512).max(100000),
    requestTimeoutMs: z.number().int().min(1000).max(300000),
    apiKey: z.string().max(4096),
    noCredential: z.boolean(),
    persistCredential: z.boolean().optional().default(false),
  })
  .strict()
export type ModelSettings = z.infer<typeof ModelSettingsSchema>
export interface ModelStatus {
  configured: boolean
  connection: Omit<ModelConnection, 'credentialRef'> | null
  tested: boolean
  busy: boolean
  credentialStorage?: 'none' | 'session' | 'keychain'
  credentialStoreAvailable?: boolean
  needsCredential?: boolean
  restoreWarning?: boolean
  cleanupPending?: boolean
}
