import { describe, expect, it, vi } from 'vitest'

// Only the external child-process SDK is doubled, so close failures can be
// reproduced without leaving an unkillable process on the developer's machine.
const sdk = vi.hoisted(() => ({ instances: [] as Array<{ start: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> }))
vi.mock('../../packages/harness-adapter/node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js', () => ({
  DeepSeekHarness: class {
    start = vi.fn(async () => {})
    close = vi.fn(async () => {})
    constructor() { sdk.instances.push(this) }
  },
}))
import { RuntimeManager } from '../../packages/harness-adapter/src/runtime.js'

const launch = { patchPath: '/tmp/example.patch.yml', dshHome: '/tmp/example-home', env: {}, provider: 'test', model: 'test', maxTokens: 100 }

describe('runtime ownership', () => {
  it('does not release ownership or reopen after an unconfirmed stop', async () => {
    const manager = new RuntimeManager()
    await manager.acquire('first', launch)
    const current = sdk.instances.at(-1)!
    current.close.mockRejectedValue(new Error('exit not confirmed'))
    expect(await manager.stop()).toEqual({ confirmed: false })
    expect(manager.active).toBe(true)
    await expect(manager.acquire('second', launch)).rejects.toThrow(/STOP_UNCONFIRMED/)
  })

  it('concurrent stop callers wait for the same confirmed exit', async () => {
    const manager = new RuntimeManager()
    await manager.acquire('first', launch)
    let finish!: () => void
    sdk.instances.at(-1)!.close.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    let secondFinished = false
    const first = manager.stop()
    const second = manager.stop().then(result => { secondFinished = true; return result })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(secondFinished).toBe(false)
    finish()
    expect(await first).toEqual({ confirmed: true })
    expect(await second).toEqual({ confirmed: true })
    expect(manager.active).toBe(false)
  })
})
