import { test, expect } from '@playwright/test'

async function enter(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '先试一个例子' }).click()
  await expect(page.getByText('示例演示 · 未调用模型', { exact: true })).toBeVisible()
}
test('complete example: evidence, individual fixes, recheck and delivery preview', async ({
  page,
}) => {
  const external: string[] = []
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4327')) external.push(request.url())
  })
  await enter(page)
  await expect(page.getByRole('heading', { name: '还有 4 件小事，收好就能交了。' })).toBeVisible()
  await page.getByRole('button', { name: '查看证据：活动日期对不上' }).click()
  await expect(
    page.getByText('欢迎参加 2026 年 10 月 25 日的周末读书会。', { exact: true }),
  ).toBeVisible()
  for (const name of [
    '模拟修正通知',
    '模拟补齐预算',
    '选用确认版预算（示例）',
    '模拟补充报名说明',
  ]) {
    await page.getByRole('button', { name, exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '准备交付', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '复核示例修改', exact: true }).click()
  await expect(page.getByRole('heading', { name: '最后几件事，都收好了。' })).toBeVisible()
  await page.getByRole('button', { name: '准备交付', exact: true }).click()
  await expect(page.getByText('示例演示 · 未调用模型', { exact: true })).toBeVisible()
  await expect(page.getByTestId('delivery-files').getByRole('checkbox')).toHaveCount(4)
  await page.getByRole('button', { name: '预览交付包', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('报名说明.md')
  await page.getByRole('button', { name: '完成示例演示', exact: true }).click()
  await expect(page.getByRole('heading', { name: '这份，收好了。' })).toBeVisible()
  await expect(page.getByText('这是示例交付签，未生成或保存真实文件。')).toBeVisible()
  expect(external).toEqual([])
})
test('cancelled simulated checks stay cancelled, retry works', async ({ page }) => {
  await enter(page)
  await page.getByRole('button', { name: '重新检查示例', exact: true }).click()
  await page.getByRole('button', { name: '取消检查', exact: true }).click()
  await expect(page.getByRole('heading', { name: '已停止这次示例检查。' })).toBeVisible()
  await page.waitForTimeout(1800)
  await expect(page).toHaveURL(/\/check$/)
  await page.getByRole('button', { name: '继续检查', exact: true }).click()
  await expect(page).toHaveURL(/\/review$/)
})
test('risk requires a reason; selection omissions block final preview', async ({ page }) => {
  await enter(page)
  await page.getByLabel('示例状态').selectOption('risk')
  await page.getByRole('button', { name: '本次接受这个风险', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认接受风险', exact: true })).toBeDisabled()
  await page.getByLabel('接受理由').fill('先交筹备版，场地确认后补最终版')
  await page.getByRole('button', { name: '确认接受风险', exact: true }).click()
  await page.getByRole('button', { name: '带说明准备交付', exact: true }).click()
  await page.getByLabel('交付说明').fill('你好')
  await expect(page.getByText(/费用尚未最终确认/).first()).toBeVisible()
  await page.getByRole('button', { name: '恢复建议文案' }).click()
  await expect(page.getByLabel('交付说明')).toHaveValue(/预计预算/)
  await expect(page.getByLabel('交付说明')).not.toHaveValue(/确认预算/)
  await expect(page.getByRole('checkbox', { name: '预算-筹备版.md' })).toBeChecked()
  await page.getByRole('checkbox', { name: '活动方案.docx' }).uncheck()
  await expect(page.getByRole('button', { name: '预览交付包', exact: true })).toBeDisabled()
})

test('partial coverage and stale results are distinct, and unsupported settings never call a model', async ({
  page,
}) => {
  await enter(page)
  await page.getByLabel('示例状态').selectOption('partial')
  await expect(page.getByText('这次还不能算全部看过。')).toBeVisible()
  await expect(page.getByRole('button', { name: '准备交付', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '换用文字版示例' }).click()
  await expect(page.getByRole('button', { name: '准备交付', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '复核示例修改' }).click()
  await expect(page.getByRole('button', { name: '准备交付', exact: true })).toBeEnabled()
  await page.getByLabel('示例状态').selectOption('stale')
  await expect(page.getByText('材料有变化，这些结论需要再看一遍。')).toBeVisible()
  await page.getByRole('button', { name: '复核示例修改' }).click()
  await expect(page.getByRole('button', { name: '准备交付', exact: true })).toBeEnabled()
  await page.goto('/settings/models')
  await page.getByLabel('API Key').fill('synthetic-never-store-me')
  await page.getByRole('button', { name: '演示连接测试' }).click()
  await expect(page.getByText('模拟测试完成，未连接真实模型。')).toBeVisible()
  const storage = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  )
  expect(storage).not.toContain('synthetic-never-store-me')
  await page.reload()
  await expect(page.getByLabel('API Key')).toHaveValue('')
})
test('dialog traps focus and Escape restores the opener; corrupted cache recovers', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => sessionStorage.setItem('shouwei.demo.v1', '{broken'))
  await enter(page)
  const trigger = page.getByRole('button', { name: '检查范围', exact: true })
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await page.reload()
  await expect(page.getByRole('heading', { name: '还有 4 件小事，收好就能交了。' })).toBeVisible()
})
test('an interrupted example retries from the failure state', async ({ page }) => {
  await enter(page)
  await page.getByLabel('示例状态').selectOption('timeout')
  await page.getByRole('button', { name: '重新检查示例', exact: true }).click()
  await expect(page.getByRole('heading', { name: '这一步还没完成。' })).toBeVisible()
  await page.getByRole('button', { name: '重试当前阶段', exact: true }).click()
  await expect(page).toHaveURL(/\/review$/)
})

test('history keeps the delivery snapshot and the materials-to-check path works', async ({
  page,
}) => {
  await page.goto('/projects/new')
  await expect(page.getByRole('button', { name: '整理要求清单' })).toBeDisabled()
  await page.getByRole('button', { name: '放入示例材料', exact: true }).click()
  await page.getByRole('button', { name: '整理要求清单' }).click()
  await expect(page.getByRole('button', { name: '按这 6 条要求检查' })).toBeDisabled()
  await page.getByRole('checkbox', { name: '我已确认这 6 条示例要求' }).check()
  await page.getByRole('button', { name: '按这 6 条要求检查' }).click()
  await expect(page).toHaveURL(/\/review$/)
  await page.getByLabel('示例状态').selectOption('ready')
  await page.getByRole('button', { name: '准备交付', exact: true }).click()
  await page.getByRole('button', { name: '预览交付包' }).click()
  await page.getByRole('button', { name: '完成示例演示' }).click()
  await page.goto('/projects/reading-club/review')
  await page.getByLabel('示例状态').selectOption('normal')
  await page.getByRole('link', { name: '交付记录', exact: true }).click()
  await page.getByRole('button', { name: /周末读书会材料/ }).click()
  await expect(page.getByRole('heading', { name: '这份，收好了。' })).toBeVisible()
  await expect(page.getByText('4 份', { exact: true })).toBeVisible()
})
test('mobile materials can be expanded without pushing the issue list away by default', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/projects/reading-club/review')
  const toggle = page.getByRole('button', { name: '展开材料', exact: true })
  await expect(toggle).toBeVisible()
  await expect(page.getByRole('button', { name: '活动要求.md', exact: true })).not.toBeVisible()
  await toggle.click()
  await expect(page.getByRole('button', { name: '活动要求.md', exact: true })).toBeVisible()
})
