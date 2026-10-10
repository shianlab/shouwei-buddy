import { fork } from 'node:child_process'
import type { ParseResult } from '@shouwei/contracts'
import type { ParseInput } from './extract.js'
function failure(id: string, code: string, reason: string): ParseResult {
  return {
    status: 'failed',
    blocks: [],
    gaps: [{ id: `${id}:gap:1`, fileSnapshotId: id, code, reason }],
  }
}
export async function parseIsolated(input: ParseInput): Promise<ParseResult> {
  return new Promise((resolve) => {
    let result: ParseResult | undefined,
      timedOut = false
    const child = fork(new URL('../../lib/parsers/worker.js', import.meta.url), [], {
      execArgv: ['--max-old-space-size=256'],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { PATH: process.env.PATH ?? '', LANG: 'en_US.UTF-8' },
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, input.timeoutMs ?? 15000)
    child.once('message', (message: ParseResult) => {
      result = message
    })
    child.once('error', () => {})
    child.once('close', () => {
      clearTimeout(timer)
      resolve(
        timedOut
          ? failure(input.snapshotId, 'PARSE_TIMEOUT', '读取超时，解析进程已停止。')
          : (result ??
              failure(input.snapshotId, 'PARSE_FAILED', '读取失败或资源超限，原文件未修改。')),
      )
    })
    child.send(
      { ...input, bytes: undefined, base64: Buffer.from(input.bytes).toString('base64') },
      (error) => {
        if (error) child.kill('SIGKILL')
      },
    )
  })
}
