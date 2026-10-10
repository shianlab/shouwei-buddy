import { test, expect } from '@playwright/test'
import { MockModelServer } from '../support/mock-server'
import { checkReply } from '../support/check-provider'
import { mkdir } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
test('own-model UI runs a real SDK check against isolated synthetic HTTP and preserves review decisions', async ({
  page,
}) => {
  test.setTimeout(60000)
  const provider = await MockModelServer.start(checkReply)
  try {
    await page.goto('/local/model')
    await expect(page.getByRole('heading', { name: '接上你自己的模型。' })).toBeVisible()
    await page.getByLabel('连接名称', { exact: true }).fill('本机合成验收')
    await page.getByLabel('服务地址', { exact: true }).fill(provider.baseUrl)
    await page.getByLabel('模型 ID', { exact: true }).fill('test-model')
    await page.getByLabel('上下文容量', { exact: true }).fill('64000')
    await page.getByLabel('输出上限', { exact: true }).fill('4096')
    await page.getByLabel('仅本机服务，无需密钥', { exact: true }).check()
    await page.getByRole('button', { name: '保存本次连接', exact: true }).click()
    await expect(page.getByText('已配置 · 尚未测试', { exact: true })).toBeVisible()
    expect(provider.hits).toHaveLength(0)
    await page.getByRole('button', { name: '测试连接', exact: true }).click()
    await expect(page.getByText('连接测试通过', { exact: true })).toBeVisible({
      timeout: 15000,
    })
    await page.goto('/local/new')
    await page.getByLabel('项目名称', { exact: true }).fill('真实核对验收')
    await page.getByLabel('这次的目标', { exact: true }).fill('统一活动日期')
    await page.getByRole('button', { name: '创建项目', exact: true }).click()
    await expect(page).toHaveURL(/\/local\/projects\/[0-9a-f-]+$/)
    await page.getByLabel('材料用途').selectOption('requirement')
    await page.getByLabel('选择文件', { exact: true }).setInputFiles({
      name: '要求.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('活动日期：2026-10-24'),
    })
    await page.getByRole('button', { name: '读取材料：要求.txt' }).click()
    await expect(page.getByText('文字已读取', { exact: true })).toBeVisible()
    await page.getByLabel('材料用途').selectOption('deliverable')
    await page.getByLabel('选择文件', { exact: true }).setInputFiles({
      name: '方案.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('活动日期：2026-10-25'),
    })
    await page.getByRole('button', { name: '读取材料：方案.txt' }).click()
    await expect(page.getByText('文字已读取', { exact: true })).toHaveCount(2)
    await page.getByRole('button', { name: '确认要求与核对', exact: true }).click()
    await page.getByLabel('允许把本次选定材料的文字发送到已配置模型').check()
    await page.getByRole('button', { name: '从要求材料抽取', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '要求 1', exact: true })).toHaveValue(
      '活动日期统一',
      {
        timeout: 15000,
      },
    )
    await page.getByRole('button', { name: '确认这份清单', exact: true }).click()
    await expect(page.getByText('已确认 1 条要求', { exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: '要求 1', exact: true }).fill('活动日期必须统一')
    await expect(page.getByRole('button', { name: '开始核对', exact: true })).toBeDisabled()
    await expect(
      page.getByText('清单有未确认的修改，请先确认后再核对。', { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '确认这份清单', exact: true }).click()
    await expect(page.getByRole('button', { name: '开始核对', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '开始核对', exact: true }).click()
    await expect(page.getByText('核对完成', { exact: true })).toBeVisible({ timeout: 20000 })
    await expect(
      page.getByRole('heading', { name: '活动日期冲突', exact: true }),
    ).toBeVisible()
    const card = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: '活动日期冲突', exact: true }) })
    await card.getByRole('button', { name: '查看证据', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('2026-10-24')
    await expect(page.getByRole('dialog')).toContainText('2026-10-25')
    await page.keyboard.press('Escape')
    await card.getByLabel('处理原因').fill('先交筹备版，日期确认后补充')
    await card.getByRole('button', { name: '接受风险', exact: true }).click()
    await expect(card.getByText('已接受风险', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText('先交筹备版，日期确认后补充', { exact: true })).toBeVisible()
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([])
    await mkdir('docs/evidence/stage-3', { recursive: true })
    await page.screenshot({ path: 'docs/evidence/stage-3/review-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 375, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await page.screenshot({ path: 'docs/evidence/stage-3/review-375.png', fullPage: true })
  } finally {
    await provider.close()
  }
})
