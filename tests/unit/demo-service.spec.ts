import { expect, it } from 'vitest'
import { initialDemo, demoReducer, restoreDemo } from '../../apps/web/src/demo-service.js'
import { projectView } from '../../apps/web/src/view-model.js'

it('starts with five files, four issues and only two of six requirements satisfied', () => {
  const view = projectView(initialDemo())
  expect(view.files).toHaveLength(5)
  expect(view.openCount).toBe(4)
  expect(view.satisfied).toBe(2)
  expect(view.canDeliver).toBe(false)
})
it('fixes require a separate recheck and derive the four final delivery files', () => {
  let state = initialDemo()
  for (const id of ['I01', 'I02', 'I03', 'I04']) state = demoReducer(state, { type: 'fix', id })
  expect(projectView(state).pendingCount).toBe(4)
  expect(projectView(state).canDeliver).toBe(false)
  state = demoReducer(state, { type: 'recheck' })
  expect(projectView(state).satisfied).toBe(6)
  expect(projectView(state).canDeliver).toBe(true)
  expect(projectView(state).deliveryFiles).toHaveLength(4)
  expect(
    projectView(state).deliveryFiles.some((file) => file.id === 'F01' || file.id === 'F04'),
  ).toBe(false)
})
it('risk needs a reason and always survives an edited delivery note', () => {
  let state = demoReducer(initialDemo(), { type: 'scenario', value: 'risk' })
  state = demoReducer(state, { type: 'acceptRisk', reason: ' ' })
  expect(projectView(state).canDeliver).toBe(false)
  state = demoReducer(state, { type: 'acceptRisk', reason: '先交筹备版，场地确认后补最终版' })
  state = demoReducer(state, { type: 'note', value: '你好' })
  expect(projectView(state).conclusion).toBe('ready_with_notes')
  expect(projectView(state).deliveryNote).toContain('费用尚未最终确认')
})
it('partial coverage, stale results and missing required attachments block delivery', () => {
  for (const scenario of ['partial', 'stale'] as const) {
    const state = demoReducer(initialDemo(), { type: 'scenario', value: scenario })
    expect(projectView(state).canDeliver).toBe(false)
  }
  let state = demoReducer(initialDemo(), { type: 'scenario', value: 'ready' })
  state = demoReducer(state, { type: 'exclude', id: 'F02' })
  expect(projectView(state).canDeliver).toBe(false)
})
it('repeated fixes are idempotent and reset cannot preserve previous decisions', () => {
  const state = demoReducer(initialDemo(), { type: 'fix', id: 'I01' })
  expect(demoReducer(state, { type: 'fix', id: 'I01' })).toEqual(state)
  expect(demoReducer(state, { type: 'reset' })).toEqual(initialDemo())
})
it('corrupt or foreign cached data cannot become a demo state', () => {
  expect(restoreDemo('{broken')).toEqual(initialDemo())
  expect(restoreDemo(JSON.stringify({ mode: 'real', version: 1 }))).toEqual(initialDemo())
})
it('delivery records retain the accepted-risk snapshot after a new scenario is loaded', () => {
  let state = demoReducer(initialDemo(), { type: 'scenario', value: 'risk' })
  state = demoReducer(state, { type: 'acceptRisk', reason: '先交筹备版，确认后补齐' })
  state = demoReducer(state, { type: 'complete' })
  state = demoReducer(state, { type: 'scenario', value: 'normal' })
  expect(state.record?.acceptedCount).toBe(1)
  expect(state.record?.deliveryNote).toContain('费用尚未最终确认')
  expect(state.record?.files).toHaveLength(4)
})
it('incomplete and running examples cannot create a delivery record', () => {
  expect(demoReducer(initialDemo(), { type: 'complete' }).completed).toBe(false)
  const running = demoReducer(demoReducer(initialDemo(), { type: 'scenario', value: 'ready' }), {
    type: 'start',
  })
  expect(projectView(running).canDeliver).toBe(false)
})
it('accepted-risk delivery uses provisional wording and a provisional budget filename', () => {
  let state = demoReducer(initialDemo(), { type: 'scenario', value: 'risk' })
  state = demoReducer(state, { type: 'acceptRisk', reason: '确认后再补最终预算' })
  const view = projectView(state)
  expect(view.deliveryNote).toContain('预计预算')
  expect(view.deliveryNote).not.toContain('确认预算')
  expect(view.deliveryFiles.find((file) => file.id === 'F05')?.name).toBe('预算-筹备版.md')
  expect(demoReducer(state, { type: 'complete' }).record?.deliveryNote).not.toContain('确认预算')
})
