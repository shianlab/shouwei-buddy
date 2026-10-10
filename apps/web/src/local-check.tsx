import { useEffect, useState, useCallback } from 'react'
import type {
  CheckView,
  ModelStatus,
  ModelSettings,
  RequirementEdit,
  Finding,
  DecisionAction,
  Requirement,
} from '@shouwei/contracts'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react'
import { Button, PageTitle, Notice, Tag, Modal } from './components'
import { request } from './local-api'
import { locatorLabel } from './local-pages'
const editOf = (r: Requirement): RequirementEdit => ({
  id: r.id,
  text: r.text,
  importance: r.importance,
  applicability: r.applicability,
  reason: r.reason,
  originKind: r.originKind,
  sourceEvidence: r.sourceEvidence,
})
export function LocalModelPage({ go }: { go: (path: string) => void }) {
  const [status, setStatus] = useState<ModelStatus | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const [forgetting,setForgetting]=useState(false)
  const [form, setForm] = useState<ModelSettings>({
    displayName: '我的模型',
    baseUrl: '',
    modelId: '',
    contextWindow: 64000,
    maxOutputTokens: 4096,
    requestTimeoutMs: 60000,
    apiKey: '',
    noCredential: false,
    persistCredential: false,
  })
  useEffect(() => {
    void request<ModelStatus>('/model')
      .then((s) => {
        setStatus(s)
        if (s.connection) setForm((f) => ({ ...f, ...s.connection, apiKey: '' }))
      })
      .catch((e) => setError(e.message))
  }, [])
  const change = <K extends keyof ModelSettings>(key: K, value: ModelSettings[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setMessage('')
  }
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const payload = {
        displayName: form.displayName,
        baseUrl: form.baseUrl,
        modelId: form.modelId,
        contextWindow: form.contextWindow,
        maxOutputTokens: form.maxOutputTokens,
        requestTimeoutMs: form.requestTimeoutMs,
        apiKey: form.apiKey,
        noCredential: form.noCredential,
        persistCredential: form.persistCredential,
      }
      setStatus(await request<ModelStatus>('/model', 'POST', payload))
      setForm((f) => ({ ...f, apiKey: '' }))
      setMessage('已配置 · 尚未测试')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const probe = async () => {
    setBusy(true)
    setError('')
    try {
      setStatus(await request<ModelStatus>('/model/test', 'POST', {}))
      setMessage('连接测试通过')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button className="back-link" onClick={() => go('/local')}>
        <ArrowLeft size={17} />
        本地项目
      </button>
      <PageTitle
        eyebrow="YOUR MODEL, YOUR CHOICE"
        title="接上你自己的模型。"
        subtitle="材料在本机管理，核对时使用你选择的模型服务。"
      />
      <div className="local-material-grid">
        <section className="panel model-live-form">
          <h2>本次连接</h2>
          <p className="muted">
            OpenAI Chat Completions 兼容协议。普通参数保存在本机；保存不会自动调用模型。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <fieldset disabled={busy}>
              <label>
                连接名称
                <input
                  value={form.displayName}
                  maxLength={120}
                  required
                  onChange={(e) => change('displayName', e.target.value)}
                />
              </label>
              <label>
                服务地址
                <input
                  type="url"
                  placeholder="https://你的服务地址/v1"
                  value={form.baseUrl}
                  required
                  onChange={(e) => change('baseUrl', e.target.value)}
                />
              </label>
              <label>
                模型 ID
                <input
                  placeholder="填写模型名或接入点 ID"
                  value={form.modelId}
                  required
                  onChange={(e) => change('modelId', e.target.value)}
                />
              </label>
              <div className="check-two-fields">
                <label>
                  上下文容量
                  <input
                    type="number"
                    min={4096}
                    max={2000000}
                    value={form.contextWindow}
                    onChange={(e) => change('contextWindow', Number(e.target.value))}
                  />
                </label>
                <label>
                  输出上限
                  <input
                    type="number"
                    min={512}
                    max={100000}
                    value={form.maxOutputTokens}
                    onChange={(e) => change('maxOutputTokens', Number(e.target.value))}
                  />
                </label>
              </div>
              <p className="small muted">
                请按服务实际支持的 token 容量填写，上面是可编辑的起始值。
              </p>
              <label>
                超时（秒）
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={form.requestTimeoutMs / 1000}
                  onChange={(e) => change('requestTimeoutMs', Number(e.target.value) * 1000)}
                />
              </label>
              <label className="check-choice">
                <input
                  type="checkbox"
                  checked={form.noCredential}
                  onChange={(e) => change('noCredential', e.target.checked)}
                />
                仅本机服务，无需密钥
              </label>
              {!form.noCredential && (
                <label>
                  API Key
                  <input
                    type="password"
                    autoComplete="off"
                    value={form.apiKey}
                    required
                    onChange={(e) => change('apiKey', e.target.value)}
                  />
                </label>
              )}
              {!form.noCredential&&<label className="check-choice"><input type="checkbox" checked={form.persistCredential} disabled={!status?.credentialStoreAvailable} onChange={e=>change('persistCredential',e.target.checked)}/>保存密钥到系统钥匙串</label>}
              <p className="small muted">不勾选时只在本次服务内存使用，重启后需要重新填密钥。系统安全存储不可用时不写明文。</p>
              <div className="check-actions">
                <Button type="submit" kind="primary">
                  保存本次连接
                </Button>
                <Button
                  type="button"
                  disabled={!status?.configured}
                  onClick={() => void probe()}
                >
                  {busy ? '处理中…' : '测试连接'}
                </Button>
              </div>
            </fieldset>
          </form>
          {message && (
            <p role="status" className="check-success">
              <Check size={17} />
              {message}
            </p>
          )}
          {error && (
            <div role="alert">
              <Notice tone="warning">{error}</Notice>
            </div>
          )}
        </section>
        <aside className="panel local-reading-note">
          <Settings2 size={26} />
          <h2>连接由你决定。</h2>
          <p>
            测试连接只发送短合成样例，可能产生少量模型费用。它验证文字与结构化回复，不代表模型判断一定准确。
          </p>
          <p>
            开始抽取或核对前，会再次展示本次发送范围。当前不会发送原始文件、系统目录或其他项目。
          </p>
          <Notice>
            Key 只在提交时发送到本机服务，随后清空输入框；不写入浏览器存储或项目数据库。
          </Notice>
          <Button onClick={()=>go('/local/storage')}>本地数据与诊断</Button>
          {status?.restoreWarning&&<Notice tone="warning">连接或系统凭据恢复未完成，请重新配置。</Notice>}
          {status?.cleanupPending&&<Notice tone="warning">有临时模型会话尚未安全清理。请先确认旧服务已退出；未知目录会保留，需要在本机检查。仍有旧进程时会暂停新核对。</Notice>}
          {status?.connection && (
            <p className="small">
              当前：{status.connection.displayName} · {status.connection.modelId}
              <br />
              {status.tested ? '已测试连接' : '尚未测试连接'}
              <br/>{status.needsCredential?'参数已恢复，请重新填写密钥':status.credentialStorage==='keychain'?'密钥保存在系统钥匙串':status.credentialStorage==='session'?'密钥仅本次使用':'本机无凭据模式'}
            </p>
          )}
          {status?.connection&&<Button disabled={busy||status.busy} onClick={()=>setForgetting(true)}>移除模型连接与保存的密钥</Button>}
        </aside>
      </div>
      {forgetting&&<Modal title="移除这份模型连接？" onClose={()=>{if(!busy)setForgetting(false)}}>
        <p>移除本机保存的连接参数、系统钥匙串中的本应用密钥和当前内存密钥。项目和交付记录保留。</p>
        <Button disabled={busy} onClick={()=>setForgetting(false)}>取消</Button>
        <Button kind="primary" disabled={busy} onClick={()=>{setBusy(true);void request<ModelStatus>('/model','DELETE',{confirm:true}).then(s=>{setStatus(s);setForgetting(false);setMessage('连接已移除')}).catch(e=>setError(e.message)).finally(()=>setBusy(false))}}>确认移除连接</Button>
      </Modal>}
    </>
  )
}
const stateNames = {
  open: '待处理',
  pending_recheck: '等待重新核对',
  resolved_verified: '复核已解决',
  dismissed: '已标为误报',
  accepted_risk: '已接受风险',
  stale: '材料已变更，需复核',
}
export function LocalCheck({ id, go }: { id: string; go: (path: string) => void }) {
  const [view, setView] = useState<CheckView | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [model, setModel] = useState<ModelStatus | null>(null),
    [consent, setConsent] = useState(false)
  const [edits, setEdits] = useState<RequirementEdit[]>([]),
    [scope, setScope] = useState<string[]>([]),
    [preview, setPreview] = useState<Finding | null>(null),
    [reasons, setReasons] = useState<Record<string, string>>({})
  const path = `/projects/${id}/analysis`
  const refresh = useCallback(async () => {
    const next = await request<CheckView>(path)
    setView(next)
    return next
  }, [path])
  useEffect(() => {
    void refresh().catch((e) => setError(e.message))
    void request<ModelStatus>('/model')
      .then(setModel)
      .catch((e) => setError(e.message))
  }, [refresh])
  const draftKey = view
    ? `${view.workflow.draftInputHash}:${view.workflow.draft.map((r) => r.id).join(',')}:${view.workflow.requirementsVersion}`
    : ''
  useEffect(() => {
    if (view)
      setEdits(
        (view.workflow.draft.length ? view.workflow.draft : view.workflow.requirements).map(
          editOf,
        ),
      )
  }, [draftKey])
  const scopeKey = view
    ? JSON.stringify(view.workflow.selectedSnapshotIds ?? view.material.files.map((f) => f.id))
    : ''
  useEffect(() => {
    if (view)
      setScope(view.workflow.selectedSnapshotIds ?? view.material.files.map((f) => f.id))
  }, [scopeKey])
  const active = !!view?.project.activeRunId
  useEffect(() => {
    if (!active) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        if (alive) await refresh()
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally {
        if (alive) timer = setTimeout(poll, 900)
      }
    }
    timer = setTimeout(poll, 500)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [active, refresh])
  const act = async (action: string, data: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    try {
      await request(`${path}/${action}`, 'POST', data)
      await refresh()
    } catch (e) {
      setError((e as Error).message)
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  if (!view)
    return (
      <div className="panel">
        <p role="status">正在打开核对台…</p>
        {error && <p role="alert">{error}</p>}
        <Button onClick={() => void refresh().catch((e) => setError(e.message))}>
          重新加载
        </Button>
      </div>
    )
  const workflow = view.workflow,
    run = workflow.runs.at(-1),
    lastCheck = workflow.runs.findLast((r) => r.kind === 'check'),
    requirementsDirty =
      workflow.draft.length > 0 ||
      JSON.stringify(edits) !== JSON.stringify(workflow.requirements.map(editOf)),
    disabled = busy || active
  const update = (index: number, patch: Partial<RequirementEdit>) =>
    setEdits((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const decide = (finding: Finding, action: DecisionAction) =>
    void act('decide', {
      expectedRevision: view.project.revision,
      runId: lastCheck!.id,
      findingId: finding.id,
      action,
      reason: reasons[finding.id] ?? '',
    })
  const scopeDirty =
    JSON.stringify([...scope].sort()) !==
    JSON.stringify(
      [...(workflow.selectedSnapshotIds ?? view.material.files.map((f) => f.id))].sort(),
    )
  return (
    <>
      <button className="back-link" onClick={() => go(`/local/projects/${id}`)}>
        <ArrowLeft size={17} />
        返回材料
      </button>
      <PageTitle
        eyebrow="ONE LAST LOOK"
        title="把最后几件事，核对清楚。"
        subtitle={view.project.name}
      >
        <Button onClick={() => go('/local/model')}>
          <Settings2 size={17} />
          模型设置
        </Button>
      </PageTitle>
      {error && (
        <div role="alert">
          <Notice tone="warning">{error}</Notice>
        </div>
      )}
      <div className="check-workbench">
        <aside className="panel check-scope">
          <h2>这次看哪些材料</h2>
          <p className="small muted">
            主动选择版本，旧副本会继续保存。取消选择后的文件不会参与本次核对。
          </p>
          {view.material.files.map((f) => (
            <label className="check-choice" key={f.id}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={scope.includes(f.id)}
                onChange={(e) =>
                  setScope((list) =>
                    e.target.checked ? [...list, f.id] : list.filter((key) => key !== f.id),
                  )
                }
              />
              <span>
                {f.originalName}
                <small>
                  v{f.version} ·{' '}
                  {f.role === 'requirement'
                    ? '对方的要求'
                    : f.role === 'deliverable'
                      ? '准备交的材料'
                      : '参考材料'}{' '}
                  ·{' '}
                  {f.parseStatus === 'complete'
                    ? '文字已读取'
                    : f.parseStatus === 'partial'
                      ? '部分未覆盖'
                      : '请先读取'}
                </small>
              </span>
            </label>
          ))}
          <Button
            disabled={disabled || !scopeDirty || !scope.length}
            onClick={() =>
              void act('scope', {
                expectedRevision: view.project.revision,
                snapshotIds: scope,
              })
            }
          >
            保存检查范围
          </Button>
          <hr />
          <p className="small">
            {model?.connection
              ? `使用 ${model.connection.displayName} · ${model.connection.modelId}`
              : '尚未配置自己的模型'}
          </p>
          <label className="check-choice consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            允许把本次选定材料的文字发送到已配置模型
          </label>
          <p className="small muted">
            可能产生模型费用；你可以在运行时停止。手写和确认要求不调用模型。
          </p>
        </aside>
        <div className="check-main">
          <section className="panel">
            <div className="section-header">
              <h2>先确认，这次要交什么</h2>
              <Tag>
                {workflow.requirements.length
                  ? `已确认 ${workflow.requirements.length} 条要求`
                  : '等待确认'}
              </Tag>
            </div>
            <p className="muted">
              AI 抽取的清单只是草稿。补充具体日期、拆开多个交付项，再确认。
            </p>
            <div className="check-actions">
              <Button
                disabled={disabled || !consent || !model?.configured || scopeDirty}
                onClick={() =>
                  void act('start', {
                    expectedRevision: view.project.revision,
                    kind: 'requirements',
                    consent: true,
                    modelConnectionId: model?.connection?.id,
                  })
                }
              >
                从要求材料抽取
              </Button>
              <Button
                disabled={disabled}
                onClick={() =>
                  setEdits((rows) => [
                    ...rows,
                    {
                      id: crypto.randomUUID(),
                      text: '',
                      importance: 'must',
                      originKind: 'user',
                      sourceEvidence: [],
                      applicability: 'applicable',
                      reason: '',
                    },
                  ])
                }
              >
                <Plus size={16} />
                手写一条
              </Button>
            </div>
            <div className="requirement-edit-list">
              {edits.map((r, i) => (
                <div className="requirement-edit" key={r.id}>
                  <label>
                    要求 {i + 1}
                    <textarea
                      value={r.text}
                      disabled={disabled}
                      maxLength={1000}
                      onChange={(e) => update(i, { text: e.target.value })}
                    />
                  </label>
                  <div className="check-two-fields">
                    <label>
                      重要程度
                      <select
                        disabled={disabled}
                        value={r.importance}
                        onChange={(e) =>
                          update(i, { importance: e.target.value as 'must' | 'should' })
                        }
                      >
                        <option value="must">必须</option>
                        <option value="should">建议</option>
                      </select>
                    </label>
                    <label>
                      是否适用
                      <select
                        disabled={disabled}
                        value={r.applicability}
                        onChange={(e) =>
                          update(i, {
                            applicability: e.target.value as 'applicable' | 'not_applicable',
                          })
                        }
                      >
                        <option value="applicable">适用</option>
                        <option value="not_applicable">不适用</option>
                      </select>
                    </label>
                  </div>
                  {r.applicability === 'not_applicable' && (
                    <label>
                      不适用原因
                      <input
                        value={r.reason}
                        disabled={disabled}
                        onChange={(e) => update(i, { reason: e.target.value })}
                      />
                    </label>
                  )}
                  <div className="check-actions">
                    <span className="small muted">
                      {r.originKind === 'source'
                        ? '来自材料'
                        : r.originKind === 'suggested'
                          ? 'AI 推断 · 请仔细确认'
                          : '手写要求'}
                    </span>
                    <Button
                      kind="text"
                      disabled={disabled}
                      onClick={() => setEdits((rows) => rows.filter((_, n) => n !== i))}
                    >
                      删除此条
                    </Button>
                  </div>
                  {r.sourceEvidence.length > 0 && (
                    <details>
                      <summary>要求出处</summary>
                      {r.sourceEvidence.map((e, n) => (
                        <blockquote key={n}>{e.quote}</blockquote>
                      ))}
                    </details>
                  )}
                </div>
              ))}
            </div>
            <Button
              kind="primary"
              disabled={disabled || !edits.length || scopeDirty}
              onClick={() =>
                void act('confirm', { expectedRevision: view.project.revision, edits })
              }
            >
              确认这份清单 <Check size={16} />
            </Button>
          </section>
          <section className="panel check-run-panel">
            <div className="section-header">
              <h2>再把材料，对一遍。</h2>
              <ShieldCheck size={23} />
            </div>
            <p>检查只针对当前确认的要求与选定材料。文件原件不会被修改。</p>
            {requirementsDirty && <p role="status">清单有未确认的修改，请先确认后再核对。</p>}
            <div className="check-actions">
              <Button
                kind="primary"
                disabled={
                  disabled ||
                  !consent ||
                  !model?.configured ||
                  !workflow.requirements.length ||
                  requirementsDirty ||
                  scopeDirty
                }
                onClick={() =>
                  void act('start', {
                    expectedRevision: view.project.revision,
                    kind: 'check',
                    consent: true,
                    modelConnectionId: model?.connection?.id,
                  })
                }
              >
                {lastCheck ? '重新核对' : '开始核对'}
                <ArrowRight size={17} />
              </Button>
              <Button
                disabled={busy || !active || run?.state === 'stop_unconfirmed'}
                onClick={() => void act('cancel', { runId: view.project.activeRunId })}
              >
                停止本次任务
              </Button>
              <Button
                kind="text"
                disabled={busy}
                onClick={() => void refresh().catch((e) => setError(e.message))}
              >
                <RefreshCw size={16} />
                刷新状态
              </Button>
            </div>
            {run && (
              <div className="check-progress" role="status">
                <strong>{run.stage}</strong>
                <p className="small">
                  已完成 {run.completedBatches} / {run.totalBatches || '待确定'} 个批次（复用{' '}
                  {run.cachedBatches ?? 0} 个） · {run.model.displayName}
                </p>
                {run.totalBatches > 0 && (
                  <progress
                    value={run.completedBatches}
                    max={run.totalBatches}
                    aria-label="真实批次进度"
                  />
                )}
                {run.error && <p>{run.error.userMessage}</p>}
                <p className="small muted">
                  {run.endedAt ? `耗时 ${(run.durationMs / 1000).toFixed(1)} 秒` : '正在处理'}{' '}
                  ·{' '}
                  {run.usage
                    ? `输入 ${run.usage.promptTokens ?? '未知'} / 输出 ${run.usage.completionTokens ?? '未知'} tokens`
                    : '用量未知'}
                </p>
              </div>
            )}
            {view.stale && (
              <Notice tone="warning">要求或材料已变化，上次结果已过期，请重新核对。</Notice>
            )}
            {lastCheck && !view.stale && (
              <p>
                {lastCheck.state === 'completed' && lastCheck.coverageComplete
                  ? `适用要求：${lastCheck.results.filter((r) => r.status === 'met').length} / ${lastCheck.results.length} 有满足证据`
                  : '统计未完成：还有失败、未知或未覆盖的范围。'}
              </p>
            )}
            {lastCheck?.gaps.map((gap, i) => (
              <Notice key={i} tone="warning">
                {gap}
              </Notice>
            ))}
            {lastCheck?.rejected.length ? (
              <Notice tone="warning">
                有 {lastCheck.rejected.length} 个候选因引用或范围不足被拒绝，未作为确定结论。
              </Notice>
            ) : null}
          </section>
          <section className="check-findings">
            <div className="check-actions">
              <Button
                disabled={
                  disabled ||
                  requirementsDirty ||
                  scopeDirty ||
                  !lastCheck ||
                  lastCheck.state !== 'completed' ||
                  view.stale
                }
                onClick={() => go(`/local/projects/${id}/delivery`)}
              >
                准备交付
                <ArrowRight size={17} />
              </Button>
            </div>
            <div className="section-header">
              <h2>留给你决定的几件事</h2>
              <span className="small muted">
                {view.findings.filter((f) => f.reviewState !== 'resolved_verified').length} 项
              </span>
            </div>
            {view.findings.length === 0 && (
              <div className="panel">
                <p>
                  {lastCheck?.state === 'completed'
                    ? '本次没有有效问题候选；仍需结合覆盖范围与要求状态判断。'
                    : '完成核对后，问题和原文出处会放在这里。'}
                </p>
              </div>
            )}
            {view.findings.map((f) => (
              <article className="panel check-finding" key={f.id}>
                <div className="section-header">
                  <Tag tone={f.severity === 'blocker' ? 'amber' : ''}>
                    {f.severity === 'blocker'
                      ? '需要处理'
                      : f.severity === 'attention'
                        ? '需要确认'
                        : '建议'}
                  </Tag>
                  <Tag tone={f.reviewState === 'resolved_verified' ? 'green' : ''}>
                    {stateNames[f.reviewState]}
                  </Tag>
                </div>
                <h3>{f.title}</h3>
                <p>{f.explanation}</p>
                <Button onClick={() => setPreview(f)}>查看证据</Button>
                {workflow.decisions
                  .filter((d) => d.fingerprint === f.fingerprint)
                  .slice(-1)
                  .map((d) => (
                    <p key={d.id} className="small decision-note">
                      {d.reason}
                    </p>
                  ))}
                {f.reviewState !== 'resolved_verified' && (
                  <>
                    <label>
                      处理原因
                      <textarea
                        maxLength={1000}
                        disabled={disabled || view.stale}
                        value={reasons[f.id] ?? ''}
                        onChange={(e) => setReasons((v) => ({ ...v, [f.id]: e.target.value }))}
                      />
                    </label>
                    <div className="check-actions">
                      <Button
                        disabled={disabled || view.stale || !reasons[f.id]?.trim()}
                        onClick={() => decide(f, 'pending_recheck')}
                      >
                        已在外部修改，待复核
                      </Button>
                      <Button
                        disabled={disabled || view.stale || !reasons[f.id]?.trim()}
                        onClick={() => decide(f, 'dismissed')}
                      >
                        标为误报
                      </Button>
                      <Button
                        disabled={disabled || view.stale || !reasons[f.id]?.trim()}
                        onClick={() => decide(f, 'accepted_risk')}
                      >
                        接受风险
                      </Button>
                    </div>
                  </>
                )}
              </article>
            ))}
            <p className="small muted">
              修改后请返回材料页导入新版本，再重新核对。点击“已修改”不会直接标记解决。交付打包将在下一阶段提供。
            </p>
          </section>
        </div>
      </div>
      {preview && (
        <Modal title="问题的原文出处" wide onClose={() => setPreview(null)}>
          {preview.evidence.length ? (
            preview.evidence.map((e, i) => {
              const block = view.material.blocks.find((b) => b.id === e.blockId),
                file = view.material.files.find((f) => f.id === e.snapshotId)
              return (
                <section key={i} className="check-evidence">
                  <h3>
                    {file?.originalName ?? '历史材料'} · v{file?.version}
                  </h3>
                  <p className="small muted">
                    {block ? locatorLabel(block.locator) : '片段不可定位'}
                  </p>
                  <blockquote>{e.quote}</blockquote>
                  {block && (
                    <details>
                      <summary>查看完整片段</summary>
                      <pre className="source-text">{block.text}</pre>
                    </details>
                  )}
                </section>
              )
            })
          ) : (
            <p>此项由选定的文件版本信息产生，没有虚构文字引用。</p>
          )}
          {preview.searchedSnapshotIds.length > 0 && (
            <p className="small">
              检索范围：
              {preview.searchedSnapshotIds
                .map(
                  (key) => view.material.files.find((f) => f.id === key)?.originalName ?? key,
                )
                .join('、')}
            </p>
          )}
        </Modal>
      )}
    </>
  )
}
