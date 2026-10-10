import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { dirname } from 'node:path'
import type { RuntimeLaunch } from './connection.js'

/** 一个由产品拥有的 dsh 运行时。 */
interface OwnedRuntime {
  harness: DeepSeekHarness
  /** 运行时所有权标识；网关为每次调用生成新键。 */
  key: string
}

/**
 * 管理 dsh 子进程的生命周期。
 * SDK 没有轮次中取消 API，放弃一次 run 即关闭独享运行时。
 */
export class RuntimeManager {
  private current: OwnedRuntime | null = null
  private operation: Promise<unknown> = Promise.resolve()
  private stopUnconfirmed = false

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.operation.then(action, action)
    this.operation = next.then(() => undefined, () => undefined)
    return next
  }

  /** 取得（或惰性启动）与键匹配的运行时；键不同则先关闭旧运行时。 */
  acquire(key: string, launch: RuntimeLaunch): Promise<DeepSeekHarness> {
    return this.exclusive(async () => {
      if (this.stopUnconfirmed) throw new RuntimeStopUnconfirmedError()
      if (this.current?.key === key) return this.current.harness
      if (this.current !== null && !(await this.stopOwned()).confirmed) throw new RuntimeStopUnconfirmedError()

      const harness = new DeepSeekHarness({
        profile: 'sdk',
        patches: [launch.patchPath],
        dshHome: launch.dshHome,
        env: launch.env,
        provider: launch.provider,
        model: launch.model,
        maxTokens: launch.maxTokens,
        cwd: dirname(launch.patchPath),
        processCwd: dirname(launch.patchPath),
      })
      this.current = { harness, key }
      try {
        await harness.start()
      } catch (error) {
        if (!(await this.stopOwned()).confirmed) throw new RuntimeStopUnconfirmedError()
        throw error
      }
      return harness
    })
  }

  /**
   * 关闭当前运行时并等待子进程退出。
   * @returns confirmed=true 表示进程已退出；false 为 STOP_UNCONFIRMED 语义，调用方不得立即重入。
   */
  stop(): Promise<{ confirmed: boolean }> {
    return this.exclusive(() => this.stopOwned())
  }

  private async stopOwned(): Promise<{ confirmed: boolean }> {
    if (this.stopUnconfirmed) return { confirmed: false }
    const owned = this.current
    if (owned === null) return { confirmed: true }
    try {
      await owned.harness.close()
      this.current = null
      return { confirmed: true }
    } catch {
      this.stopUnconfirmed = true
      return { confirmed: false }
    }
  }

  get active(): boolean {
    return this.current !== null
  }
}

/** Retains ownership when the SDK cannot prove that its child exited. */
export class RuntimeStopUnconfirmedError extends Error {
  constructor() { super('STOP_UNCONFIRMED: previous runtime exit was not confirmed') }
}
