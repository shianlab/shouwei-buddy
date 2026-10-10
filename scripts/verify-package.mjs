import { readFile, realpath, readdir, lstat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { validateLicenses } from './license-index.mjs'
const target=resolve(process.argv[2]??'release/收尾搭子.app')
try {
  const root=await realpath(target),resources=join(root,'Contents','Resources')
  const manifest=JSON.parse(await readFile(join(resources,'release.json'),'utf8'))
  for(const name of ['bin/node','bin/keychain','app/service/lib/main.js','web/index.html','runtime/shouwei.patch.yml','licenses/Node-LICENSE.txt']) await lstat(join(resources,name))
  await lstat(join(root,'Contents','MacOS','shouwei-buddy'))
  let links=0,files=0
  async function walk(dir) {
    for(const name of await readdir(dir)) {
      if(name.startsWith('._'))throw new Error('AppleDouble')
      const path=join(dir,name),stat=await lstat(path)
      if(stat.isSymbolicLink()) {links++;if(!(await realpath(path)).startsWith(root+sep))throw new Error('External link')}
      else if(stat.isDirectory())await walk(path)
      else files++
    }
  }
  await walk(root)
  await validateLicenses(JSON.parse(await readFile(join(resources,'licenses/dependencies.json'),'utf8')),join(resources,'licenses'))
  const version=spawnSync(join(resources,'bin','node'),['--version'],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'})
  if(version.status!==0 || version.stdout.trim()!=='v24.15.0')throw new Error('Runtime mismatch')
  console.log(JSON.stringify({ok:true,version:manifest.version,platform:manifest.platform,node:version.stdout.trim(),files,links,signed:false,cleanSystem:false}))
} catch (error) {console.log(JSON.stringify({ok:false,code:'PACKAGE_INCOMPLETE',reason:error.message}));process.exitCode=1}
