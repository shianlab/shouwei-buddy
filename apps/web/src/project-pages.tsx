import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  Info,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Paperclip,
  ListChecks,
} from 'lucide-react'
import { fixture, suggestedNote, suggestedRiskNote, type Scenario } from './demo-service'
import {
  Button,
  CoverageContent,
  Empty,
  FileRow,
  Mark,
  Modal,
  Notice,
  PageTitle,
  Stepper,
  Tag,
  projectPath,
  type PageProps,
} from './components'
import type { ProjectViewModel } from './view-model'

export function CheckPage({ state, dispatch, go }: PageProps) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (state.run !== 'running') return
    setStep(0)
    const timers = [1, 2, 3].map((i) => setTimeout(() => setStep(i), i * 420))
    timers.push(
      setTimeout(() => {
        dispatch({ type: 'finishRun' })
        if (state.scenario !== 'timeout') go(`${projectPath}/review`)
      }, 1800),
    )
    return () => timers.forEach(clearTimeout)
  }, [state.run, state.scenario, dispatch, go])
  const cancelled = state.run === 'cancelled'
  const failed = state.run === 'failed'
  const active = state.run === 'running'
  const stages = [
    '先把材料读一遍',
    '看看要求有没有着落',
    '把不一致的地方圈出来',
    '整理成几件能处理的小事',
  ]
  return (
    <>
      <Stepper name={state.name} current={1} go={go} />
      <div className="check-page">
        <Mark large />
        <div className="eyebrow">TAKE A SMALL BREATH</div>
        <h1 tabIndex={-1}>
          {cancelled
            ? '已停止这次示例检查。'
            : failed
              ? '这一步还没完成。'
              : active
                ? '我们把材料，一件件看过。'
                : '准备好，再一起看一遍。'}
        </h1>
        <p>
          {cancelled
            ? '示例材料和已完成的处理都保留了。'
            : failed
              ? '这是预设的超时情景，没有真实模型请求。'
              : '以下是固定样例的模拟进度，不代表真实文件解析或模型工作。'}
        </p>
        <section className="panel check-stages" aria-live="polite">
          {stages.map((stage, i) => (
            <div key={stage} className={`check-stage ${active && step === i ? 'active' : ''}`}>
              <span>
                {active && step > i ? <Check size={18} /> : String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <strong>{stage}</strong>
                <p>
                  {active && step >= i
                    ? [
                        '已载入 5 份内置文本',
                        '逐一对应 6 条要求',
                        '对照日期、预算与附件',
                        '把证据放到每个问题旁边',
                      ][i]
                    : '等待开始'}
                </p>
              </div>
              {active && step === i && <Tag tone="green">模拟进行中</Tag>}
            </div>
          ))}
        </section>
        <div className="actions centered">
          {active ? (
            <Button onClick={() => dispatch({ type: 'cancel' })}>取消检查</Button>
          ) : (
            <>
              <Button onClick={() => go('/projects/new')}>返回材料</Button>
              <Button
                kind="primary"
                onClick={() => {
                  if (failed) dispatch({ type: 'scenario', value: 'normal' })
                  dispatch({ type: 'start' })
                }}
              >
                {failed ? '重试当前阶段' : '继续检查'}
                <ArrowRight size={16} />
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
function Evidence({
  issue,
  copy,
}: {
  issue: ProjectViewModel['issues'][number]
  copy: () => void
}) {
  return (
    <div className="evidence-content">
      <div className="eyebrow">为什么需要你看一下</div>
      <h3>{issue.title}</h3>
      <p className="small muted">
        以下为发现问题时的示例原文。
        {issue.status !== 'open'
          ? '模拟修改后的文本可在材料列表查看。'
          : '一起回到材料里，确认一下。'}
      </p>
      {issue.evidence.map((evidence, i) => (
        <article className="evidence-paper" key={i}>
          <div className="evidence-file">
            <FileText size={16} />
            {fixture.files.find((file) => file.id === evidence.file)?.name}
          </div>
          <span className="small muted">{evidence.location}</span>
          <blockquote>{evidence.quote}</blockquote>
        </article>
      ))}
      <div className="evidence-tip">
        <Info size={17} />
        <p>
          {issue.id === 'I04'
            ? '已对照 F02—F05 全部示例文字；提到附件，不等于已经提供附件。'
            : '以对方确认的要求为准，先在材料中修正，再回来复核。'}
        </p>
      </div>
      <Button kind="text" onClick={copy}>
        <Copy size={16} />
        复制处理建议
      </Button>
    </div>
  )
}
export function Review({ state, view, dispatch, go, notify }: PageProps) {
  const [selected, setSelected] = useState('I01')
  const [materialsExpanded, setMaterialsExpanded] = useState(false)
  const [filter, setFilter] = useState<'open' | 'done'>('open')
  const [modal, setModal] = useState<'coverage' | 'evidence' | 'risk' | null>(null)
  const [reason, setReason] = useState('')
  const [filePreview, setFilePreview] = useState<string | null>(null)
  const issue = view.issues.find((item) => item.id === selected) ?? view.issues[0]!
  const activeIssues = view.issues.filter((item) =>
    filter === 'open'
      ? ['open', 'pending'].includes(item.status)
      : ['resolved', 'accepted'].includes(item.status),
  )
  const handleEvidence = (id: string) => {
    setSelected(id)
    if (window.innerWidth < 1280) setModal('evidence')
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${issue.title}：${issue.fix}`)
      notify('处理建议已复制。')
    } catch {
      notify('浏览器没有开放剪贴板，请在证据夹中选中文字复制。')
    }
  }
  const title =
    state.scenario === 'partial'
      ? '还有一些内容，暂时没看全。'
      : state.scenario === 'stale'
        ? '更新了材料，再看一遍就好。'
        : view.acceptedCount
          ? '这份可以交，记得带上说明。'
          : view.openCount + view.pendingCount
            ? `还有 ${view.openCount + view.pendingCount} 件小事，收好就能交了。`
            : '最后几件事，都收好了。'
  return (
    <>
      <Stepper name={state.name} current={1} go={go} />
      <PageTitle
        eyebrow="THE LAST LITTLE THINGS"
        title={title}
        subtitle="每一处提醒，都能回到原文。你来确认，我们一起收尾。"
      >
        <Button onClick={() => setModal('coverage')}>
          <ShieldCheck size={16} />
          检查范围
        </Button>
        <Button
          onClick={() => {
            dispatch({ type: 'start' })
            go(`${projectPath}/check`)
          }}
        >
          <RefreshCw size={16} />
          重新检查示例
        </Button>
      </PageTitle>
      <div className="review-overview">
        <div className="requirement-progress">
          <span>
            <ListChecks size={18} />
            必须项已满足
          </span>
          <strong>{state.scenario === 'partial' ? '未完成' : `${view.satisfied} / 6`}</strong>
          <div className="progress-track">
            <span style={{ width: `${(view.satisfied / 6) * 100}%` }} />
          </div>
        </div>
        <span className="small muted">固定样例 · 文字与附件核对</span>
        <label className="scenario-control">
          示例状态
          <select
            aria-label="示例状态"
            value={state.scenario}
            onChange={(e) => {
              dispatch({ type: 'scenario', value: e.target.value as Scenario })
              setFilter('open')
            }}
          >
            <option value="normal">标准样例</option>
            <option value="partial">部分覆盖</option>
            <option value="timeout">检查超时</option>
            <option value="stale">材料更新</option>
            <option value="risk">带风险分支</option>
            <option value="ready">已全部收好</option>
          </select>
        </label>
      </div>
      {state.scenario === 'partial' && (
        <Notice tone="warning">
          <strong>这次还不能算全部看过。</strong>
          <p>活动通知第 2 页为模拟扫描页，未覆盖图片内文字。</p>
          <Button onClick={() => dispatch({ type: 'scenario', value: 'stale' })}>
            换用文字版示例
          </Button>
        </Notice>
      )}
      {state.scenario === 'stale' && (
        <Notice tone="warning">
          <strong>材料有变化，这些结论需要再看一遍。</strong>
          <p>旧结论暂不用于本次交付，请复核示例修改。</p>
        </Notice>
      )}
      {state.scenario === 'timeout' && (
        <Notice tone="warning">已切换到超时示例。点击“重新检查示例”体验失败与恢复。</Notice>
      )}
      {view.acceptedCount > 0 && (
        <Notice tone="warning">
          <strong>有 1 项风险已接受，交付时会保留说明。</strong>
          <p>{view.riskNote}</p>
        </Notice>
      )}
      <div className="review-grid">
        <aside className={`materials-sidebar ${materialsExpanded ? 'expanded' : ''}`}>
          <div className="section-header">
            <h2>
              材料 <span className="count">{view.files.length}</span>
            </h2>
            <Paperclip className="materials-pin" size={16} />
            <button
              className="materials-toggle text-link"
              aria-expanded={materialsExpanded}
              onClick={() => setMaterialsExpanded(!materialsExpanded)}
            >
              {materialsExpanded ? '收起材料' : '展开材料'}
            </button>
          </div>
          <div className="sidebar-files">
            {view.files.map((file) => (
              <FileRow key={file.id} file={file} onClick={() => setFilePreview(file.text)} />
            ))}
          </div>
          <button className="text-link" onClick={() => go('/projects/new')}>
            <PlusIcon />
            回到材料托盘
          </button>
          <div className="sidebar-note">
            <span className="eyebrow">收尾小提示</span>
            <p>
              先处理日期与缺失项，
              <br />
              再确认最终版本。
            </p>
            <span className="pencil-line" />
          </div>
        </aside>
        <section className="issues-column" aria-label="核对问题">
          <div className="issue-tabs">
            <button aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>
              待收好 <span>{view.openCount + view.pendingCount}</span>
            </button>
            <button aria-pressed={filter === 'done'} onClick={() => setFilter('done')}>
              已收好 <span>{4 - view.openCount - view.pendingCount}</span>
            </button>
          </div>
          {activeIssues.length === 0 ? (
            <Empty title="这几件事，都有着落了。" detail="可以查看已收好的记录，再准备交付。">
              <Button onClick={() => setFilter(filter === 'open' ? 'done' : 'open')}>
                查看{filter === 'open' ? '已收好' : '待收好'}记录
              </Button>
            </Empty>
          ) : (
            activeIssues.map((item) => (
              <article
                key={item.id}
                className={`issue-card ${selected === item.id ? 'selected' : ''}`}
              >
                <div className="issue-meta">
                  <Tag
                    tone={
                      item.status === 'pending'
                        ? 'blue'
                        : item.status === 'resolved'
                          ? 'green'
                          : 'amber'
                    }
                  >
                    {item.status === 'pending'
                      ? '等待复核'
                      : item.status === 'resolved'
                        ? '已复核 · 示例'
                        : item.status === 'accepted'
                          ? '已接受风险'
                          : item.severity === 'blocker'
                            ? '需要处理'
                            : '等你确认'}
                  </Tag>
                  <span>{item.requirements.join(' · ')}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.status === 'pending' ? item.fix : item.description}</p>
                <div className="issue-actions">
                  <button
                    className="text-link"
                    aria-label={`查看证据：${item.title}`}
                    onClick={() => handleEvidence(item.id)}
                  >
                    查看证据 <ChevronRight size={15} />
                  </button>
                  <Button
                    disabled={item.status !== 'open'}
                    onClick={() => {
                      dispatch({ type: 'fix', id: item.id })
                      setSelected(item.id)
                      notify('已模拟修改，复核后才会收好。')
                    }}
                  >
                    {item.action}
                  </Button>
                </div>
                {state.scenario === 'risk' && item.id === 'I02' && item.status === 'open' && (
                  <button className="text-link risk-link" onClick={() => setModal('risk')}>
                    本次接受这个风险
                  </button>
                )}
              </article>
            ))
          )}
        </section>
        <aside className="evidence-pane">
          <div className="evidence-heading">
            <FolderOpen size={19} />
            <h2>证据夹</h2>
            <span>原文在这里</span>
          </div>
          <Evidence issue={issue} copy={() => void copy()} />
        </aside>
      </div>
      <div className="review-footer">
        <div>
          <span className={`footer-icon ${view.canDeliver ? 'ready' : ''}`}>
            {view.canDeliver ? <Check size={18} /> : <Info size={18} />}
          </span>
          <span>
            {view.canDeliver
              ? view.acceptedCount
                ? '风险说明会随示例交付签保留。'
                : '6 条要求已有着落，可以准备示例交付。'
              : view.blockReason}
          </span>
        </div>
        <div className="actions">
          {(view.pendingCount > 0 || state.scenario === 'stale') && (
            <Button
              onClick={() => {
                dispatch({ type: 'recheck' })
                notify('已按固定样例完成模拟复核。')
              }}
            >
              复核示例修改
            </Button>
          )}
          <Button
            kind="primary"
            disabled={!view.canDeliver}
            onClick={() => go(`${projectPath}/delivery`)}
          >
            {view.acceptedCount ? '带说明准备交付' : '准备交付'}
            <ArrowRight size={17} />
          </Button>
        </div>
      </div>
      {modal === 'coverage' && (
        <Modal title="本次检查范围" onClose={() => setModal(null)}>
          <CoverageContent />
        </Modal>
      )}
      {modal === 'evidence' && (
        <Modal title="证据夹" onClose={() => setModal(null)}>
          <Evidence issue={issue} copy={() => void copy()} />
        </Modal>
      )}
      {modal === 'risk' && (
        <Modal title="这次，带着说明交付" onClose={() => setModal(null)}>
          <Notice tone="warning">
            示例情景：场地费预计 600 元，仍待最终确认。接受后会在交付说明中保留这项事实。
          </Notice>
          <label>
            接受理由
            <textarea
              aria-label="接受理由"
              autoFocus
              maxLength={1000}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：先交筹备版，场地确认后补最终版"
            />
          </label>
          <Button
            kind="primary"
            disabled={reason.trim().length < 2}
            onClick={() => {
              dispatch({ type: 'acceptRisk', reason })
              setModal(null)
            }}
          >
            确认接受风险
          </Button>
        </Modal>
      )}
      {filePreview && (
        <Modal title="材料原文 · 示例" onClose={() => setFilePreview(null)}>
          <pre className="source-text">{filePreview}</pre>
        </Modal>
      )}
    </>
  )
}
function PlusIcon() {
  return <span aria-hidden="true">＋</span>
}

export function Delivery({ state, view, dispatch, go, notify }: PageProps) {
  const [preview, setPreview] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(view.deliveryNote)
      notify('示例交付说明已复制。')
    } catch {
      notify('请直接选中交付说明复制。')
    }
  }
  return (
    <>
      <Stepper name={state.name} current={2} go={go} />
      <PageTitle
        eyebrow="PUT A GOOD ENDING ON IT"
        title="最后，把它们收成一份。"
        subtitle="选好材料，带上说明。让收到的人，也能一眼看明白。"
      />
      <Notice tone={view.canDeliver ? 'info' : 'warning'}>
        {view.canDeliver ? '本次只预览示例交付包，不创建、下载或保存真实文件。' : view.blockReason}
        <button className="inline-link" onClick={() => go(`${projectPath}/review`)}>
          返回核对清单
        </button>
      </Notice>
      <div className="two-column delivery-columns">
        <section className="panel">
          <div className="section-header">
            <h2>将要交付</h2>
            <Tag tone="green">
              {view.deliveryFiles.filter((file) => !state.excludes.includes(file.id)).length} 份材料
            </Tag>
          </div>
          <div data-testid="delivery-files">
            {view.deliveryFiles.map((file) => (
              <div className="delivery-file" key={file.id}>
                <input
                  type="checkbox"
                  aria-label={file.name}
                  checked={!state.excludes.includes(file.id)}
                  onChange={() => dispatch({ type: 'exclude', id: file.id })}
                />
                <FileRow file={file} />
              </div>
            ))}
          </div>
          <div className="section-divider" />
          <h3 className="muted">不包含的参考材料与旧版本</h3>
          <p className="small muted">
            活动要求.md、预算-v1.md，以及修改前的通知和预算。原始材料保持原样。
          </p>
          <div className="folder-path">
            <FolderOpen size={18} />
            周末读书会_交付示例/<span>预览目录</span>
          </div>
        </section>
        <section className="panel">
          <div className="section-header">
            <h2>给对方的一段说明</h2>
            <Copy size={18} />
          </div>
          <label className="visually-hidden" htmlFor="delivery-note">
            交付说明
          </label>
          <textarea
            id="delivery-note"
            className="delivery-note"
            maxLength={4000}
            value={state.note}
            onChange={(e) => dispatch({ type: 'note', value: e.target.value })}
          />
          <div className="actions">
            <Button kind="text" onClick={() => void copy()}>
              复制文字
            </Button>
            <Button
              kind="text"
              onClick={() =>
                dispatch({
                  type: 'note',
                  value: view.acceptedCount ? suggestedRiskNote : suggestedNote,
                })
              }
            >
              恢复建议文案
            </Button>
          </div>
          {view.riskNote && (
            <Notice tone="warning">
              <strong>这条说明会单独保留</strong>
              <p>{view.riskNote}</p>
            </Notice>
          )}
          <div className="delivery-recipient">
            <span>交给</span>
            <strong>{state.recipient || '活动负责人'}</strong>
          </div>
        </section>
      </div>
      <div className="page-actions">
        <span className="small muted">示例说明与风险清单一起预览，原文件不会被修改。</span>
        <Button kind="primary" disabled={!view.canDeliver} onClick={() => setPreview(true)}>
          预览交付包
          <ArrowRight size={17} />
        </Button>
      </div>
      {preview && (
        <Modal title="交付包预览 · 示例" onClose={() => setPreview(false)} wide>
          <Notice>预览不会生成真实材料包。</Notice>
          <div className="manifest">
            <h3>周末读书会_交付示例/</h3>
            {view.deliveryFiles.map((file) => (
              <p key={file.id}>
                <FileText size={16} />
                {file.name}
              </p>
            ))}
            <p>
              <FileText size={16} />
              附件清单.txt
            </p>
            {view.riskNote && (
              <p>
                <AlertTriangle size={16} />
                风险说明.txt
              </p>
            )}
          </div>
          <pre className="source-text">{view.deliveryNote}</pre>
          <Button
            kind="primary"
            disabled={!view.canDeliver}
            onClick={() => {
              dispatch({ type: 'complete' })
              go('/deliveries/reading-club')
            }}
          >
            完成示例演示
            <Check size={17} />
          </Button>
        </Modal>
      )}
    </>
  )
}
export function Complete({ state, go }: PageProps) {
  const [report, setReport] = useState(false)
  const record = state.record
  if (!record)
    return (
      <Empty title="这份示例还没收好。" detail="先完成核对并预览交付包，就会生成示例交付签。">
        <Button onClick={() => go(`${projectPath}/review`)}>回到清单</Button>
      </Empty>
    )
  return (
    <section className="completion">
      <Mark large />
      <div className="eyebrow">A GOOD PLACE TO STOP</div>
      <h1 tabIndex={-1}>这份，收好了。</h1>
      <p>最后一点小事，也有了妥当的去处。</p>
      <article className="delivery-ticket">
        <div className="ticket-top">
          <span>交付签 / 示例</span>
          <CheckCircle2 size={22} />
        </div>
        <h2>{record.name}</h2>
        <div className="ticket-grid">
          <span>
            交给<strong>{record.recipient || '活动负责人'}</strong>
          </span>
          <span>
            材料<strong>{record.files.length} 份</strong>
          </span>
          <span>
            状态<strong>{record.acceptedCount ? '带说明交付 · 示例' : '已收好 · 示例'}</strong>
          </span>
          <span>
            版本<strong>第 1 次示例</strong>
          </span>
        </div>
        {record.riskNote && <Notice tone="warning">{record.riskNote}</Notice>}
        <div className="ticket-foot">一次有依据的确认，一份清楚的交付。</div>
      </article>
      <Notice>这是示例交付签，未生成或保存真实文件。</Notice>
      <div className="actions centered">
        <Button kind="primary" onClick={() => setReport(true)}>
          查看示例检查报告
        </Button>
        <Button onClick={() => go('/')}>
          回到收尾台
          <ArrowRight size={16} />
        </Button>
      </div>
      {report && (
        <Modal title="检查报告 · 固定样例" onClose={() => setReport(false)}>
          <p>
            必须项已有证据：{record.satisfied}/6；接受风险：{record.acceptedCount} 项。
          </p>
          <CoverageContent />
          {record.riskNote && <Notice tone="warning">{record.riskNote}</Notice>}
        </Modal>
      )}
    </section>
  )
}
