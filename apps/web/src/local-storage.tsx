import { useEffect, useState } from 'react'
import { ArrowLeft, HardDrive, RefreshCw, FileDown, Trash2 } from 'lucide-react'
import type { Project, SystemInfo, Diagnostics } from '@shouwei/contracts'
import { Button, PageTitle, Notice, Modal, Empty, Tag } from './components'
import { request } from './local-api'
export function LocalStorage({go}:{go:(path:string)=>void}) {
  const [info,setInfo]=useState<SystemInfo|null>(null),[projects,setProjects]=useState<Project[]>([]),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [remove,setRemove]=useState<Project|null>(null),[confirmed,setConfirmed]=useState(false),[diagnostic,setDiagnostic]=useState<Diagnostics|null>(null)
  const [cleanupWarning,setCleanupWarning]=useState(false)
  const load=async()=>{
    const [system,items,state]=await Promise.all([request<SystemInfo>('/system'),request<Project[]>('/projects'),request<Diagnostics>('/diagnostics')])
    setInfo(system);setProjects(items);setCleanupWarning(state.storage.cleanupPending||state.model.cleanupPending)
  }
  useEffect(()=>{void load().catch(e=>setError(e.message))},[])
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const download=()=>{
    if(!diagnostic)return
    const url=URL.createObjectURL(new Blob([JSON.stringify(diagnostic,null,2)],{type:'application/json'}))
    const link=document.createElement('a');link.href=url;link.download='收尾搭子-诊断.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <>
    <button className="back-link" onClick={()=>go('/local/model')}><ArrowLeft size={17}/>模型连接</button>
    <PageTitle eyebrow="A PLACE FOR EVERYTHING" title="本机的东西，心里有数。" subtitle="看看保存在哪里，也给不用的项目腾出一点空间。"/>
    {error&&<div role="alert"><Notice tone="warning">{error}</Notice></div>}
    {message&&<p role="status">{message}</p>}
    {cleanupWarning&&<Notice tone="warning">有副本清理尚未完成，其他项目仍可使用。重启会重试有效记录；损坏或未知记录会保留，请按本地数据说明处理，勿删除唯一原件。</Notice>}
    <div className="local-material-grid">
      <section className="panel">
        <h2><HardDrive size={20}/> 本地保存</h2>
        <p className="storage-path">{info?.dataDir??'正在读取位置…'}</p>
        <p className="muted">项目副本和交付保存在这里。备份前先退出应用或停止服务，再复制整个目录；模型密钥不在普通配置里。</p>
        {info&&<p className="small">版本 {info.version} · {info.platform}/{info.arch} · {info.distribution==='macos-test'?'未签名 macOS 测试包':'源码运行'}<br/>本轮已验证 macOS arm64；Windows 和其他平台尚未验收。</p>}
        <div className="check-actions">
          <Button disabled={busy||!info} onClick={()=>void act(async()=>{await navigator.clipboard.writeText(info!.dataDir);setMessage('位置已复制')})}>复制数据位置</Button>
          <Button disabled={busy} onClick={()=>void act(async()=>{setDiagnostic(await request<Diagnostics>('/diagnostics'))})}><FileDown size={16}/>预览诊断</Button>
        </div>
        <p className="small muted">诊断只包含版本、平台、数量和连接状态，不含项目名、正文、文件路径、模型地址或密钥。预览后再下载，不自动发送。</p>
      </section>
      <section className="panel">
        <div className="section-header"><h2>本地项目</h2><Button disabled={busy} onClick={()=>void act(load)}><RefreshCw size={16}/>刷新</Button></div>
        {!projects.length&&<Empty title="这里暂时很轻。" detail="新建一个项目后，可以在这里管理。"/>}
        {projects.map(project=><article className="storage-project" key={project.id}>
          <div><h3>{project.name}</h3><p className="small muted">{project.activeRunId?'处理中，请先停止或等待读取结束':'本机项目 · 原文件保持不变'}</p></div>
          <div className="check-actions"><Button onClick={()=>go(`/local/projects/${project.id}`)}>打开项目</Button><Button disabled={busy||!!project.activeRunId} onClick={()=>{setConfirmed(false);setRemove(project)}}><Trash2 size={16}/>删除本地项目</Button></div>
        </article>)}
      </section>
    </div>
    {remove&&<Modal title="删除这个本地项目？" onClose={()=>{if(!busy)setRemove(null)}}>
      <p>「{remove.name}」的导入副本、解析文字、检查缓存和未完成预览将删除。原文件、已完成的交付包、内部报告和冻结交付记录会保留。</p>
      <p className="small muted">保留的交付报告与冻结记录仍含当时的检查信息。这个操作不会移除模型凭据。</p>
      <label className="check-choice"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>我理解原文件、交付包和冻结报告会保留</label>
      <div className="check-actions"><Button disabled={busy} onClick={()=>setRemove(null)}>取消</Button><Button kind="primary" disabled={busy||!confirmed} onClick={()=>void act(async()=>{
        const result=await request<{deleted:boolean;cleanupPending:boolean}>(`/projects/${remove.id}`,'DELETE',{expectedRevision:remove.revision,confirm:true})
        setRemove(null);setMessage(result.cleanupPending?'项目已删除，部分副本待清理；有效记录将在下次启动重试，未知或损坏记录需本机检查。':'项目已删除，原文件和已完成交付仍保留。');await load()
      })}>确认删除</Button></div>
    </Modal>}
    {diagnostic&&<Modal title="诊断预览" wide onClose={()=>setDiagnostic(null)}>
      <Tag>只在本机</Tag><p>确认下面的内容后下载。需要反馈问题时，是否分享由你决定。</p>
      <pre className="diagnostic-preview">{JSON.stringify(diagnostic,null,2)}</pre>
      <Button kind="primary" onClick={download}>下载这份诊断</Button>
    </Modal>}
  </>
}
