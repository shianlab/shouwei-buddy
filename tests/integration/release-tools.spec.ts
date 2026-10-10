import { it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unzipSync, strFromU8 } from 'fflate'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
it('package verification rejects absent runtime resources without claiming a runnable release',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shouwei-missing-package-'))
  try {
    const result=spawnSync(process.execPath,['scripts/verify-package.mjs',join(root,'missing.app')],{encoding:'utf8'})
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('"ok":false')
    expect(result.stdout).toContain('PACKAGE_INCOMPLETE')
  }finally{await rm(root,{recursive:true,force:true})}
})
it('source packaging includes reusable code while excluding unknown private folders and generated data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shouwei-source-scope-')),output=join(tmpdir(),`shouwei-source-${Date.now()}.zip`)
  try {
    await writeFile(join(root,'README.md'),'public README')
    for(const dir of ['apps/server/src','node_modules/pkg','private-materials','release','.secret-dir','docs/internal','docs/licenses/release','.github/ISSUE_TEMPLATE']) await mkdir(join(root,dir),{recursive:true})
    await writeFile(join(root,'apps/server/src/main.ts'),'export const publicCode=true')
    await writeFile(join(root,'docs/architecture.md'),'public architecture')
    await writeFile(join(root,'docs/licenses/release/fixture-LICENSE.txt'),'required redistribution license')
    await writeFile(join(root,'.github/ISSUE_TEMPLATE/bug_report.yml'),'name: Bug report')
    for(const path of ['.env','model-settings.json','private-materials/user.txt','.secret-dir/key','node_modules/pkg/private','release/cache','docs/internal/draft.md','docs/stage-5-progress.md'])await writeFile(join(root,path),'do-not-release')
    const module=pathToFileURL(fileURLToPath(new URL('../../scripts/package-source.mjs',import.meta.url))).href
    const result=spawnSync(process.execPath,['--input-type=module','--eval','const {packageSource}=await import(process.argv[1]);await packageSource(process.argv[2],process.argv[3])',module,root,output],{encoding:'utf8'})
    expect(result.status).toBe(0)
    const zip=unzipSync(await readFile(output))
    expect(Object.keys(zip).sort()).toEqual(['shouwei-buddy/.github/ISSUE_TEMPLATE/bug_report.yml','shouwei-buddy/README.md','shouwei-buddy/apps/server/src/main.ts','shouwei-buddy/docs/architecture.md','shouwei-buddy/docs/licenses/release/fixture-LICENSE.txt'])
    expect(strFromU8(zip['shouwei-buddy/README.md'])).toBe('public README')
  }finally{await rm(root,{recursive:true,force:true});await rm(output,{force:true})}
})
it('release license validation rejects SPDX-only packages and accepts real mapped license text',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shouwei-license-gate-'))
  try {
    const module=pathToFileURL(fileURLToPath(new URL('../../scripts/license-index.mjs',import.meta.url))).href
    const run=(index:unknown)=>spawnSync(process.execPath,['--input-type=module','--eval','const {validateLicenses}=await import(process.argv[1]);await validateLicenses(JSON.parse(process.argv[2]),process.argv[3])',module,JSON.stringify(index),root],{encoding:'utf8'})
    expect(run([{name:'fontkit',version:'2.0.4',license:'MIT',licenseFiles:[]}]).stderr).toContain('LICENSE_TEXT_MISSING')
    await writeFile(join(root,'LICENSE.txt'),'MIT license fixture')
    expect(run([{name:'fixture',version:'1',license:'MIT',licenseFiles:['LICENSE.txt']}]).status).toBe(0)
  }finally{await rm(root,{recursive:true,force:true})}
})
