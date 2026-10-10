import { expect, it } from 'vitest'
import * as core from '../../packages/core/src/index.js'
const e = (id: string, quote: string) => ({
  snapshotId: id,
  blockId: id + ':b',
  start: 0,
  end: Array.from(quote).length,
  quote,
})
const fact = (entityKey: string, value: string, snapshotId: string) => ({
  entityKey,
  field: 'date' as const,
  value,
  qualifiers: '活动日期',
  isExample: false,
  evidence: [e(snapshotId, value)],
})
it('different events and different date qualifiers never become the same conflict', () => {
  expect(typeof (core as any).ruleFindings).toBe('function')
  expect(
    (core as any).ruleFindings(
      [fact('活动甲', '2026-10-24', 'a'), fact('活动乙', '2026-10-25', 'b')],
      [],
    ),
  ).toEqual([])
  expect(
    (core as any).ruleFindings(
      [
        fact('活动甲', '2026-10-24', 'a'),
        { ...fact('活动甲', '2026-10-25', 'b'), qualifiers: '通知日期' },
      ],
      [],
    ),
  ).toEqual([])
  expect(
    (core as any).ruleFindings(
      [fact('活动甲', '2026-10-24', 'a'), fact('活动甲', '2026-10-25', 'b')],
      [],
    )[0].kind,
  ).toBe('fact_conflict')
})
it('quoted TODO examples are not unfinished fields, while a supported unfinished fact is', () => {
  const f = {
    ...fact('预算', '待定', 'a'),
    field: 'placeholder',
    qualifiers: '场地费',
    isExample: true,
  }
  expect((core as any).ruleFindings([f], [])).toEqual([])
  expect((core as any).ruleFindings([{ ...f, isExample: false }], [])[0].kind).toBe(
    'placeholder',
  )
})
