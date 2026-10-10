import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { unzipSync, strFromU8 } from 'fflate'
import { checkReply } from '../tests/support/check-provider.ts'
const app=resolve(process.argv[2]??'release/收尾搭子.app'),resources=join(app,'Contents/Resources')
const root=await mkdtemp(join(tmpdir(),'shouwei-bundle-flow-')),dataDir=join(root,'data')
let child,output='',hits=0
const model=createServer(async(req,res)=>{
  const buffers=[];for await(const bytes of req)buffers.push(bytes)
  hits++
  try {
    const body=JSON.parse(Buffer.concat(buffers).toString()),content=JSON.stringify(checkReply(body))
    res.writeHead(200,{'content-type':'text/event-stream'})
    for(const data of [
      {id:'local',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]},
      {id:'local',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20}},
    ])res.write('data: '+JSON.stringify(data)+'\n\n')
    res.end('data: [DONE]\n\n')
  }catch{res.writeHead(500);res.end()}
})
await new Promise((yes,no)=>{model.once('error',no);model.listen(0,'127.0.0.1',yes)})
const reserve=createServer();await new Promise(yes=>reserve.listen(0,'127.0.0.1',yes));const port=reserve.address().port;await new Promise(yes=>reserve.close(yes))
const url='http://127.0.0.1:'+port,headers={'x-shouwei-request':'local','content-type':'application/json'}
async function api(path,body,method=body===undefined?'GET':'POST') {
  const reply=await fetch(url+'/api'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})})
  const value=await reply.json();assert.equal(value.ok,true,JSON.stringify(value));return value.data
}
async function start() {
  output=''
  child=spawn(join(resources,'bin/node'),[join(resources,'app/service/lib/main.js')],{cwd:resources,env:{HOME:root,PATH:join(resources,'bin')+':/usr/bin:/bin',LANG:'en_US.UTF-8',SHOUWEI_DATA_DIR:dataDir,SHOUWEI_PORT:String(port),SHOUWEI_WEB_ROOT:join(resources,'web'),SHOUWEI_KEYCHAIN_HELPER:join(resources,'bin/keychain'),SHOUWEI_RUNTIME_PATCH:join(resources,'runtime/shouwei.patch.yml'),SHOUWEI_DISTRIBUTION:'macos-test'},stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',b=>{output=(output+b.toString()).slice(-8192)});child.stderr.on('data',()=>{})
  child.on('error',error=>{output=error.message})
  for(let i=0;i<100;i++){
    if(output.includes('收尾搭子已启动：'))return
    if(child.exitCode!==null)throw new Error('Bundled service failed: '+output)
    await new Promise(yes=>setTimeout(yes,100))
  }
  throw new Error('Bundled startup timed out')
}
async function stop() {
  if(!child || child.exitCode!==null)return
  const current=child;current.kill('SIGTERM')
  await new Promise((yes,no)=>{const timer=setTimeout(()=>{current.kill('SIGKILL');no(new Error('Package failed graceful shutdown'))},10000);current.once('exit',code=>{clearTimeout(timer);code===0?yes():no(new Error('Package nonzero shutdown'))})})
  child=null
}
async function settled(id) {
  for(let i=0;i<300;i++) {
    const view=await api('/projects/'+id+'/analysis'),run=view.workflow.runs.at(-1)
    if(!view.project.activeRunId){assert.equal(run?.state,'completed',JSON.stringify(run));return view}
    await new Promise(yes=>setTimeout(yes,100))
  }
  throw new Error('Synthetic package model timed out')
}
try {
  await start()
  assert.match(await (await fetch(url)).text(),/收尾搭子/)
  const system=await api('/system');assert.equal(system.distribution,'macos-test');assert.equal(system.nodeVersion,'24.15.0')
  const configured=await api('/model',{displayName:'发行包合成模型',baseUrl:'http://127.0.0.1:'+model.address().port+'/v1',modelId:'test-model',contextWindow:64000,maxOutputTokens:4096,requestTimeoutMs:15000,apiKey:'',noCredential:true,persistCredential:false})
  let project=await api('/projects',{name:'第五阶段合成验收',recipient:'测试收件人',goal:'统一活动日期'}),files=[]
  const original=join(root,'original.txt'),bytes=Buffer.from('活动日期：2026-10-24');await writeFile(original,bytes)
  for(const [name,role] of [['要求.txt','requirement'],['方案.txt','deliverable']]) {
    const selected=await api('/projects/'+project.id+'/selections',{name,base64:bytes.toString('base64')})
    const imported=await api('/projects/'+project.id+'/imports',{token:selected.token,expectedRevision:project.revision,role,encoding:'utf-8'})
    files.push(imported.file)
    project=(await api('/projects/'+project.id+'/parse',{snapshotId:imported.file.id,expectedRevision:imported.project.revision})).project
  }
  await api('/projects/'+project.id+'/analysis/start',{expectedRevision:project.revision,kind:'requirements',consent:true,modelConnectionId:configured.connection.id})
  let view=await settled(project.id)
  const edits=view.workflow.draft.map(r=>({id:r.id,text:r.text,importance:r.importance,originKind:r.originKind,sourceEvidence:r.sourceEvidence,applicability:'applicable',reason:''}))
  const confirmed=await api('/projects/'+project.id+'/analysis/confirm',{expectedRevision:view.project.revision,edits})
  view=await api('/projects/'+project.id+'/analysis')
  await api('/projects/'+project.id+'/analysis/start',{expectedRevision:view.project.revision,kind:'check',consent:true,modelConnectionId:configured.connection.id})
  view=await settled(project.id)
  const prepared=await api('/projects/'+project.id+'/deliveries',{expectedRevision:view.project.revision,files:[{snapshotId:files[1].id,name:'方案.txt'}],note:'请查收<script>inert</script>',requirementRisks:[]})
  assert.equal(prepared.assessment.conclusion,'ready')
  const done=await api('/projects/'+project.id+'/deliveries/'+prepared.id+'/export',{})
  assert.equal(done.state,'completed')
  const download=async kind=>Buffer.from(await (await fetch(url+'/api/projects/'+project.id+'/deliveries/'+done.id+'/download/'+kind,{headers})).arrayBuffer())
  const zipBytes=await download('zip'),zip=unzipSync(zipBytes),manifest=JSON.parse(strFromU8(zip['manifest.json']))
  assert.deepEqual(Buffer.from(zip['材料/方案.txt']),bytes)
  assert.equal(manifest.files[0].sha256,createHash('sha256').update(bytes).digest('hex'))
  assert.equal(zip['检查报告.html'],undefined)
  assert.match((await download('report')).toString(),/&lt;script&gt;/)
  assert.deepEqual(await readFile(original),bytes)
  const callsAfterCheck=hits
  await stop();await start()
  assert.equal((await api('/model')).configured,true)
  assert.equal((await api('/deliveries'))[0].available,true)
  assert.deepEqual(await download('zip'),zipBytes)
  assert.equal(hits,callsAfterCheck)
  await stop()
  await assert.rejects(fetch(url),/fetch failed/)
  const report={ok:true,version:system.version,platform:system.platform,arch:system.arch,node:system.nodeVersion,distribution:system.distribution,syntheticModelRequests:hits,paidRequests:0,originalUnchanged:true,zipHashVerified:true,inertReport:true,historyAfterRestart:true,ordinaryConfigurationRestored:true,serviceStopped:true,systemNodeInPath:false,cleanMachine:false,guiLauncher:false,signed:false}
  await mkdir('docs/evidence/stage-5',{recursive:true});await writeFile('docs/evidence/stage-5/package-flow.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}finally {
  if(child?.exitCode===null)await stop()
  model.closeAllConnections();await new Promise(yes=>model.close(yes))
  await rm(root,{recursive:true,force:true})
}
