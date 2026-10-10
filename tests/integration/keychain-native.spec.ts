import { it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { MacKeychain } from '../../packages/harness-adapter/src/credentials.js'
it.skipIf(process.platform !== 'darwin')('native keychain stores and removes only a scoped synthetic test credential',async()=>{
  const helper=fileURLToPath(new URL('../../native/build/keychain',import.meta.url))
  const store=new MacKeychain(helper),reference=`shouwei-${randomUUID()}`
  expect(store.available).toBe(true)
  try {
    expect(await store.get(reference)).toBeNull()
    await store.set(reference,'synthetic-stage-five-no-provider')
    expect(await store.get(reference)).toBe('synthetic-stage-five-no-provider')
  } finally {await store.delete(reference)}
  expect(await store.get(reference)).toBeNull()
})
