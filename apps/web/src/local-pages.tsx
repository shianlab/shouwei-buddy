import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import type {
  Project,
  ProjectInput,
  ProjectDetail,
  FileSnapshot,
  FileRole,
  TextEncoding,
  Locator,
} from '@shouwei/contracts'
import { Button, Empty, Modal, Notice, PageTitle, Tag } from './components'
import { localAPI, fileBase64 } from './local-api'
type Props = { go: (path: string) => void }
const errorText = (e: unknown) => (e instanceof Error ? e.message : '操作未完成，请重试。')
const roleNames: Record<FileRole, string> = {
  requirement: '对方的要求',
  deliverable: '准备交的材料',
  reference: '参考资料',
}
const statusNames = {
  queued: '等待读取',
  parsing: '正在读取',
  complete: '文字已读取',
  partial: '部分内容未覆盖',
  failed: '读取失败',
  unsupported: '类型不支持',
}
export function locatorLabel(l: Locator) {
  return l.kind === 'lines'
    ? `第 ${l.startLine}${l.endLine === l.startLine ? '' : `—${l.endLine}`} 行${l.part > 1 ? ` · 片段 ${l.part}` : ''}`
    : l.kind === 'paragraph'
      ? `正文第 ${l.paragraph} 段 · 片段 ${l.part}`
      : l.kind === 'cell'
        ? `表格 ${l.table} · 第 ${l.row} 行 ${l.column} 列 · 片段 ${l.part}`
        : `第 ${l.page} 页 · 文字片段 ${l.part}`
}
function ProjectFields({
  value,
  onChange,
  disabled = false,
}: {
  value: ProjectInput
  onChange: (v: ProjectInput) => void
  disabled?: boolean
}) {
  return (
    <fieldset disabled={disabled} className="local-fields">
      <div className="form-grid">
        <label>
          项目名称
          <input
            required
            maxLength={150}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          交给谁
          <input
            maxLength={150}
            value={value.recipient}
            onChange={(e) => onChange({ ...value, recipient: e.target.value })}
          />
        </label>
      </div>
      <label>
        这次的目标
        <textarea
          required
          rows={3}
          maxLength={1000}
          value={value.goal}
          onChange={(e) => onChange({ ...value, goal: e.target.value })}
        />
      </label>
    </fieldset>
  )
}
export function LocalHome({ go }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null),
    [error, setError] = useState(''),
    [tick, setTick] = useState(0)
  useEffect(() => {
    let active = true
    localAPI
      .list()
      .then((p) => {
        if (active) {
          setProjects(p)
          setError('')
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e))
      })
    return () => {
      active = false
    }
  }, [tick])
  return (
    <>
      <PageTitle
        eyebrow="YOUR LOCAL SHELF"
        title="自己的材料，安心放这里。"
        subtitle="项目与文件副本保存在这台电脑，关掉页面后也能继续。"
      >
        <Button kind="primary" onClick={() => go('/local/new')}>
          <Plus size={18} />
          新建本地项目
        </Button>
      </PageTitle>
      {error ? (
        <Notice tone="warning">
          {error}
          <Button onClick={() => setTick((t) => t + 1)}>重新连接</Button>
        </Notice>
      ) : projects === null ? (
        <p role="status">正在打开本机材料架……</p>
      ) : projects.length === 0 ? (
        <section className="panel">
          <Empty
            title="还没有自己的项目"
            detail="先建一格材料架，再把要求和准备好的文件放进来。"
          >
            <Button onClick={() => go('/local/new')}>
              放进第一份材料 <ArrowRight size={16} />
            </Button>
          </Empty>
        </section>
      ) : (
        <div className="local-project-list">
          {projects.map((p) => (
            <button
              key={p.id}
              className="project-row"
              onClick={() => go(`/local/projects/${p.id}`)}
            >
              <span className="project-icon">
                <FolderOpen />
              </span>
              <span className="local-project-copy">
                <strong>{p.name}</strong>
                <span>{p.goal}</span>
                <small>
                  {p.recipient || '未填写收件人'} ·{' '}
                  {new Date(p.updatedAt).toLocaleDateString('zh-CN')}
                </small>
              </span>
              <Tag>本地项目</Tag>
              <ArrowRight size={18} />
            </button>
          ))}
        </div>
      )}
      <div className="soft-note local-boundary">
        <ShieldCheck />
        <div>
          <h3>先收好材料，再一起核对。</h3>
          <p>目前可以保存和读取真实文件；语义核对将在下一阶段接入，不会用示例结论替代。</p>
        </div>
      </div>
    </>
  )
}
export function LocalNew({ go }: Props) {
  const [form, setForm] = useState<ProjectInput>({ name: '', recipient: '', goal: '' }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <>
      <Button kind="text" onClick={() => go('/local')}>
        <ArrowLeft size={17} />
        本地项目
      </Button>
      <PageTitle
        eyebrow="MAKE A LITTLE ROOM"
        title="给这次交付，留一个位置。"
        subtitle="只需要一个名字和目标，就可以开始。"
      />
      <form
        className="panel local-new"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            const p = await localAPI.create(form)
            go(`/local/projects/${p.id}`)
          } catch (e) {
            setError(errorText(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <ProjectFields value={form} onChange={setForm} disabled={busy} />
        {error && (
          <p role="alert" className="local-error">
            {error}
          </p>
        )}
        <div className="page-actions">
          <span className="muted small">保存在本机，不会上传到云端。</span>
          <Button
            kind="primary"
            type="submit"
            disabled={busy || !form.name.trim() || !form.goal.trim()}
          >
            {busy ? '正在创建…' : '创建项目'}
            <ArrowRight size={17} />
          </Button>
        </div>
      </form>
    </>
  )
}
export function LocalProject({ id, go }: Props & { id: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [tick, setTick] = useState(0)
  const [role, setRole] = useState<FileRole>('deliverable'),
    [encoding, setEncoding] = useState<TextEncoding>('utf-8'),
    [version, setVersion] = useState('')
  const [messages, setMessages] = useState<string[]>([]),
    [preview, setPreview] = useState<FileSnapshot | null>(null),
    [blockId, setBlockId] = useState(''),
    [editing, setEditing] = useState(false),
    [form, setForm] = useState<ProjectInput>({ name: '', recipient: '', goal: '' })
  const chooser = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let active = true
    setDetail(null)
    localAPI
      .detail(id)
      .then((d) => {
        if (active) {
          setDetail(d)
          setError('')
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e))
      })
    return () => {
      active = false
    }
  }, [id, tick])
  async function upload(files: File[]) {
    if (!detail || busy || !files.length) return
    setBusy('upload')
    setError('')
    setMessages([])
    let current = detail
    for (const file of files) {
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('单文件不能超过 20 MiB。')
        const selected = await localAPI.select(id, file.name, await fileBase64(file))
        const imported = await localAPI.import(id, selected.token, {
          expectedRevision: current.project.revision,
          role,
          encoding,
          ...(version ? { logicalFileId: version } : {}),
        })
        current = await localAPI.detail(id)
        setDetail(current)
        setMessages((m) => [
          ...m,
          `${file.name}：${imported.duplicate ? '已存在相同快照，未重复保存。' : '已保存独立副本。'}`,
        ])
      } catch (e) {
        setMessages((m) => [...m, `${file.name}：${errorText(e)}`])
        try {
          current = await localAPI.detail(id)
          setDetail(current)
        } catch {
          /* Keep the original import error visible. */
        }
      }
    }
    if (chooser.current) chooser.current.value = ''
    setBusy('')
  }
  async function parse(file: FileSnapshot) {
    if (!detail || busy) return
    setBusy(file.id)
    setError('')
    try {
      setDetail(await localAPI.parse(id, file.id, detail.project.revision))
    } catch (e) {
      setError(errorText(e))
      try {
        setDetail(await localAPI.detail(id))
      } catch {
        /* original error retained */
      }
    } finally {
      setBusy('')
    }
  }
  if (!detail)
    return (
      <>
        <PageTitle title="打开这格材料架。" />
        {error ? (
          <Notice tone="warning">
            {error}
            <Button onClick={() => setTick((t) => t + 1)}>重新打开</Button>
            <Button onClick={() => go('/local')}>本地项目</Button>
          </Notice>
        ) : (
          <p role="status">正在读取本机项目……</p>
        )}
      </>
    )
  const { project, files, blocks, gaps } = detail
  const previewBlocks = blocks.filter((b) => b.fileSnapshotId === preview?.id),
    selected = previewBlocks.find((b) => b.id === blockId) ?? previewBlocks[0]
  const uniqueFiles = [...new Map(files.map((f) => [f.logicalFileId, f])).values()]
  return (
    <>
      <Button kind="text" onClick={() => go('/local')}>
        <ArrowLeft size={17} />
        本地项目
      </Button>
      <PageTitle
        eyebrow="A PLACE FOR YOUR MATERIALS"
        title={project.name}
        subtitle={project.goal}
      >
        <Button
          disabled={!!busy}
          onClick={() => {
            setForm({ name: project.name, recipient: project.recipient, goal: project.goal })
            setEditing(true)
          }}
        >
          编辑项目信息
        </Button>
      </PageTitle>
      <div className="local-summary">
        <span>{project.recipient ? `交给 ${project.recipient}` : '收件人待填写'}</span>
        <span>{files.length} / 30 份快照</span>
        <span>
          {(files.reduce((n, f) => n + f.bytes, 0) / 1024 / 1024).toFixed(2)} / 100 MiB
        </span>
        <Tag>版本 {project.revision}</Tag>
      </div>
      {error && (
        <div role="alert">
          <Notice tone="warning">
            {error}
            <Button disabled={!!busy} onClick={() => setTick((t) => t + 1)}>
              刷新项目
            </Button>
          </Notice>
        </div>
      )}
      <div className="local-material-grid">
        <section className="panel">
          <div className="section-header">
            <h2>把要求和材料，放进来。</h2>
            <FolderOpen size={23} />
          </div>
          <div className="local-import-options">
            <label>
              材料用途
              <select
                value={role}
                disabled={!!busy}
                onChange={(e) => setRole(e.target.value as FileRole)}
              >
                {Object.entries(roleNames).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              文字编码
              <select
                value={encoding}
                disabled={!!busy}
                onChange={(e) => setEncoding(e.target.value as TextEncoding)}
              >
                <option value="utf-8">UTF-8（默认）</option>
                <option value="utf-16le">UTF-16 LE</option>
                <option value="gb18030">GB18030 / GBK</option>
              </select>
            </label>
            <label>
              版本归属
              <select
                disabled={!!busy}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              >
                <option value="">作为新材料保存</option>
                {uniqueFiles.map((f) => (
                  <option key={f.logicalFileId} value={f.logicalFileId}>
                    更新：{f.originalName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className={`dropzone local-drop ${busy ? 'is-busy' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void upload([...e.dataTransfer.files])
            }}
          >
            <FolderOpen size={32} />
            <h3>{busy === 'upload' ? '正在保存独立副本…' : '从电脑选择，或拖到这里。'}</h3>
            <p>TXT、MD、DOCX、PDF · 单文件最多 20 MiB</p>
            <Button kind="primary" disabled={!!busy} onClick={() => chooser.current?.click()}>
              <Plus size={16} />
              选择文件
            </Button>
            <input
              ref={chooser}
              aria-label="选择文件"
              type="file"
              className="file-picker"
              multiple
              accept=".txt,.md,.docx,.pdf"
              disabled={!!busy}
              onChange={(e) => void upload([...(e.target.files ?? [])])}
            />
            <small>原文件保持不变。文件名相同，也不会覆盖旧副本。</small>
          </div>
          {messages.length > 0 && (
            <ul className="local-import-results" aria-live="polite">
              {messages.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </section>
        <aside className="panel local-reading-note">
          <span className="eyebrow">READ FIRST</span>
          <h2>读取文字，保留出处。</h2>
          <p>每个片段会标出行号、正文段落、表格位置或 PDF 页码。</p>
          <p>
            扫描页、图片、批注等未覆盖内容会明确列出。文字读取完成，不等于内容已经核对正确。
          </p>
          <Notice>读取后先确认要求，再使用自己的模型核对。交付打包将在下一阶段提供。</Notice>
          <Button
            kind="primary"
            disabled={!!busy}
            onClick={() => go(`/local/projects/${id}/check`)}
          >
            确认要求与核对 <ArrowRight size={16} />
          </Button>
        </aside>
      </div>
      <section className="local-files">
        <div className="section-header">
          <h2>已收好的材料</h2>
          <Button disabled={!!busy} kind="text" onClick={() => setTick((t) => t + 1)}>
            <RefreshCw size={16} />
            刷新列表
          </Button>
        </div>
        {files.length === 0 ? (
          <div className="panel">
            <Empty title="这里还空着" detail="先选一份要求，或准备交付的文件。" />
          </div>
        ) : (
          files.map((file) => (
            <article className="panel local-file" key={file.id}>
              <div className="local-file-heading">
                <FileText size={23} />
                <div>
                  <h3>{file.originalName}</h3>
                  <p>
                    {roleNames[file.role]} · v{file.version} · {(file.bytes / 1024).toFixed(1)}{' '}
                    KB
                  </p>
                </div>
                <Tag tone={file.parseStatus === 'complete' ? 'green' : 'amber'}>
                  {busy === file.id ? '正在读取…' : statusNames[file.parseStatus]}
                </Tag>
              </div>
              <div className="local-file-actions">
                <span className="small muted">SHA-256 · {file.sha256.slice(0, 16)}…</span>
                <Button
                  disabled={!!busy}
                  aria-label={`读取材料：${file.originalName}`}
                  onClick={() => void parse(file)}
                >
                  {busy === file.id
                    ? '正在读取…'
                    : file.parseStatus === 'queued'
                      ? '读取文字'
                      : '重新读取'}
                </Button>
                <Button
                  disabled={!!busy || !blocks.some((b) => b.fileSnapshotId === file.id)}
                  aria-label={`查看原文：${file.originalName}`}
                  onClick={() => {
                    setPreview(file)
                    setBlockId('')
                  }}
                >
                  查看原文 <ArrowRight size={15} />
                </Button>
              </div>
              {gaps.some((g) => g.fileSnapshotId === file.id) && (
                <ul className="local-gaps">
                  {gaps
                    .filter((g) => g.fileSnapshotId === file.id)
                    .map((g) => (
                      <li key={g.id}>
                        {g.page ? `第 ${g.page} 页：` : ''}
                        {g.reason}
                      </li>
                    ))}
                </ul>
              )}
            </article>
          ))
        )}
      </section>
      {preview && (
        <Modal title={preview.originalName} onClose={() => setPreview(null)}>
          <p className="small muted">
            快照 v{preview.version} · 以下为原文文字层；未调用模型。
          </p>
          <label>
            定位到
            <select value={selected?.id ?? ''} onChange={(e) => setBlockId(e.target.value)}>
              {previewBlocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {locatorLabel(b.locator)}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <h3>{locatorLabel(selected.locator)}</h3>
              <pre className="source-text local-source">{selected.text}</pre>
              <p className="small muted">片段摘要：{selected.textHash.slice(0, 16)}</p>
            </>
          )}
          {gaps
            .filter((g) => g.fileSnapshotId === preview.id)
            .map((g) => (
              <Notice key={g.id} tone="warning">
                {g.reason}
              </Notice>
            ))}
        </Modal>
      )}
      {editing && (
        <Modal title="编辑项目信息" onClose={() => setEditing(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy('edit')
              setError('')
              try {
                await localAPI.update(id, project.revision, form)
                setDetail(await localAPI.detail(id))
                setEditing(false)
              } catch (e) {
                setError(errorText(e))
                setEditing(false)
              } finally {
                setBusy('')
              }
            }}
          >
            <ProjectFields value={form} onChange={setForm} disabled={!!busy} />
            <Button
              kind="primary"
              type="submit"
              disabled={!!busy || !form.name.trim() || !form.goal.trim()}
            >
              保存项目信息
            </Button>
          </form>
        </Modal>
      )}
    </>
  )
}
