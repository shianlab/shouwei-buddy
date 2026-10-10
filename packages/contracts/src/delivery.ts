import { z } from 'zod'
import type { CheckView } from './checks.js'
export const DeliveryInputSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    files: z
      .array(z.object({ snapshotId: z.uuid(), name: z.string().min(1).max(240) }).strict())
      .min(1)
      .max(30),
    note: z.string().max(10000),
    requirementRisks: z
      .array(
        z
          .object({
            requirementId: z.string().min(1),
            reason: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .max(80),
  })
  .strict()
export type DeliveryInput = z.infer<typeof DeliveryInputSchema>
export type Conclusion = 'ready' | 'ready_with_notes' | 'needs_work' | 'incomplete'
export interface DeliveryRisk {
  subjectId: string
  title: string
  reason: string
}
export interface DeliveryAssessment {
  conclusion: Conclusion
  blockers: string[]
  risks: DeliveryRisk[]
  mustMet: number
  mustTotal: number
}
export interface ManifestFile {
  snapshotId: string
  logicalFileId: string
  version: number
  name: string
  sha256: string
  bytes: number
}
export interface DeliveryRecord {
  id: string
  projectId: string
  projectName: string
  recipient: string
  runId: string | null
  inputRevision: number
  inputHash: string | null
  createdAt: string
  completedAt: string | null
  state: 'preparing' | 'writing' | 'verifying' | 'completed' | 'failed' | 'cancelled'
  assessment: DeliveryAssessment
  files: ManifestFile[]
  note: string
  frozen: CheckView
  manifestHash: string | null
  zipHash: string | null
  reportHash: string | null
  error: string | null
}
export interface DeliveryHistoryItem {
  id: string
  projectId: string
  projectName: string
  state: DeliveryRecord['state']
  conclusion: Conclusion
  fileCount: number
  createdAt: string
  completedAt: string | null
  modelName: string
  available: boolean
}
