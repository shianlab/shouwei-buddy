import { useEffect, useId, useRef, type Dispatch, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, FileText, X, Info, ShieldCheck } from 'lucide-react'
import type { DemoAction, DemoState } from './demo-service'
import type { ProjectViewModel, DemoFile } from './view-model'
export interface PageProps {
  state: DemoState
  view: ProjectViewModel
  dispatch: Dispatch<DemoAction>
  go: (path: string) => void
  notify: (message: string) => void
}
export const projectPath = '/projects/reading-club'
export function Mark({ large = false }: { large?: boolean }) {
  return (
    <svg className={large ? 'brand-mark large' : 'brand-mark'} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M29 9c7 6 7 18-1 23-5 3-9 3-14 0L6 35l3-9C3 12 16 1 29 9Z" fill="currentColor" />
      <path
        d="m14 20 4 4 9-10"
        stroke="#fff"
        strokeWidth="2.3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
export function Button({
  children,
  kind = 'secondary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'secondary' | 'text'
  children: ReactNode
}) {
  return (
    <button {...props} className={`button ${kind} ${props.className ?? ''}`}>
      {children}
    </button>
  )
}
export function Tag({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`tag ${tone}`}>{children}</span>
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: string }) {
  return (
    <div className={`notice ${tone}`}>
      <Info size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}
export function Stepper({ current, go, name }: { current: number; go: PageProps['go']; name: string }) {
  return (
    <div className="project-bar">
      <button className="back-link" onClick={() => go('/')}>
        <ArrowLeft size={17} />
        <span>{name}</span>
      </button>
      <ol className="stepper" aria-label="收尾步骤">
        {['放材料', '对清单', '收好交付'].map((label, i) => (
          <li key={label} aria-current={i === current ? 'step' : undefined}>
            <button
              onClick={() =>
                go(i === 0 ? '/projects/new' : `${projectPath}/${i === 1 ? 'review' : 'delivery'}`)
              }
              disabled={i > current}
            >
              <span className={`step-number ${i < current ? 'done' : ''}`}>
                {i < current ? <Check size={13} /> : i + 1}
              </span>
              {label}
            </button>
            {i < 2 && <span className="step-line" />}
          </li>
        ))}
      </ol>
    </div>
  )
}
export function PageTitle({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 tabIndex={-1}>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="title-actions">{children}</div>}
    </div>
  )
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current!
    dialog.showModal()
    const cancel = (event: Event) => {
      event.preventDefault()
      closeRef.current()
    }
    dialog.addEventListener('cancel', cancel)
    return () => {
      dialog.removeEventListener('cancel', cancel)
      dialog.close()
      previous?.focus()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  )
}
export function FileIcon({ type }: { type: string }) {
  return (
    <span className={`file-icon ${type.toLowerCase()}`} aria-hidden="true">
      <FileText size={23} />
      <small>{type}</small>
    </span>
  )
}
export function FileRow({
  file,
  children,
  onClick,
}: {
  file: DemoFile
  children?: ReactNode
  onClick?: () => void
}) {
  return (
    <div className="file-row">
      <FileIcon type={file.type} />
      <div className="file-row-text">
        {onClick ? (
          <button className="file-name" onClick={onClick} title={file.name}>
            {file.name}
          </button>
        ) : (
          <strong title={file.name}>{file.name}</strong>
        )}
        <span>
          {file.role} · {file.size} · 示例文本
        </span>
      </div>
      {children}
    </div>
  )
}
export function PaperArt() {
  return (
    <div className="paper-art" aria-hidden="true">
      <div className="art-orbit" />
      <span className="art-label">把最后一点，安放妥当。</span>
      <div className="art-paper back-paper">
        <div className="art-small">READING CLUB</div>
        <div className="art-date">
          10 <span>/</span> 24
        </div>
        <div className="art-rule" />
        <div className="art-rule short" />
      </div>
      <div className="art-paper front-paper">
        <div className="paper-tab">待收好的小事</div>
        <h3>周末读书会</h3>
        <p>最后一步，也值得认真。</p>
        <div className="art-check">
          <Check size={15} /> 活动方案
        </div>
        <div className="art-check">
          <Check size={15} /> 通知与报名说明
        </div>
        <div className="art-check">
          <span className="art-box" /> 确认预算版本
        </div>
        <span className="art-stamp">
          CHECKED
          <br />
          WITH CARE
        </span>
      </div>
      <div className="art-folder">
        <span>收尾搭子 / MY LITTLE FINISH</span>
        <Mark />
      </div>
      <span className="art-spark">✳</span>
    </div>
  )
}
export function CoverageContent() {
  return (
    <>
      <Notice>示例基于内置的固定文本，没有读取你的文件，也没有调用模型。</Notice>
      <h3>这次看过什么</h3>
      <ul className="plain-list">
        <li>6 条要求与材料的对应关系</li>
        <li>日期、地点、预算中的文字与占位内容</li>
        <li>附件是否齐全、预算版本是否明确</li>
      </ul>
      <h3>这次没有检查什么</h3>
      <p>图片、视觉排版、扫描页、活动真实性与金额是否合理。没有发现问题，不代表材料绝对无误。</p>
    </>
  )
}
export function Empty({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <ShieldCheck size={30} />
      </div>
      <h2>{title}</h2>
      <p>{detail}</p>
      <div className="actions centered">{children}</div>
    </div>
  )
}
export function Forward() {
  return <ArrowRight size={17} aria-hidden="true" />
}
