import { mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
if (process.platform !== 'darwin') { console.log('系统安全存储不可用；仅本次使用密钥。'); process.exit(0) }
const root=fileURLToPath(new URL('../',import.meta.url))
await mkdir(root+'native/build',{recursive:true})
const result=spawnSync('/usr/bin/swiftc',['native/Keychain.swift','-o','native/build/keychain'],{cwd:root,stdio:'inherit'})
process.exit(result.status??1)
