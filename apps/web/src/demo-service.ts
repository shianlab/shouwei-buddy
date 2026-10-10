import { z } from 'zod'
import { fixture } from './demo-data'
import { projectView } from './view-model'
export { fixture }
export const DEMO_KEY = 'shouwei.demo.v1'
const issueState = z.enum(['open', 'pending', 'resolved', 'accepted'])
const stateSchema = z.object({
  version: z.literal(1),
  mode: z.literal('demo'),
  name: z.string().max(150),
  recipient: z.string().max(150),
  goal: z.string().max(1000),
  loaded: z.boolean(),
  confirmed: z.boolean(),
  statuses: z.object({ I01: issueState, I02: issueState, I03: issueState, I04: issueState }),
  scenario: z.enum(['normal', 'partial', 'timeout', 'stale', 'risk', 'ready']),
  run: z.enum(['idle', 'running', 'cancelled', 'failed', 'complete']),
  reason: z.string().max(1000),
  note: z.string().max(4000),
  excludes: z.array(z.string()).max(10),
  completed: z.boolean(),
  record: z
    .object({
      name: z.string(),
      recipient: z.string(),
      files: z.array(z.string()),
      deliveryNote: z.string(),
      riskNote: z.string(),
      satisfied: z.number(),
      acceptedCount: z.number(),
    })
    .nullable(),
})
export type DemoState = z.infer<typeof stateSchema>
export type Scenario = DemoState['scenario']
export type IssueId = keyof DemoState['statuses']
export type DemoAction =
  | {
      type: 'reset' | 'load' | 'confirm' | 'recheck' | 'start' | 'cancel' | 'finishRun' | 'complete'
    }
  | { type: 'fix'; id: string }
  | { type: 'scenario'; value: Scenario }
  | { type: 'acceptRisk'; reason: string }
  | { type: 'note'; value: string }
  | { type: 'exclude'; id: string }
  | { type: 'details'; field: 'name' | 'recipient' | 'goal'; value: string }

export const suggestedNote =
  '你好，本次提交周末读书会的四份材料：活动方案、活动通知、确认预算和报名说明。\n本次材料统一使用 2026 年 10 月 24 日、一层 A 教室的信息。确认预算合计为 2800 元。\n如后续安排变化，请以双方确认的更新版本为准。'
export const suggestedRiskNote =
  '你好，本次提交周末读书会的四份筹备材料：活动方案、活动通知、筹备版预算和报名说明。\n本次材料统一使用 2026 年 10 月 24 日、一层 A 教室的信息。预计预算合计为 2800 元，场地费用尚未最终确认。\n本次先交筹备版，场地确认后补交最终版预算。'
export function initialDemo(): DemoState {
  return {
    version: 1,
    mode: 'demo',
    name: fixture.name,
    recipient: fixture.recipient,
    goal: fixture.goal,
    loaded: false,
    confirmed: false,
    statuses: { I01: 'open', I02: 'open', I03: 'open', I04: 'open' },
    scenario: 'normal',
    run: 'idle',
    reason: '',
    note: suggestedNote,
    excludes: [],
    completed: false,
    record: null,
  }
}
export function restoreDemo(raw: string | null): DemoState {
  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw ?? 'null'))
    if (!parsed.success) return initialDemo()
    // A refresh cannot resume a timer; return a visible interrupted state.
    return parsed.data.run === 'running' ? { ...parsed.data, run: 'cancelled' } : parsed.data
  } catch {
    return initialDemo()
  }
}
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'reset':
      return initialDemo()
    case 'load':
      return { ...state, loaded: true }
    case 'details':
      return { ...state, [action.field]: action.value, completed: false }
    case 'confirm':
      return { ...state, confirmed: true }
    case 'start':
      return { ...state, run: 'running', completed: false }
    case 'cancel':
      return { ...state, run: 'cancelled' }
    case 'finishRun':
      return state.run !== 'running'
        ? state
        : { ...state, run: state.scenario === 'timeout' ? 'failed' : 'complete' }
    case 'fix': {
      if (!(action.id in state.statuses)) return state
      const id = action.id as IssueId
      if (state.statuses[id] !== 'open') return state
      return { ...state, statuses: { ...state.statuses, [id]: 'pending' }, completed: false }
    }
    case 'recheck':
      return {
        ...state,
        scenario: state.scenario === 'stale' ? 'normal' : state.scenario,
        statuses: Object.fromEntries(
          Object.entries(state.statuses).map(([id, status]) => [
            id,
            status === 'pending' ? 'resolved' : status,
          ]),
        ) as DemoState['statuses'],
        completed: false,
      }
    case 'scenario':
      return {
        ...initialDemo(),
        loaded: true,
        confirmed: true,
        run: 'complete',
        scenario: action.value,
        record: state.record,
        statuses: ['risk', 'ready', 'stale', 'partial'].includes(action.value)
          ? {
              I01: 'resolved',
              I02: action.value === 'risk' ? 'open' : 'resolved',
              I03: 'resolved',
              I04: 'resolved',
            }
          : initialDemo().statuses,
      }
    case 'acceptRisk':
      return state.scenario !== 'risk' || action.reason.trim().length < 2
        ? state
        : {
            ...state,
            reason: action.reason.trim(),
            note: state.note === suggestedNote ? suggestedRiskNote : state.note,
            statuses: { ...state.statuses, I02: 'accepted' },
            completed: false,
          }
    case 'note':
      return { ...state, note: action.value }
    case 'exclude':
      return {
        ...state,
        completed: false,
        excludes: state.excludes.includes(action.id)
          ? state.excludes.filter((id) => id !== action.id)
          : [...state.excludes, action.id],
      }
    case 'complete': {
      const view = projectView(state)
      if (!view.canDeliver) return state
      return {
        ...state,
        completed: true,
        record: {
          name: state.name,
          recipient: state.recipient,
          files: view.deliveryFiles.map((file) => file.name),
          deliveryNote: view.deliveryNote,
          riskNote: view.riskNote,
          satisfied: view.satisfied,
          acceptedCount: view.acceptedCount,
        },
      }
    }
  }
}
