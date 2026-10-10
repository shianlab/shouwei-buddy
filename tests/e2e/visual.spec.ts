import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir } from 'node:fs/promises'
const directory = 'docs/evidence/stage-1'
test('main screens have accessible names and create the eight review screenshots', async ({
  page,
}) => {
  await mkdir(directory, { recursive: true })
  const screens = [
    ['01-home', '/'],
    ['02-materials', '/projects/new'],
    ['03-requirements', '/projects/reading-club/requirements'],
    ['05-review', '/projects/reading-club/review'],
    ['08-models', '/settings/models'],
  ]
  for (const [name, path] of screens) {
    await page.goto(path!)
    await expect(page.getByText(path === '/' ? '真实材料 · 本机保存' : '示例演示 · 未调用模型', { exact: true })).toBeVisible()
    await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true })
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(
      result.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    ).toEqual([])
  }
  await page.goto('/projects/reading-club/review')
  await page.getByRole('button', { name: '重新检查示例', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消检查' })).toBeVisible()
  await page.screenshot({ path: `${directory}/04-check.png`, fullPage: true })
  await expect(page).toHaveURL(/\/review$/)
  await page.getByLabel('示例状态').selectOption('ready')
  await page.getByRole('button', { name: '准备交付', exact: true }).click()
  await page.screenshot({ path: `${directory}/06-delivery.png`, fullPage: true })
  await page.getByRole('button', { name: '预览交付包' }).click()
  await page.getByRole('button', { name: '完成示例演示' }).click()
  await page.screenshot({ path: `${directory}/07-complete.png`, fullPage: true })
})
for (const width of [1024, 375, 720]) {
  test(`review works without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/projects/reading-club/review')
    if (width === 720)
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%'
      })
    await page.screenshot({ path: `${directory}/review-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: '查看证据：活动日期对不上' }).click()
    await expect(
      page
        .getByRole('dialog')
        .getByText('欢迎参加 2026 年 10 月 25 日的周末读书会。', { exact: true }),
    ).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${directory}/evidence-${width}.png`, fullPage: true })
    await page.keyboard.press('Escape')
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(result.violations.map((v) => v.id)).toEqual([])
  })
}

test('all navigation surfaces fit a 375px screen, including long material names', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 })
  for (const path of [
    '/',
    '/projects/new',
    '/projects/reading-club/requirements',
    '/projects/reading-club/delivery',
    '/history',
    '/settings/models',
    '/settings/storage',
  ]) {
    await page.goto(path)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      path,
    ).toBe(true)
  }
  await page.goto('/projects/reading-club/review')
  await page.getByRole('button', { name: '展开材料' }).click()
  await page
    .locator('.file-name')
    .first()
    .evaluate((element) => {
      element.textContent = '周末读书会报名截止时间与最终版本需要负责人确认'.repeat(12) + '.docx'
    })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
