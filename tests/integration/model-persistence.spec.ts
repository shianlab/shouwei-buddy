import { it, expect } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalModel } from '../../apps/server/src/model.js'
const settings={displayName:'合成连接',baseUrl:'http://127.0.0.1:9999/v1',modelId:'synthetic',contextWindow:64000,maxOutputTokens:4096,requestTimeoutMs:8000,apiKey:'synthetic-never-on-disk',noCredential:false,persistCredential:true}
function vault() {
  const secrets=new Map<string,string>()
  return {available:true,get:async(id:string)=>secrets.get(id)??null,set:async(id:string,key:string)=>{secrets.set(id,key)},delete:async(id:string)=>{secrets.delete(id)}}
}
it('restores a credential reference without returning the key or saving it in ordinary files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shouwei-model-persist-')),credentials=vault()
  try {
    const first=new (LocalModel as any)(join(root,'model-runtime'),{credentials})
    await first.initialize()
    await first.configure(settings)
    expect(JSON.stringify(first.status())).not.toContain(settings.apiKey)
    await first.close()
    const second=new (LocalModel as any)(join(root,'model-runtime'),{credentials})
    await second.initialize()
    expect(second.status()).toMatchObject({configured:true,tested:false,credentialStorage:'keychain'})
    expect(second.snapshot().modelId).toBe('synthetic')
    for(const file of await readdir(root)) if(file.endsWith('.json')) expect(await readFile(join(root,file),'utf8')).not.toContain(settings.apiKey)
    await second.forget()
    await second.close()
    const third=new (LocalModel as any)(join(root,'model-runtime'),{credentials})
    await third.initialize()
    expect(third.status().configured).toBe(false)
    await third.close()
  } finally {await rm(root,{recursive:true,force:true})}
})
it('session-only credentials restore ordinary settings but need a new key after restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shouwei-model-session-'))
  try {
    const first=new (LocalModel as any)(join(root,'model-runtime'),{credentials:{...vault(),available:false}})
    await first.initialize()
    await first.configure({...settings,persistCredential:false})
    await first.close()
    const second=new (LocalModel as any)(join(root,'model-runtime'),{credentials:{...vault(),available:false}})
    await second.initialize()
    expect(second.status()).toMatchObject({configured:false,needsCredential:true,connection:{modelId:'synthetic'}})
    expect(JSON.stringify(second.status())).not.toContain(settings.apiKey)
    await second.close()
  } finally {await rm(root,{recursive:true,force:true})}
})
it('secure-store failures preserve the previous configuration and never fall back to plaintext',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shouwei-model-failure-'))
  try {
    const credentials={...vault(),set:async()=>{throw new Error('SENSITIVE '+settings.apiKey)}}
    const model=new (LocalModel as any)(join(root,'model-runtime'),{credentials})
    await model.initialize()
    await model.configure({...settings,noCredential:true,apiKey:'',persistCredential:false})
    await expect(model.configure(settings)).rejects.toThrow('系统凭据保存未完成')
    expect(model.status()).toMatchObject({configured:true,connection:{modelId:'synthetic'}})
    expect(await readFile(join(root,'model-settings.json'),'utf8')).not.toContain(settings.apiKey)
    await model.close()
  } finally {await rm(root,{recursive:true,force:true})}
})

it('rejects persisted insecure endpoints before looking up a secure credential',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shouwei-model-invalid-')),credentials=vault()
  let reads=0
  try {
    const first=new LocalModel(join(root,'model-runtime'),{credentials})
    await first.configure(settings);await first.close()
    const file=join(root,'model-settings.json'),saved=JSON.parse(await readFile(file,'utf8'))
    saved.connection.baseUrl='http://remote.example/v1'
    await writeFile(file,JSON.stringify(saved))
    const second=new LocalModel(join(root,'model-runtime'),{credentials:{...credentials,get:async()=>{reads++;return settings.apiKey}}})
    await second.initialize()
    expect(second.status()).toMatchObject({configured:false,connection:null,restoreWarning:true})
    expect(reads).toBe(0)
    await second.close()
  }finally{await rm(root,{recursive:true,force:true})}
})
