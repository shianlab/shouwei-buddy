import { useCallback, useEffect, useState } from 'react'
import type {
  CheckView,
  DeliveryRecord,
  DeliveryInput,
  DeliveryHistoryItem,
} from '@shouwei/contracts'
import {
  ArrowLeft,
  ArrowRight,
  PackageCheck,
  Download,
  FileText,
  RefreshCw,
} from 'lucide-react'
import { Button, PageTitle, Notice, Empty, Tag } from './components'
import { request } from './local-api'
const labels = {
  ready: '可以交付',
  ready_with_notes: '带说明交付',
  needs_work: '还有事项要处理',
  incomplete: '统计未完成',
}
const defaultNote = (v: CheckView) =>
  `请查收「${v.project.name}」的本次材料。${v.project.recipient ? '收件人：' + v.project.recipient + '。' : ''}\n\n${v.project.goal}`
async function download(record: DeliveryRecord, kind: 'zip' | 'report') {
  const response = await fetch(
    `/api/projects/${record.projectId}/deliveries/${record.id}/download/${kind}`,
    { headers: { 'x-shouwei-request': 'local' } },
  )
  if (!response.ok)
    throw new Error((await response.json()).error?.userMessage ?? '下载未完成，请重试。')
  const url = URL.createObjectURL(await response.blob()),
    link = document.createElement('a')
  link.href = url
  link.download =
    record.projectName.replace(/[\\/<>:"|?*]/g, '_') +
    (kind === 'zip' ? '-交付包.zip' : '-检查报告.html')
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
export function LocalDelivery({ id, go }: { id: string; go: (path: string) => void }) {
  const [view, setView] = useState<CheckView | null>(null),
    [files, setFiles] = useState<DeliveryInput['files']>([]),
    [note, setNote] = useState(''),
    [risks, setRisks] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<DeliveryRecord | null>(null),
    [live, setLive] = useState<DeliveryRecord | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const base = `/projects/${id}/deliveries`
  useEffect(() => {
    void request<CheckView>(`/projects/${id}/analysis`)
      .then((v) => {
        setView(v)
        const run = v.workflow.runs.findLast((r) => r.kind === 'check')
        setFiles(
          v.material.files
            .filter((f) => f.role === 'deliverable' && run?.selectedSnapshotIds.includes(f.id))
            .map((f) => ({ snapshotId: f.id, name: f.originalName })),
        )
        setNote(defaultNote(v))
      })
      .catch((e) => setError(e.message))
  }, [id])
  const payload = useCallback(
    () => ({
      expectedRevision: view?.project.revision ?? 1,
      files,
      note,
      requirementRisks: Object.entries(risks)
        .filter(([, reason]) => reason.trim())
        .map(([requirementId, reason]) => ({ requirementId, reason })),
    }),
    [view, files, note, risks],
  )
  useEffect(() => {
    setPreview(null)
    setLive(null)
    if (!view || !files.length) return
    let alive = true
    const timer = setTimeout(() => {
      void request<DeliveryRecord>(base + '/preview', 'POST', payload())
        .then((record) => {
          if (alive) {
            setLive(record)
            setError('')
          }
        })
        .catch((e) => {
          if (alive) setError(e.message)
        })
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [payload, base])
  const action = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!view)
    return (
      <div className="panel">
        <p role="status">正在整理交付台…</p>
        {error && <Notice tone="warning">{error}</Notice>}
      </div>
    )
  const run = view.workflow.runs.findLast((r) => r.kind === 'check'),
    assessment = (preview ?? live)?.assessment
  return (
    <>
      <Button kind="text" onClick={() => go(`/local/projects/${id}/check`)}>
        <ArrowLeft size={16} />
        返回核对
      </Button>
      <PageTitle
        eyebrow="PACK IT WITH CARE"
        title="把这份材料，收好交出去。"
        subtitle="选定要交的版本，附上一段清楚的说明。"
      />
      {error && <Notice tone="warning">{error}</Notice>}
      {message && <p role="status">{message}</p>}
      {assessment && (
        <Notice tone={assessment.blockers.length ? 'warning' : 'info'}>
          <strong>{labels[assessment.conclusion]}</strong> · 必须要求 {assessment.mustMet}/
          {assessment.mustTotal} 有满足证据；接受风险 {assessment.risks.length} 项。
          {assessment.blockers.map((reason, i) => (
            <p key={i}>{reason}</p>
          ))}
        </Notice>
      )}
      <div className="delivery-workbench">
        <section className="panel">
          <div className="section-header">
            <h2>交给对方的附件</h2>
            <PackageCheck size={23} />
          </div>
          <p className="muted">
            只列本次已核对的待交材料。改名只影响交付副本；同一材料只选一个版本。
          </p>
          {view.material.files
            .filter((f) => f.role === 'deliverable')
            .map((f) => {
              const selected = files.find((row) => row.snapshotId === f.id),
                checked = run?.selectedSnapshotIds.includes(f.id)
              return (
                <div key={f.id} className="delivery-file">
                  <label className="delivery-select">
                    <input
                      type="checkbox"
                      checked={!!selected}
                      disabled={busy || !checked}
                      onChange={(e) =>
                        setFiles((rows) =>
                          e.target.checked
                            ? [...rows, { snapshotId: f.id, name: f.originalName }]
                            : rows.filter((row) => row.snapshotId !== f.id),
                        )
                      }
                    />
                    <span>
                      {f.originalName}
                      <small>
                        v{f.version} · {checked ? '已在核对范围' : '未核对，请返回重新选范围'}
                      </small>
                    </span>
                  </label>
                  {selected && (
                    <label>
                      导出名称
                      <input
                        aria-label={`导出名称：${f.originalName}`}
                        disabled={busy}
                        value={selected.name}
                        onChange={(e) =>
                          setFiles((rows) =>
                            rows.map((row) =>
                              row.snapshotId === f.id ? { ...row, name: e.target.value } : row,
                            ),
                          )
                        }
                      />
                    </label>
                  )}
                </div>
              )
            })}
          <details>
            <summary>不包含的要求与参考材料</summary>
            {view.material.files
              .filter((f) => f.role !== 'deliverable')
              .map((f) => (
                <p key={f.id}>
                  {f.originalName} · v{f.version}
                </p>
              ))}
          </details>
        </section>
        <section className="panel">
          <div className="section-header">
            <h2>给收件人的一句话</h2>
            <FileText size={23} />
          </div>
          <label>
            交付说明
            <textarea
              rows={7}
              maxLength={10000}
              disabled={busy}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="check-actions">
            <Button
              disabled={busy}
              onClick={() => {
                void navigator.clipboard.writeText(note).then(
                  () => setMessage('交付说明已复制。'),
                  () => setError('浏览器没有允许复制，请手动选择文字。'),
                )
              }}
            >
              复制文字
            </Button>
            <Button disabled={busy} kind="text" onClick={() => setNote(defaultNote(view))}>
              恢复建议文案
            </Button>
          </div>
          <h3>业务上仍待确认的要求</h3>
          <p className="small muted">逐条写明风险原因。读取失败或附件遗漏需要先处理。</p>
          {view.workflow.requirements
            .filter(
              (r) =>
                r.importance === 'must' &&
                r.applicability === 'applicable' &&
                run?.results.find((m) => m.requirementId === r.id)?.status !== 'met',
            )
            .map((r) => (
              <label key={r.id}>
                {r.text}
                <textarea
                  aria-label={`接受要求风险：${r.text}`}
                  maxLength={1000}
                  disabled={busy}
                  value={risks[r.id] ?? ''}
                  placeholder="选择带风险交付时填写；留空则继续阻止交付"
                  onChange={(e) => setRisks((rows) => ({ ...rows, [r.id]: e.target.value }))}
                />
              </label>
            ))}
          <h3>独立保留的风险说明</h3>
          <p className="small muted">
            系统会把这些风险另存为「风险说明.md」，修改上面的文字不会删掉它们。
          </p>
          {assessment?.risks.length ? (
            assessment.risks.map((risk, i) => (
              <blockquote key={i}>
                <strong>{risk.title}</strong>
                <p>{risk.reason}</p>
              </blockquote>
            ))
          ) : (
            <p className="muted">当前没有已接受风险。</p>
          )}
        </section>
      </div>
      <div className="panel delivery-actions">
        <p>将创建新的材料包。ZIP 给收件人，检查报告留给自己；生成过程不调用模型。</p>
        <div className="check-actions">
          <Button
            disabled={busy || !files.length}
            onClick={() =>
              void action(async () => {
                const record = await request<DeliveryRecord>(base, 'POST', payload())
                setPreview(record)
                setLive(record)
              })
            }
          >
            预览交付包
          </Button>
          <Button
            kind="primary"
            disabled={
              busy ||
              !preview ||
              !['ready', 'ready_with_notes'].includes(preview.assessment.conclusion)
            }
            onClick={() =>
              void action(async () => {
                const record = await request<DeliveryRecord>(
                  `${base}/${preview!.id}/export`,
                  'POST',
                  {},
                )
                go(`/local/projects/${id}/deliveries/${record.id}`)
              })
            }
          >
            {busy ? '正在收好…' : '生成交付包'}
            <ArrowRight size={17} />
          </Button>
        </div>
      </div>
    </>
  )
}
export function LocalComplete({
  id,
  deliveryId,
  go,
}: {
  id: string
  deliveryId: string
  go: (path: string) => void
}) {
  const [record, setRecord] = useState<DeliveryRecord | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    void request<DeliveryRecord>(`/projects/${id}/deliveries/${deliveryId}`)
      .then(setRecord)
      .catch((e) => setError(e.message))
  }, [id, deliveryId])
  const fetchArtifact = async (kind: 'zip' | 'report') => {
    if (!record) return
    setBusy(true)
    setError('')
    try {
      await download(record, kind)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!record)
    return (
      <div className="panel">
        <p role="status">正在取出交付记录…</p>
        {error && <Notice tone="warning">{error}</Notice>}
      </div>
    )
  return (
    <>
      <PageTitle
        eyebrow="A LITTLE MORE AT EASE"
        title={record.state === 'completed' ? '这份收尾，收好了。' : '这次交付还没有完成。'}
        subtitle="下面是生成时的记录，后续修改项目不会改写这份交付。"
      />
      {error && <Notice tone="warning">{error}</Notice>}
      <section className="panel delivery-receipt">
        <PackageCheck size={42} />
        <span className="eyebrow">交付签 / {record.projectName}</span>
        <h2>{labels[record.assessment.conclusion]}</h2>
        <p>
          {record.files.length} 份附件 · 接受风险 {record.assessment.risks.length} 项
        </p>
        <p className="muted">
          {record.completedAt
            ? new Date(record.completedAt).toLocaleString('zh-CN')
            : '尚未生成'}
        </p>
        <p className="small muted">
          产物已在本机核验；请分别下载保存。浏览器取消保存不会删除交付记录。
        </p>
        {record.state === 'completed' && (
          <div className="check-actions">
            <Button kind="primary" disabled={busy} onClick={() => void fetchArtifact('zip')}>
              <Download size={17} />
              下载给收件人的 ZIP
            </Button>
            <Button disabled={busy} onClick={() => void fetchArtifact('report')}>
              <FileText size={17} />
              下载自己的检查报告
            </Button>
          </div>
        )}
        {record.error && <Notice tone="warning">{record.error}</Notice>}
        <div className="check-actions">
          <Button onClick={() => go('/local/history')}>查看交付记录</Button>
          <Button kind="text" onClick={() => go(`/local/projects/${id}/delivery`)}>
            再收一份
          </Button>
        </div>
      </section>
      <section className="panel">
        <h2>本次附件</h2>
        {record.files.map((file) => (
          <p key={file.snapshotId}>
            {file.name} · v{file.version}
          </p>
        ))}
        {record.assessment.risks.length > 0 && (
          <>
            <h2>随包保留的风险</h2>
            {record.assessment.risks.map((risk, i) => (
              <blockquote key={i}>
                {risk.title}
                <p>{risk.reason}</p>
              </blockquote>
            ))}
          </>
        )}
      </section>
    </>
  )
}
export function LocalHistory({ go }: { go: (path: string) => void }) {
  const [items, setItems] = useState<DeliveryHistoryItem[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all')
  const refresh = () => {
    setLoading(true)
    void request<DeliveryHistoryItem[]>('/deliveries')
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [])
  const filtered = items.filter(
    (item) =>
      item.projectName.includes(search) && (filter === 'all' || item.conclusion === filter),
  )
  return (
    <>
      <PageTitle
        eyebrow="SAVED WITH CARE"
        title="交过的东西，都有一份记录。"
        subtitle="这里保存真实交付快照；后续核对和改稿不会改写旧记录。"
      >
        <Button onClick={refresh}>
          <RefreshCw size={16} />
          刷新记录
        </Button>
      </PageTitle>
      {error && <Notice tone="warning">{error}</Notice>}
      <div className="panel check-two-fields">
        <label>
          搜索项目
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          交付状态
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="ready">可以交付</option>
            <option value="ready_with_notes">带说明交付</option>
          </select>
        </label>
      </div>
      {loading ? (
        <p role="status">正在查看交付记录…</p>
      ) : filtered.length ? (
        filtered.map((item) => (
          <article className="panel delivery-history-row" key={item.id}>
            <div>
              <h2>{item.projectName}</h2>
              <p className="muted">
                {item.fileCount} 份材料 · {item.modelName} ·{' '}
                {new Date(item.completedAt ?? item.createdAt).toLocaleString('zh-CN')}
              </p>
              <Tag>{labels[item.conclusion]}</Tag>
              {!item.available && (
                <p className="small">产物已移动、删除或校验失败，历史仍保留。</p>
              )}
            </div>
            <Button
              onClick={() => go(`/local/projects/${item.projectId}/deliveries/${item.id}`)}
            >
              查看交付签
              <ArrowRight size={17} />
            </Button>
          </article>
        ))
      ) : (
        <Empty title="还没有交付记录。" detail="完成核对后，整理并生成第一份交付包。">
          <Button onClick={() => go('/local')}>打开本地项目</Button>
        </Empty>
      )}
    </>
  )
}
