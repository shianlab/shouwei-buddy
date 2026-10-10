import { cp, mkdir } from 'node:fs/promises'
const source = new URL('../src/renderer/', import.meta.url)
const target = new URL('../dist/renderer/', import.meta.url)
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true, filter: path => !path.split(/[\\/]/).at(-1).startsWith('._') })
