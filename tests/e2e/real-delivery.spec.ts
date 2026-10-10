import { test, expect } from '@playwright/test'
import { MockModelServer } from '../support/mock-server'
import { checkReply } from '../support/check-provider'
import { readFile, mkdir } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { createHash } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
test('real materials become a verified downloadable ZIP with separate inert report and immutable history', async ({
  page,
}) => {
  test.setTimeout(60000)
  const provider = await MockModelServer.start(checkReply)
  try {
    await page.goto('/local/model')
    await page.getByLabel('连接名称', { exact: true }).fill('第四阶段合成模型')
    await page.getByLabel('服务地址', { exact: true }).fill(provider.baseUrl)
    await page.getByLabel('模型 ID', { exact: true }).fill('test-model')
    await page.getByLabel('上下文容量', { exact: true }).fill('64000')
    await page.getByLabel('输出上限', { exact: true }).fill('4096')
    await page.getByLabel('仅本机服务，无需密钥', { exact: true }).check()
    await page.getByRole('button', { name: '保存本次连接', exact: true }).click()
    await page.goto('/local/new')
    await page.getByLabel('项目名称', { exact: true }).fill('交付闭环验收')
    await page.getByLabel('这次的目标', { exact: true }).fill('统一活动日期')
    await page.getByRole('button', { name: '创建项目', exact: true }).click()
    await expect(page).toHaveURL(/\/local\/projects\/[0-9a-f-]+$/)
    const bytes = Buffer.from('活动日期：2026-10-24')
    for (const [role, name] of [
      ['requirement', '要求.txt'],
      ['deliverable', '方案.txt'],
    ]) {
      await page.getByLabel('材料用途').selectOption(role)
      await page
        .getByLabel('选择文件', { exact: true })
        .setInputFiles({ name, mimeType: 'text/plain', buffer: bytes })
      await page.getByRole('button', { name: '读取材料：' + name, exact: true }).click()
    }
    await page.getByRole('button', { name: '确认要求与核对', exact: true }).click()
    await page.getByLabel('允许把本次选定材料的文字发送到已配置模型').check()
    await page.getByRole('button', { name: '从要求材料抽取', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '要求 1', exact: true })).toHaveValue(
      '活动日期统一',
      { timeout: 15000 },
    )
    await page.getByRole('button', { name: '确认这份清单', exact: true }).click()
    await page.getByRole('button', { name: '开始核对', exact: true }).click()
    await expect(page.getByText('核对完成', { exact: true })).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: '准备交付', exact: true }).click()
    const hitsAfterCheck=provider.hits.length
    await page.getByRole('textbox', { name: '交付说明', exact: true }).fill('请查收<script>alert(1)</script>')
    await page.getByRole('button', { name: '预览交付包', exact: true }).click()
    await expect(page.getByText('可以交付', { exact: true })).toBeVisible()
    await page.getByRole('heading', { name: '把这份材料，收好交出去。', exact: true }).click()
    await mkdir('docs/evidence/stage-4',{recursive:true})
    await page.screenshot({path:'docs/evidence/stage-4/prepare-desktop.png',fullPage:true})
    await page.setViewportSize({width:375,height:900})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([])
    await page.screenshot({path:'docs/evidence/stage-4/prepare-375.png',fullPage:true})
    await page.setViewportSize({width:1440,height:960})
    await page.getByRole('button', { name: '生成交付包', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: '这份收尾，收好了。', exact: true }),
    ).toBeVisible()
    const zipEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载给收件人的 ZIP', exact: true }).click()
    const zip = unzipSync(await readFile((await (await zipEvent).path())!))
    expect(zip['材料/方案.txt']).toEqual(new Uint8Array(bytes))
    const manifest = JSON.parse(strFromU8(zip['manifest.json']))
    expect(manifest.files[0].sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(zip['检查报告.html']).toBeUndefined()
    const reportEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载自己的检查报告', exact: true }).click()
    const report = await readFile((await (await reportEvent).path())!, 'utf8')
    expect(report).toContain('&lt;script&gt;')
    expect(report).not.toContain('<script>')
    expect(
      (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
    ).toEqual([])
    await mkdir('docs/evidence/stage-4', { recursive: true })
    await page.screenshot({
      path: 'docs/evidence/stage-4/complete-desktop.png',
      fullPage: true,
    })
    await page.getByRole('button', { name: '查看交付记录', exact: true }).click()
    await expect(page.getByText('交付闭环验收', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText('交付闭环验收', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 375, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await page.screenshot({ path: 'docs/evidence/stage-4/history-375.png', fullPage: true })
    expect(provider.hits.length).toBe(hitsAfterCheck)
  } finally {
    await provider.close()
  }
})
