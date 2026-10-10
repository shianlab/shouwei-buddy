import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir } from 'node:fs/promises'
import { docx, pdf } from '../helpers/documents.js'
test('real project survives reload, imports bytes safely, locates original text and stays separate from demo', async ({
  page,
}) => {
  await page.goto('/local')
  await expect(page.getByRole('heading', { name: '自己的材料，安心放这里。' })).toBeVisible()
  await page.getByRole('button', { name: '新建本地项目' }).click()
  await page.getByLabel('项目名称', { exact: true }).fill('真实文件验收')
  await page.getByLabel('交给谁', { exact: true }).fill('活动负责人')
  await page.getByLabel('这次的目标', { exact: true }).fill('准备最终材料')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page).toHaveURL(/\/local\/projects\/[0-9a-f-]+$/)
  const projectURL = page.url()
  await page.getByLabel('材料用途').selectOption('requirement')
  await page.getByLabel('选择文件', { exact: true }).setInputFiles([
    {
      name: '要求.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('第一行\n你好😀世界\n<script>window.sourceExecuted=true</script>'),
    },
    {
      name: '不支持.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('not supported'),
    },
  ])
  await expect(page.getByText('要求.txt', { exact: true })).toBeVisible()
  await expect(page.getByText(/不支持.exe.*目前支持/)).toBeVisible()
  await page.getByRole('button', { name: '读取材料：要求.txt' }).click()
  await expect(page.getByText('文字已读取', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看原文：要求.txt' }).click()
  await page.getByLabel('定位到').selectOption({ label: '第 2 行' })
  await expect(page.getByRole('dialog')).toContainText('你好😀世界')
  await expect(page.getByRole('dialog')).toContainText('第 2 行')
  await page.getByLabel('定位到').selectOption({ label: '第 3 行' })
  await expect(page.getByRole('dialog').locator('pre')).toContainText('<script>')
  expect(await page.evaluate(() => 'sourceExecuted' in window)).toBe(false)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByText('要求.txt', { exact: true })).toBeVisible()
  await expect(page.getByText('真实材料 · 本机保存', { exact: true })).toBeVisible()
  await expect(page.getByText(/读取后先确认要求/)).toBeVisible()
  await page.goto('/projects/reading-club/review')
  await expect(page.getByText('示例演示 · 未调用模型', { exact: true })).toBeVisible()
  await page.goto(projectURL)
  await expect(page.getByText('要求.txt', { exact: true })).toBeVisible()
  await mkdir('docs/evidence/stage-2', { recursive: true })
  await page.screenshot({
    path: 'docs/evidence/stage-2/materials-desktop.png',
    fullPage: true,
  })
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations,
  ).toEqual([])
  await page.setViewportSize({ width: 375, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: 'docs/evidence/stage-2/materials-375.png', fullPage: true })
})
test('real DOCX cells and PDF pages can be located with honest coverage warnings', async ({
  page,
}) => {
  await page.goto('/local/new')
  await page.getByLabel('项目名称', { exact: true }).fill('文档定位验收')
  await page.getByLabel('这次的目标', { exact: true }).fill('核对表格和页码')
  await page.getByRole('button', { name: '创建项目' }).click()
  await expect(page).toHaveURL(/\/local\/projects\/[0-9a-f-]+$/)
  await page.getByLabel('选择文件', { exact: true }).setInputFiles([
    {
      name: '预算.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(
        docx(
          '<w:p><w:r><w:t>活动正文</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>100</w:t></w:r></w:p><w:p><w:r><w:t>200</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        ),
      ),
    },
    {
      name: '分页.pdf',
      mimeType: 'application/pdf',
      buffer: pdf(['First page', null, 'Third page']),
    },
  ])
  await expect(page.getByText('分页.pdf', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '读取材料：预算.docx' }).click()
  await page.getByRole('button', { name: '查看原文：预算.docx' }).click()
  await page.getByLabel('定位到').selectOption({ label: '表格 1 · 第 1 行 1 列 · 片段 1' })
  expect(await page.getByRole('dialog').locator('pre').textContent()).toBe('100\n200')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '读取材料：分页.pdf' }).click()
  await expect(page.getByText('部分内容未覆盖', { exact: true })).toBeVisible()
  await expect(page.getByText(/第 2 页：此页没有可提取文字/)).toBeVisible()
  await page.getByRole('button', { name: '查看原文：分页.pdf' }).click()
  await page.getByLabel('定位到').selectOption({ label: '第 3 页 · 文字片段 1' })
  await expect(page.getByRole('dialog').locator('pre')).toContainText('Third page')
  await mkdir('docs/evidence/stage-2', { recursive: true })
  await page.screenshot({ path: 'docs/evidence/stage-2/pdf-locator.png' })
})
