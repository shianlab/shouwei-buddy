import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
export interface CredentialStore {
  readonly available: boolean
  get(reference: string): Promise<string | null>
  set(reference: string, value: string): Promise<void>
  delete(reference: string): Promise<void>
}
/** Secret payload travels through stdin; it is never part of argv or environment. */
export class MacKeychain implements CredentialStore {
  readonly available: boolean
  constructor(private helper: string) {
    this.available = process.platform === 'darwin' && existsSync(helper)
  }
  private call(action: 'get' | 'set' | 'delete', reference: string, value?: string): Promise<string | null> {
    if (!this.available) return Promise.reject(new Error('Secure store unavailable'))
    return new Promise((resolve,reject)=>{
      const child=spawn(this.helper,[],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}})
      let output='', settled=false
      const finish=(error?: Error, result: string|null=null)=>{
        if(settled)return
        settled=true; clearTimeout(timer)
        if(error)reject(error);else resolve(result)
      }
      const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Secure store failed'))},30000)
      child.stdout.on('data',(part:Buffer)=>{output+=part.toString();if(output.length>10000){child.kill('SIGKILL');finish(new Error('Secure store failed'))}})
      child.stderr.resume()
      child.on('error',()=>finish(new Error('Secure store unavailable')))
      child.stdin.on('error',()=>finish(new Error('Secure store failed')))
      child.on('close',(code)=>{
        try {
          const reply=JSON.parse(output)
          if(code!==0 || reply.ok!==true || !(reply.value===null || typeof reply.value==='string')) throw new Error()
          finish(undefined,reply.value)
        } catch {finish(new Error('Secure store failed'))}
      })
      child.stdin.end(JSON.stringify({action,reference,...(value===undefined?{}:{value})}))
    })
  }
  get(reference:string){return this.call('get',reference)}
  async set(reference:string,value:string){await this.call('set',reference,value)}
  async delete(reference:string){await this.call('delete',reference)}
}
