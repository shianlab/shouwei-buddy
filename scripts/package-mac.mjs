import { readFile, writeFile, mkdir, cp, rename, rm, readdir, lstat, realpath, chmod, symlink } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { validateLicenses } from './license-index.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),version='0.1.0-rc.1'
if(process.platform!=='darwin'||process.arch!=='arm64')throw new Error('This candidate targets macOS arm64 only')
const run=(bin,args,cwd=root)=>{const r=spawnSync(bin,args,{cwd,stdio:'inherit',env:{...process.env,COPYFILE_DISABLE:'1'},maxBuffer:1048576});if(r.status!==0)throw new Error('Packaging command failed: '+bin)}
const exists=async p=>lstat(p).then(()=>true,()=>false)
const cache=join(root,'.release-cache'),release=join(root,'release'),app=join(release,'收尾搭子.app'),res=join(app,'Contents/Resources')
await mkdir(cache,{recursive:true});await mkdir(release,{recursive:true})
const archive=join(cache,'node-v24.15.0-darwin-arm64.tar.gz')
if(!await exists(archive)) {
  const downloaded='/tmp/shouwei-node-v24.15.0-darwin-arm64.tar.gz'
  if(await exists(downloaded))await cp(downloaded,archive)
  else run('/usr/bin/curl',['--fail','--location','--retry','2','--output',archive,'https://nodejs.org/dist/v24.15.0/node-v24.15.0-darwin-arm64.tar.gz'])
}
const expected='372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4'
if(createHash('sha256').update(await readFile(archive)).digest('hex')!==expected)throw new Error('Official Node archive checksum mismatch')
if(!await exists(join(cache,'node-v24.15.0-darwin-arm64/bin/node')))run('/usr/bin/tar',['-xzf',archive,'-C',cache])
await mkdir(join(app,'Contents/MacOS'),{recursive:true})
for(const dir of ['bin','app','licenses','runtime'])await mkdir(join(res,dir),{recursive:true})
const service=join(res,'app/service')
const lockHash=createHash('sha256').update(await readFile(join(root,'pnpm-lock.yaml'))).digest('hex')
const graphMarker=join(res,'production-lock.sha256')
if(await exists(join(service,'node_modules')) && (!await exists(graphMarker) || (await readFile(graphMarker,'utf8')).trim()!==lockHash))await rm(service,{recursive:true,force:true})
if(!await exists(join(service,'node_modules'))) {
  const probe=join(root,'.release-work/deploy-probe')
  if(await exists(join(probe,'node_modules')))await rename(probe,service)
  else run('npm',['exec','--yes','--package=pnpm@11.28.5','--','pnpm','--filter','@shouwei/server','deploy','--prod','--legacy','--offline',service])
}
await writeFile(graphMarker,lockHash+'\n')
// Legacy deploy leaves workspace aliases unrelated to the selected server graph.
const aliases=join(service,'node_modules/.pnpm/node_modules/@shouwei')
for(const name of ['desktop','web','server'])await rm(join(aliases,name),{force:true})
await mkdir(aliases,{recursive:true});await symlink(relative(aliases,service),join(aliases,'server'))
// Refresh every local workspace library even when reusing the expensive production dependency tree.
await rm(join(service,'lib'),{recursive:true,force:true});await cp(join(root,'apps/server/lib'),join(service,'lib'),{recursive:true})
await cp(join(root,'apps/server/package.json'),join(service,'package.json'))
for(const name of ['core','contracts','harness-adapter']) {
  const target=await realpath(join(service,'node_modules/@shouwei',name))
  await rm(join(target,'lib'),{recursive:true,force:true});await cp(join(root,'packages',name,'lib'),join(target,'lib'),{recursive:true})
  await cp(join(root,'packages',name,'package.json'),join(target,'package.json'))
}
await rm(join(res,'web'),{recursive:true,force:true});await cp(join(root,'apps/web/dist'),join(res,'web'),{recursive:true})
await cp(join(root,'runtime/shouwei.patch.yml'),join(res,'runtime/shouwei.patch.yml'))
await cp(join(cache,'node-v24.15.0-darwin-arm64/bin/node'),join(res,'bin/node'));await chmod(join(res,'bin/node'),0o755)
await cp(join(cache,'node-v24.15.0-darwin-arm64/LICENSE'),join(res,'licenses/Node-LICENSE.txt'))
run('/usr/bin/swiftc',['native/Keychain.swift','-o',join(res,'bin/keychain')])
run('/usr/bin/swiftc',['native/Launcher.swift','-o',join(app,'Contents/MacOS/shouwei-buddy')])
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.shouwei-buddy.launcher</string><key>CFBundleName</key><string>收尾搭子</string><key>CFBundleExecutable</key><string>shouwei-buddy</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleVersion</key><string>1</string><key>NSHighResolutionCapable</key><true/></dict></plist>`
await writeFile(join(app,'Contents/Info.plist'),plist)
await writeFile(join(res,'release.json'),JSON.stringify({version,platform:'darwin-arm64',distribution:'macos-test',testedOS:'macOS 26.2',signed:false,notarized:false,node:'24.15.0',nodeArchiveSha256:expected},null,2))
const packages=[],visited=new Set();let logicalBytes=0
const supplemental=JSON.parse(await readFile(join(root,'docs/licenses/release-sources.json'),'utf8'))
const shared={'@aws-sdk/credential-provider-http':'@aws-sdk/core','@aws-sdk/credential-provider-login':'@aws-sdk/core','@aws-sdk/nested-clients':'@aws-sdk/core','@deepseek-ai/dsh-experimental-inspector':'@deepseek-ai/dsh','@koromix/koffi-darwin-arm64':'koffi','@napi-rs/canvas-darwin-arm64':'@napi-rs/canvas'}
await rm(join(res,'licenses/packages'),{recursive:true,force:true})
await mkdir(join(res,'licenses/packages'),{recursive:true})
async function walk(dir) {
  for(const name of await readdir(dir)) {
    const path=join(dir,name),stat=await lstat(path)
    if(name.startsWith('._')||name==='.DS_Store'){await rm(path,{recursive:true,force:true});continue}
    if(stat.isSymbolicLink())continue
    if(stat.isDirectory())await walk(path)
    else {
      logicalBytes+=stat.size
      if(name==='package.json' && path.includes('/node_modules/')) {
        const pkg=JSON.parse(await readFile(path,'utf8')),identity=pkg.name+'@'+pkg.version
        if(!path.endsWith('/node_modules/'+pkg.name+'/package.json'))continue
        if(!pkg.name||!pkg.version||visited.has(identity))continue
        visited.add(identity)
        const licenses=[]
        let licenseEvidence='publisher-file'
        for(const file of await readdir(dirname(path)))if(/^(licen[sc]e|copying|notice)([.\-_]|$)/i.test(file)) {
          const source=join(dirname(path),file);if(!(await lstat(source)).isFile())continue
          const target=identity.replaceAll('/','__')+'__'+file
          await cp(source,join(res,'licenses/packages',target));licenses.push('packages/'+target)
        }
        if(!licenses.length) {
          async function nested(dir) {
            for(const file of await readdir(dir)) {
              const source=join(dir,file),stat=await lstat(source)
              if(stat.isDirectory())await nested(source)
              else if(stat.isFile() && /licen[sc]e|copying|notice/i.test(file)) {
                const target=identity.replaceAll('/','__')+'__nested__'+relative(dirname(path),source).replaceAll('/','__')
                await cp(source,join(res,'licenses/packages',target));licenses.push('packages/'+target)
              }
            }
          }
          await nested(dirname(path));if(licenses.length)licenseEvidence='nested-publisher-file'
        }
        if(!licenses.length && pkg.name.startsWith('@shouwei/')) {licenses.push('Shouwei-LICENSE.txt');licenseEvidence='shared-project-license'}
        if(!licenses.length && shared[pkg.name]) {
          const parent=await realpath(join(service,'node_modules/.pnpm/node_modules',shared[pkg.name]))
          const metadata=JSON.parse(await readFile(join(parent,'package.json'),'utf8'))
          if(metadata.license!==pkg.license)throw new Error('Shared license mismatch')
          for(const file of await readdir(parent))if(/^(licen[sc]e|copying|notice)([.\-_]|$)/i.test(file) && (await lstat(join(parent,file))).isFile()) {
            const target=identity.replaceAll('/','__')+'__shared__'+file
            await cp(join(parent,file),join(res,'licenses/packages',target));licenses.push('packages/'+target)
          }
          if(licenses.length)licenseEvidence='shared-upstream:'+metadata.name+'@'+metadata.version
        }
        if(!licenses.length) {
          const entry=supplemental[identity]
          for(const file of entry?.files??[]) {
            const source=join(root,file),bytes=await readFile(source)
            if(entry.files.length===1 && createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Supplemental license checksum mismatch: '+identity)
            const target=identity.replaceAll('/','__')+'__'+file.split('/').at(-1)
            await cp(source,join(res,'licenses/packages',target));licenses.push('packages/'+target)
          }
          if(licenses.length)licenseEvidence=entry.kind??'version-pinned-upstream-file'
        }
        packages.push({name:pkg.name,version:pkg.version,license:pkg.license??'UNDECLARED',licenseFiles:licenses,licenseEvidence})
      }
    }
  }
}
await walk(app)
packages.sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version))
await writeFile(join(res,'licenses/dependencies.json'),JSON.stringify(packages,null,2))
await cp(join(root,'LICENSE'),join(res,'licenses/Shouwei-LICENSE.txt'))
await cp(join(root,'THIRD_PARTY_NOTICES.md'),join(res,'licenses/THIRD_PARTY_NOTICES.md'))
await cp(join(root,'docs/licenses/release-sources.json'),join(res,'licenses/supplemental-sources.json'))
await validateLicenses(packages,join(res,'licenses'))
// Copies on external volumes can recreate AppleDouble; remove only this generated bundle's sidecars.
async function clean(dir){for(const name of await readdir(dir)){const path=join(dir,name);if(name.startsWith('._'))await rm(path,{force:true});else if((await lstat(path)).isDirectory())await clean(path)}}
await clean(app)
run(process.execPath,['scripts/verify-package.mjs',app])
const zip=join(release,`shouwei-buddy-${version}-macos-arm64.zip`)
run('/usr/bin/ditto',['--norsrc','--noextattr','-c','-k','--keepParent',app,zip])
const bytes=await readFile(zip),sha256=createHash('sha256').update(bytes).digest('hex')
await writeFile(zip+'.sha256',`${sha256}  ${zip.split('/').at(-1)}\n`)
const unknown=packages.filter(p=>p.license==='UNDECLARED')
console.log(JSON.stringify({ok:true,version,zip:zip.split('/').at(-1),sha256,zipBytes:bytes.length,logicalBytes,dependencies:packages.length,undeclaredLicenses:unknown.map(p=>p.name+'@'+p.version),signed:false,cleanSystem:false}))
