import { lstat, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
export async function validateLicenses(records,root) {
  const base=await realpath(root)
  for(const record of records) {
    if(!record.license || record.license==='UNDECLARED' || !record.licenseFiles?.length)throw new Error('LICENSE_TEXT_MISSING: '+record.name+'@'+record.version)
    for(const relative of record.licenseFiles) {
      const path=resolve(base,relative),actual=await realpath(path),stat=await lstat(path)
      if(!actual.startsWith(base+sep)||!stat.isFile()||stat.isSymbolicLink()||!stat.size)throw new Error('LICENSE_TEXT_INVALID: '+record.name)
    }
  }
}
