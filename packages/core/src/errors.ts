import type { AppErrorCode } from '@shouwei/contracts'
import { randomUUID } from 'node:crypto'
export class MaterialError extends Error {
  readonly diagnosticId = randomUUID()
  constructor(
    readonly code: AppErrorCode,
    readonly userMessage: string,
    readonly retryable = false,
  ) {
    super(userMessage)
  }
}
export function fail(code: AppErrorCode, message: string, retryable = false): never {
  throw new MaterialError(code, message, retryable)
}
