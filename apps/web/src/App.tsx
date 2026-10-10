import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { FlaskConical, SlidersHorizontal, ShieldCheck, ArrowRight } from 'lucide-react'
import { DEMO_KEY, demoReducer, initialDemo, restoreDemo } from './demo-service'
import { projectView } from './view-model'
import { Button, Empty, Mark, Notice, type PageProps } from './components'
import { Home, Materials, Requirements, History } from './pages'
import { CheckPage, Review, Delivery, Complete } from './project-pages'
import { LocalHome, LocalNew, LocalProject } from './local-pages'
import { LocalCheck, LocalModelPage } from './local-check'
import { LocalDelivery, LocalComplete, LocalHistory } from './local-delivery'
import { LocalStorage } from './local-storage'
import { Models, Storage } from './settings-pages'

function readState() {
  try {
    return restoreDemo(sessionStorage.getItem(DEMO_KEY))
  } catch {
    return initialDemo()
  }
}
export default function App() {
  const [state, dispatch] = useReducer(demoReducer, undefined, readState)
  const [path, setPath] = useState(window.location.pathname.replace(/\/$/, '') || '/')
  const [toast, setToast] = useState('')
  const [storageFailed, setStorageFailed] = useState(false)
  const go = useCallback((target: string) => {
    window.history.pushState({}, '', target)
    setPath(target)
    window.scrollTo(0, 0)
  }, [])
  useEffect(() => {
    const change = () => setPath(window.location.pathname.replace(/\/$/, '') || '/')
    window.addEventListener('popstate', change)
    return () => window.removeEventListener('popstate', change)
  }, [])
  useEffect(() => {
    try {
      sessionStorage.setItem(DEMO_KEY, JSON.stringify(state))
    } catch {
      setStorageFailed(true)
    }
  }, [state])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4500)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
  }, [path])
  const view = useMemo(() => projectView(state), [state])
  const props: PageProps = { state, view, dispatch, go, notify: setToast }
  const isLocal = path === '/' || path.startsWith('/local')
  let page
  switch (path) {
    case '/local/storage':
      page = <LocalStorage go={go} />
      break
    case '/local/history':
      page = <LocalHistory go={go} />
      break
    case '/local/model':
      page = <LocalModelPage go={go} />
      break
    case '/local':
      page = <LocalHome go={go} />
      break
    case '/local/new':
      page = <LocalNew go={go} />
      break
    case '/':
      page = <Home {...props} />
      break
    case '/projects/new':
      page = <Materials {...props} />
      break
    case '/projects/reading-club/requirements':
      page = <Requirements {...props} />
      break
    case '/projects/reading-club/check':
      page = <CheckPage {...props} />
      break
    case '/projects/reading-club/review':
      page = <Review {...props} />
      break
    case '/projects/reading-club/delivery':
      page = <Delivery {...props} />
      break
    case '/deliveries/reading-club':
      page = <Complete {...props} />
      break
    case '/history':
      page = <History {...props} />
      break
    case '/settings/models':
      page = <Models {...props} />
      break
    case '/settings/storage':
      page = <Storage {...props} />
      break
    default:
      page = (
        <Empty
          title="这份收尾，暂时找不到。"
          detail="当前只有内置的读书会示例，可以从收尾台重新开始。"
        >
          <Button onClick={() => go('/')}>
            回到收尾台
            <ArrowRight size={17} />
          </Button>
        </Empty>
      )
  }
  if (/^\/local\/projects\/[0-9a-f-]{36}$/.test(path))
    page = <LocalProject key={path} id={path.split('/')[3]!} go={go} />
  if (/^\/local\/projects\/[0-9a-f-]{36}\/check$/.test(path))
    page = <LocalCheck key={path} id={path.split('/')[3]!} go={go} />
  if (/^\/local\/projects\/[0-9a-f-]{36}\/delivery$/.test(path))
    page = <LocalDelivery key={path} id={path.split('/')[3]!} go={go} />
  if (/^\/local\/projects\/[0-9a-f-]{36}\/deliveries\/[0-9a-f-]{36}$/.test(path))
    page = (
      <LocalComplete
        key={path}
        id={path.split('/')[3]!}
        deliveryId={path.split('/')[5]!}
        go={go}
      />
    )
  return (
    <>
      <a href="#main" className="skip-link">
        跳到主要内容
      </a>
      <header className="app-header">
        <div className="header-inner">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault()
              go('/')
            }}
          >
            <Mark />
            <span>
              收尾搭子<small>把最后一点，收好了。</small>
            </span>
          </a>
          <nav className="main-nav" aria-label="主导航">
            {[
              ['/', '收尾台'],
              ['/local', '本地项目'],
              [isLocal ? '/local/history' : '/history', '交付记录'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                aria-current={
                  (
                    href === '/'
                      ? !path.startsWith('/history') &&
                        !path.startsWith('/settings') &&
                        !path.startsWith('/local')
                      : href === '/local'
                        ? path.startsWith('/local') && !path.startsWith('/local/history')
                        : path === href
                  )
                    ? 'page'
                    : undefined
                }
                onClick={(e) => {
                  e.preventDefault()
                  go(href!)
                }}
              >
                {label}
              </a>
            ))}
          </nav>
          <button
            className="model-status"
            onClick={() => go(isLocal ? '/local/model' : '/settings/models')}
          >
            <span className="status-dot muted-dot" />
            {isLocal ? '自有模型设置' : '模型未连接'}
          </button>
          <button
            className="settings-button"
            aria-label="设置"
            onClick={() => go(isLocal ? '/local/storage' : '/settings/models')}
          >
            <SlidersHorizontal size={20} />
          </button>
        </div>
      </header>
      <div className="demo-banner">
        <div>
          <FlaskConical size={15} />
          <span>{isLocal ? '真实材料 · 本机保存' : '示例演示 · 未调用模型'}</span>
          <span className="demo-description">
            {isLocal ? '核对时仅向你选定的模型发送所选文字。' : '先轻松走一遍，不用连接模型。'}
          </span>
        </div>
        <span className="demo-version">LOCAL / 01</span>
      </div>
      <main
        id="main"
        className={`main-shell ${path === '/' ? 'home-shell' : ''}`}
        tabIndex={-1}
      >
        {storageFailed && (
          <Notice tone="warning">浏览器暂时无法保存示例进度；刷新后可能重置。</Notice>
        )}
        {page}
      </main>
      <footer className="app-footer">
        <span>
          <ShieldCheck size={15} />
          {isLocal ? '原文件保持不变 · 只读取你选择的副本' : '示例在本机运行 · 原文件未被读取'}
        </span>
        <span>少一点遗漏，多一点安心。</span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  )
}
