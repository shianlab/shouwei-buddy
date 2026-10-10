import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  HardDrive,
  Link2,
  ShieldCheck,
  SlidersHorizontal,
  Info,
  RefreshCw,
} from 'lucide-react'
import { Button, Modal, Notice, PageTitle, Tag, type PageProps } from './components'

export function SettingsNav({ active, go }: { active: string; go: PageProps['go'] }) {
  return (
    <nav className="settings-nav" aria-label="设置分类">
      <button aria-current={active === 'models' ? 'page' : undefined} onClick={() => go('/settings/models')}>
        <SlidersHorizontal size={18} />
        模型连接
        <ChevronRight size={15} />
      </button>
      <button
        aria-current={active === 'storage' ? 'page' : undefined}
        onClick={() => go('/settings/storage')}
      >
        <HardDrive size={18} />
        本地数据
        <ChevronRight size={15} />
      </button>
      <div className="soft-note">
        <ShieldCheck size={21} />
        <p>
          模型由你选择。
          <br />
          材料的去向，也由你决定。
        </p>
      </div>
    </nav>
  )
}
export function Models({ go }: PageProps) {
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)
  const [key, setKey] = useState('')
  const [noKey, setNoKey] = useState(false)
  const [url, setUrl] = useState('')
  const [model, setModel] = useState('')
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <>
      <PageTitle
        eyebrow="YOUR MODEL, YOUR CHOICE"
        title="选一个，合拍的模型。"
        subtitle="为将来的真实检查准备连接。现在可以先体验表单与测试状态。"
      />
      <div className="settings-layout">
        <SettingsNav active="models" go={go} />
        <section className="panel model-panel">
          <div className="section-header">
            <h2>
              <Link2 size={19} />
              模型连接
            </h2>
            <Tag>尚未接入</Tag>
          </div>
          <Notice>本页只演示配置交互。不会保存密钥、发起真实请求或修改第 0 阶段的连接配置。</Notice>
          <div className="form-grid">
            <label>
              连接名称
              <input placeholder="例如：我的常用模型" maxLength={100} />
            </label>
            <label>
              协议类型
              <select defaultValue="openai">
                <option value="openai">OpenAI Chat Completions 兼容</option>
              </select>
            </label>
          </div>
          <label>
            服务地址
            <input
              type="url"
              placeholder="https://你的服务地址/v1"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label>
            模型 ID
            <input
              placeholder="填写模型名称或接入点 ID"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <span className="field-hint">由你的服务提供方提供，可以直接输入。</span>
          </label>
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              placeholder={noKey ? '本机无凭据模式' : '仅在当前页面临时输入，不会保存'}
              disabled={noKey}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={noKey}
              onChange={(e) => {
                setNoKey(e.target.checked)
                setKey('')
              }}
            />
            <span>不需要密钥（仅供本机服务）</span>
          </label>
          <details className="advanced">
            <summary>
              高级设置 <SlidersHorizontal size={15} />
            </summary>
            <div className="form-grid">
              <label>
                上下文上限
                <input type="number" min={1} placeholder="按实际模型容量填写" />
              </label>
              <label>
                输出上限
                <input type="number" min={1} placeholder="小于上下文上限" />
              </label>
              <label>
                超时（秒）
                <input type="number" min={1} defaultValue={60} />
              </label>
            </div>
            <p className="small muted">本阶段不保存这些字段。额外请求头和其他协议需要后续适配。</p>
          </details>
          <div className="model-test-controls">
            <label>
              模拟结果
              <select
                aria-label="模拟连接结果"
                value={failed ? 'failed' : 'success'}
                onChange={(e) => {
                  setFailed(e.target.value === 'failed')
                  setTested(false)
                }}
              >
                <option value="success">成功界面</option>
                <option value="failed">密钥错误界面</option>
              </select>
            </label>
            <Button
              kind="primary"
              disabled={testing}
              onClick={() => {
                setTesting(true)
                setTested(false)
                timer.current = setTimeout(() => {
                  setTesting(false)
                  setTested(true)
                  setKey('')
                }, 600)
              }}
            >
              {testing ? (
                <>
                  <RefreshCw className="spin" size={17} />
                  模拟测试中
                </>
              ) : (
                <>
                  演示连接测试
                  <ChevronRight size={17} />
                </>
              )}
            </Button>
          </div>
          {tested && (
            <div aria-live="polite">
              <Notice tone={failed ? 'warning' : 'info'}>
                {failed
                  ? '模拟密钥错误：这个连接没有通过验证，请检查密钥。'
                  : '模拟测试完成，未连接真实模型。'}
              </Notice>
              <div className="capability-list">
                {['网络连接', '文字回复', '结构化输出', '工具调用'].map((label) => (
                  <div key={label}>
                    <span>{label}</span>
                    <Tag>
                      {label === '工具调用' ? '未测试' : failed ? '未验证 · 示例' : '成功样式 · 模拟'}
                    </Tag>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="model-footnote">
            <Info size={17} />
            <p>真正的连接验证可使用项目中的 verify:model 命令。这里的演示结果不代表任何模型已经通过验证。</p>
          </div>
        </section>
      </div>
    </>
  )
}
export function Storage({ dispatch, go }: PageProps) {
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <PageTitle
        eyebrow="KEEP THINGS CLOSE"
        title="你的材料，放在你这里。"
        subtitle="当前是示例界面，还没有创建业务数据库或读取磁盘材料。"
      />
      <div className="settings-layout">
        <SettingsNav active="storage" go={go} />
        <section className="panel">
          <div className="section-header">
            <h2>当前示例数据</h2>
            <Tag tone="green">本标签页</Tag>
          </div>
          <dl className="data-details">
            <div>
              <dt>保存位置</dt>
              <dd>浏览器 sessionStorage</dd>
            </div>
            <div>
              <dt>包含内容</dt>
              <dd>示例处理状态、项目文字、交付说明</dd>
            </div>
            <div>
              <dt>不包含</dt>
              <dd>模型密钥、本机原文件、真实检查结果</dd>
            </div>
          </dl>
          <Notice>
            刷新可以继续示例；关闭标签页后，浏览器通常会结束这个会话。无痕模式或禁止存储时，刷新可能重置。
          </Notice>
          <div className="section-divider" />
          <h3>从头体验一遍</h3>
          <p>清除本标签页的示例处理记录，不涉及原文件、真实项目或已导出的材料。</p>
          <Button onClick={() => setConfirm(true)}>重置示例数据</Button>
        </section>
      </div>
      {confirm && (
        <Modal title="重新开始这个示例？" onClose={() => setConfirm(false)}>
          <p>本标签页里的示例进度和交付签会被重置，不删除你的任何原文件。</p>
          <div className="actions">
            <Button onClick={() => setConfirm(false)}>保留当前进度</Button>
            <Button
              kind="primary"
              onClick={() => {
                dispatch({ type: 'reset' })
                setConfirm(false)
                go('/')
              }}
            >
              <Check size={17} />
              确认重置示例
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
