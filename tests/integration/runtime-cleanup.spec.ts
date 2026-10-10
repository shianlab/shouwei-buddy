import { it,expect } from 'vitest'
import { mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalModel } from '../../apps/server/src/model.js'
it('startup reclaims confirmed-dead owned material sessions but preserves live, unknown and linked paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shouwei-runtime-recovery-')),runtime=join(root,'model-runtime')
 const projectId='5e993911-8360-4ad9-b026-969898617ddf'
 try {
  await mkdir(runtime)
  for(const [name,pid] of [['call-dead01',2147483647],['call-live01',process.pid]] as const){
   await mkdir(join(runtime,name,'dsh-home/sessions'),{recursive:true})
   await writeFile(join(runtime,name,'owner.json'),JSON.stringify({schema:1,callName:name,projectId,runId:null,pid}))
   await writeFile(join(runtime,name,'dsh-home/sessions/private.jsonl'),'private model material')
  }
  await mkdir(join(runtime,'call-unkn01'));await writeFile(join(runtime,'call-unkn01','keep'),'unknown')
  const outside=join(root,'outside');await mkdir(outside);await writeFile(join(outside,'keep'),'outside')
  await symlink(outside,join(runtime,'call-link01'))
  const model=new LocalModel(runtime);await model.initialize()
  expect(await readdir(runtime)).not.toContain('call-dead01')
  expect(await readFile(join(runtime,'call-live01/dsh-home/sessions/private.jsonl'),'utf8')).toBe('private model material')
  expect(await readFile(join(runtime,'call-unkn01/keep'),'utf8')).toBe('unknown')
  expect(await readFile(join(outside,'keep'),'utf8')).toBe('outside')
  expect(model.status()).toMatchObject({cleanupPending:true,busy:true})
  await model.close()
 }finally{await rm(root,{recursive:true,force:true})}
})
it('project cleanup removes only its dead owned session and keeps another project session',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shouwei-runtime-project-')),runtime=join(root,'model-runtime')
 const one='5e993911-8360-4ad9-b026-969898617ddf',two='6e993911-8360-4ad9-b026-969898617ddf'
 try {
  await mkdir(runtime)
  for(const [name,projectId] of [['call-proj01',one],['call-proj02',two]]){
   await mkdir(join(runtime,name));await writeFile(join(runtime,name,'owner.json'),JSON.stringify({schema:1,callName:name,projectId,runId:null,pid:2147483647}))
   await writeFile(join(runtime,name,'session'),'material')
  }
  const model=new LocalModel(runtime)
  await (model as any).cleanupProject(one)
  expect(await readdir(runtime)).toEqual(['call-proj02'])
  await model.close()
 }finally{await rm(root,{recursive:true,force:true})}
})
