import { useState } from 'react'
import {
  ArrowRight,
  Plus,
  FolderOpen,
  Clock3,
  Check,
  FileText,
  ChevronRight,
  BookOpen,
  Paperclip,
  CornerDownRight,
} from 'lucide-react'
import { fixture } from './demo-service'
import {
  Button,
  Empty,
  FileRow,
  Modal,
  PageTitle,
  PaperArt,
  Stepper,
  Tag,
  Notice,
  projectPath,
  type PageProps,
} from './components'

export function Home({ state, view, dispatch, go }: PageProps) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="tiny-line" />
            让每一次交付，都有个好结尾
          </div>
          <h1 tabIndex={-1}>
            给事情一个
            <br />
            舒服的<span className="serif-accent">句号。</span>
          </h1>
          <p>
            放进要求和材料，看看还差什么。
            <br />
            把最后一点，收好了，再放心交出去。
          </p>
          <div className="actions">
            <Button
              kind="primary"
              onClick={() => {
                go('/local/new')
              }}
            >
              <Plus size={18} />
              开始收尾
            </Button>
            <Button
              kind="text"
              onClick={() => {
                dispatch({ type: 'scenario', value: 'normal' })
                go(`${projectPath}/review`)
              }}
            >
              先试一个例子
              <ArrowRight size={17} />
            </Button>
          </div>
          <span className="hero-note">
            <span className="status-dot" />
            不用账号，也不用模型密钥，就能体验示例
          </span>
        </div>
        <PaperArt />
      </section>
      <section className="recent-section">
        <div className="section-header">
          <h2>
            最近的收尾 <span className="count">01</span>
          </h2>
          <span className="muted small">一点点收好，不必从头再来。</span>
        </div>
        <button
          className="project-row"
          onClick={() => {
            dispatch({ type: 'load' })
            go(`${projectPath}/review`)
          }}
        >
          <span className="project-symbol">
            <BookOpen size={26} />
          </span>
          <span className="project-info">
            <strong>{state.name || '周末读书会材料'}</strong>
            <span>内置示例 · 活动材料 · {view.files.length} 份材料</span>
          </span>
          <Tag tone={view.canDeliver ? 'green' : 'amber'}>
            {view.canDeliver ? '已收好 · 示例' : `还有 ${view.openCount + view.pendingCount} 件小事`}
          </Tag>
          <span className="recent-date">
            <Clock3 size={14} />
            示例项目
          </span>
          <span className="row-continue">
            继续收尾 <ArrowRight size={17} />
          </span>
        </button>
      </section>
      <section className="home-guide">
        <div>
          <span className="guide-index">01</span>
          <h3>把材料放进来</h3>
          <p>要求和准备好的文件，各就各位。</p>
        </div>
        <div>
          <span className="guide-index">02</span>
          <h3>一起对一遍清单</h3>
          <p>缺了什么、哪里没对上，都有原文。</p>
        </div>
        <div>
          <span className="guide-index">03</span>
          <h3>收成一份好交付</h3>
          <p>选好版本，带上说明，清清楚楚。</p>
        </div>
      </section>
    </>
  )
}
export function Materials({ state, dispatch, go }: PageProps) {
  const [preview, setPreview] = useState<string | null>(null)
  return (
    <>
      <Stepper name={state.name} current={0} go={go} />
      <PageTitle
        eyebrow="START WITH WHAT YOU HAVE"
        title="先把这次的材料，放在一起。"
        subtitle="不用整理得很完美，先从手头有的开始。"
      />
      <div className="two-column">
        <section className="panel">
          <div className="section-header">
            <h2>这次，要收好什么？</h2>
            <Tag>示例项目</Tag>
          </div>
          <div className="form-grid">
            <label>
              项目名称
              <input
                maxLength={150}
                value={state.name}
                onChange={(e) => dispatch({ type: 'details', field: 'name', value: e.target.value })}
              />
            </label>
            <label>
              交给谁
              <input
                maxLength={150}
                value={state.recipient}
                onChange={(e) => dispatch({ type: 'details', field: 'recipient', value: e.target.value })}
              />
            </label>
          </div>
          <label>
            这次的目标
            <textarea
              rows={2}
              maxLength={1000}
              value={state.goal}
              onChange={(e) => dispatch({ type: 'details', field: 'goal', value: e.target.value })}
            />
          </label>
          <div className="section-divider" />
          <h3>
            <span className="number-label">01</span>对方的要求
          </h3>
          <div className="requirement-snippet">
            <FileText size={18} />
            <div>
              <strong>周末读书会材料要求</strong>
              <p>日期、地点、最终预算、活动方案、通知和报名说明。</p>
              <button className="text-link" onClick={() => setPreview(fixture.files[0]!.text)}>
                看看完整要求 <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <h3>
            <span className="number-label">02</span>准备交的材料
          </h3>
          <div className="dropzone">
            <FolderOpen size={32} />
            <h3>{state.loaded ? '5 份示例材料，已放好。' : '先放进一组示例材料'}</h3>
            <p>包含方案、通知和两份预算，试试把它们收好。</p>
            <Button onClick={() => dispatch({ type: 'load' })}>
              <Plus size={16} />
              {state.loaded ? '重新放入示例材料' : '放入示例材料'}
            </Button>
            <small>本阶段不读取本机文件，真实导入将在后续接入。</small>
          </div>
        </section>
        <aside className="stack">
          <section className="panel">
            <div className="section-header">
              <h2>材料托盘</h2>
              <Tag>{state.loaded ? 5 : 0} 份</Tag>
            </div>
            {state.loaded ? (
              fixture.files.map((file) => (
                <FileRow key={file.id} file={file} onClick={() => setPreview(file.text)} />
              ))
            ) : (
              <Empty title="这里还空着" detail="放入示例材料后，可以先看看原文。" />
            )}
          </section>
          <div className="soft-note">
            <Paperclip size={20} />
            <div>
              <h3>要求和材料，分开放就好。</h3>
              <p>要求告诉我们要交什么，材料告诉我们已经准备了什么。</p>
            </div>
          </div>
        </aside>
      </div>
      <div className="page-actions">
        <span className="muted small">仅演示内置文本，不上传你的文件。</span>
        <Button
          kind="primary"
          disabled={!state.loaded || !state.name.trim() || !state.goal.trim()}
          onClick={() => go(`${projectPath}/requirements`)}
        >
          整理要求清单 <ArrowRight size={17} />
        </Button>
      </div>
      {preview && (
        <Modal title="示例原文" onClose={() => setPreview(null)}>
          <pre className="source-text">{preview}</pre>
        </Modal>
      )}
    </>
  )
}
export function Requirements({ state, view, dispatch, go }: PageProps) {
  const [confirmed, setConfirmed] = useState(state.confirmed)
  return (
    <>
      <Stepper name={state.name} current={1} go={go} />
      <PageTitle
        eyebrow="A LITTLE AGREEMENT"
        title="先对齐，要交的到底是什么。"
        subtitle="请确认，这是不是你这次要交的。这里是固定样例的六条要求。"
      />
      <div className="two-column">
        <section className="panel requirements-list">
          <div className="section-header">
            <h2>本次交付清单</h2>
            <Tag>6 条必须项</Tag>
          </div>
          {view.requirements.map((item) => (
            <div className="requirement-row" key={item.id}>
              <span className="requirement-id">{item.id}</span>
              <div>
                <p>{item.text}</p>
                <span className="small muted">来源：活动要求.md</span>
              </div>
              <Tag>必须</Tag>
            </div>
          ))}
          <label className="checkbox-label consent">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>我已确认这 6 条示例要求</span>
          </label>
        </section>
        <aside className="panel source-panel">
          <div className="eyebrow">要求的来处</div>
          <h2>活动要求.md</h2>
          <p className="small muted">要求来源 · 示例快照 v1</p>
          <pre className="source-text">
            {fixture.requirements.map((item) => `${item.id} ${item.text}`).join('\n\n')}
          </pre>
          <Notice>示例清单不由模型生成。真实项目会允许编辑、拆分与确认要求。</Notice>
        </aside>
      </div>
      <div className="page-actions">
        <Button kind="text" onClick={() => go('/projects/new')}>
          返回材料
        </Button>
        <Button
          kind="primary"
          disabled={!confirmed}
          onClick={() => {
            dispatch({ type: 'confirm' })
            dispatch({ type: 'start' })
            go(`${projectPath}/check`)
          }}
        >
          按这 6 条要求检查 <ArrowRight size={17} />
        </Button>
      </div>
    </>
  )
}
export function History({ state, go }: PageProps) {
  const [search, setSearch] = useState('')
  return (
    <>
      <PageTitle
        eyebrow="EVERY ENDING, KEPT"
        title="每一次收好，都留在这里。"
        subtitle="这里只记录本标签页的示例体验，不是实际导出记录。"
      />
      <div className="panel">
        <label className="search-label">
          搜索示例记录
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="按项目名称查找" />
        </label>
        {state.record && state.record.name.includes(search) ? (
          <button className="project-row" onClick={() => go('/deliveries/reading-club')}>
            <span className="project-symbol">
              <Check />
            </span>
            <span className="project-info">
              <strong>{state.record.name}</strong>
              <span>示例交付签 · {state.record.files.length} 份材料 · 未生成文件</span>
            </span>
            <Tag tone="green">{state.record.acceptedCount ? '带说明 · 示例' : '已收好 · 示例'}</Tag>
            <ArrowRight size={18} />
          </button>
        ) : (
          <Empty
            title={search ? '没有找到这份记录' : '好好收尾的事情，会留在这里。'}
            detail={search ? '试试其他项目名，或者清空搜索。' : '完成一次示例交付，就能看看记录长什么样。'}
          >
            <Button onClick={() => go(`${projectPath}/review`)}>
              去收好第一份 <CornerDownRight size={16} />
            </Button>
          </Empty>
        )}
      </div>
    </>
  )
}
