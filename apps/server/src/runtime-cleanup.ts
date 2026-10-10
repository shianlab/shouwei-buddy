import { readdir, realpath, lstat, rm, writeFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { safeRead } from '@shouwei/core'
const ownerSchema=z.object({schema:z.literal(1),callName:z.string().regex(/^call-[A-Za-z0-9]{6}$/),projectId:z.uuid().nullable(),runId:z.string().max(100).nullable(),pid:z.number().int().positive()}).strict()
const execute=promisify(execFile)
function alive(pid:number) {
  try{process.kill(pid,0);return true}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH'}
}
export async function recordCallOwner(path:string,projectId:string|null,runId:string|null) {
  await writeFile(join(path,'owner.json'),JSON.stringify(ownerSchema.parse({schema:1,callName:basename(path),projectId,runId,pid:process.pid})),{flag:'wx',mode:0o600})
}
/** Called under the server's exclusive data-directory lock. Never kills a process. */
export async function cleanRuntimeCalls(root:string,projectId?:string) {
  let pending=false,active=false
  try {
    if(await realpath(root)!==root)return {pending:true,active:true}
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {pending,active};return {pending:true,active:true}}
  let commands:string
  let names:string[]
  try {names=(await readdir(root)).filter(n=>n.startsWith('call-'))}catch{return {pending:true,active:true}}
  if(!names.length)return {pending,active}
  try {
    if(process.platform!=='darwin'&&process.platform!=='linux')return {pending:true,active:true}
    commands=(await execute('/bin/ps',['-axo','command='],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:5000})).stdout
  }catch{return {pending:true,active:true}}
  for(const name of names) {
    const path=join(root,name)
    try {
      const stat=await lstat(path)
      if(!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path)!==path) {pending=true;continue}
      const owner=ownerSchema.parse(JSON.parse((await safeRead(join(path,'owner.json'),path,2048)).toString()))
      if(owner.callName!==name){pending=true;continue}
      if(projectId!==undefined && owner.projectId!==projectId)continue
      // Both the recorded owner and any orphan runtime referencing this root must have exited.
      if(alive(owner.pid)||commands.includes(path)){pending=true;active=true;continue}
      if(await realpath(path)!==path){pending=true;continue}
      await rm(path,{recursive:true})
    }catch{pending=true;if(commands.includes(path))active=true}
  }
  return {pending,active}
}
