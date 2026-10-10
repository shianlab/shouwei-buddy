import { readdir, lstat, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'
import { createHash } from 'node:crypto'
export async function packageSource(root,output) {
  const files={}
  const rootDirectories=new Set(['apps','packages','scripts','runtime','tests','docs','native','.github'])
  const rootFiles=new Set(['README.md','CHANGELOG.md','LICENSE','SECURITY.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json','tsconfig.tests.json','tsconfig.e2e.json','vitest.config.ts','playwright.config.ts','.gitignore','.gitattributes','.env.example'])
  const publicDocs=new Set(['assets','licenses','architecture.md','getting-started.md','verification.md','known-limitations.md','local-data.md','release-checklist.md'])
  const excluded=new Set(['node_modules','.git','lib','dist','build','.release-cache','.release-work','test-results','playwright-report'])
  async function walk(dir,relative='') {
    for(const name of await readdir(dir)) {
      if(!relative&&!rootDirectories.has(name)&&!rootFiles.has(name))continue
      if(relative==='docs'&&!publicDocs.has(name))continue
      if(name.startsWith('.') && name!=='.env.example' && name!=='.gitignore' && name!=='.gitattributes' && !(relative===''&&name==='.github'))continue
      if(excluded.has(name)||name.startsWith('._')||(name.startsWith('.env')&&name!=='.env.example')||name.endsWith('.log')||name.endsWith('.sqlite')||name.startsWith('model-settings'))continue
      const path=join(dir,name),rel=relative?relative+'/'+name:name,stat=await lstat(path)
      if(stat.isSymbolicLink())continue
      if(stat.isDirectory())await walk(path,rel)
      else files['shouwei-buddy/'+rel]=new Uint8Array(await readFile(path))
    }
  }
  await walk(root)
  const bytes=zipSync(files,{level:6})
  await writeFile(output,bytes,{mode:0o600})
  const sha256=createHash('sha256').update(bytes).digest('hex')
  await writeFile(output+'.sha256',`${sha256}  ${output.split('/').at(-1)}\n`,{mode:0o600})
  return {files:Object.keys(files).length,sha256}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));await mkdir(join(root,'release'),{recursive:true})
  console.log(JSON.stringify(await packageSource(root,join(root,'release','shouwei-buddy-0.1.0-rc.1-source.zip'))))
}
