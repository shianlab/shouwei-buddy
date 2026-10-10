import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalServer } from '../../apps/server/src/server.js'
it('local settings deletes only a confirmed idle project and diagnostics exclude private input',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shouwei-settings-'))
  const app=await createLocalServer({dataDir:root,port:0})
  const send=(path:string,method='GET',data?:unknown)=>fetch(app.url+path,{method,headers:{'x-shouwei-request':'local',...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})})
  try {
    const response=await send('/api/projects','POST',{name:'PRIVATE-NAME',recipient:'PRIVATE-RECIPIENT',goal:'PRIVATE-BODY'})
    const project=(await response.json() as any).data
    const saved=await send('/api/model','POST',{displayName:'PRIVATE-MODEL',baseUrl:'http://127.0.0.1:9998/v1',modelId:'PRIVATE-MODEL-ID',contextWindow:64000,maxOutputTokens:4096,requestTimeoutMs:8000,apiKey:'PRIVATE-SECRET',noCredential:false})
    expect(saved.status).toBe(200)
    const diagnostic=await send('/api/diagnostics')
    expect(diagnostic.status).toBe(200)
    const text=await diagnostic.text()
    for(const privateText of ['PRIVATE-NAME','PRIVATE-RECIPIENT','PRIVATE-BODY','PRIVATE-MODEL','PRIVATE-SECRET',root,'9998'])expect(text).not.toContain(privateText)
    expect(JSON.parse(text).data.storage.projects).toBe(1)
    expect((await send('/api/system')).status).toBe(200)
    expect((await send(`/api/projects/${project.id}`,'DELETE',{expectedRevision:1})).status).toBe(400)
    expect((await send(`/api/projects/${project.id}`,'DELETE',{expectedRevision:1,confirm:true,sourcePath:'/private'})).status).toBe(400)
    expect((await send(`/api/projects/${project.id}`,'DELETE',{expectedRevision:1,confirm:true})).status).toBe(200)
    expect((await send(`/api/projects/${project.id}`)).status).toBe(404)
    expect((await send('/api/model','DELETE',{confirm:true})).status).toBe(200)
    const status=(await (await send('/api/model')).json() as any).data
    expect(status.configured).toBe(false)
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})
