import { extract, type ParseInput } from './extract.js'
process.once('message', async (input: Omit<ParseInput, 'bytes'> & { base64: string }) => {
  try {
    const result = await extract({ ...input, bytes: Buffer.from(input.base64, 'base64') })
    process.send?.(result, () => process.exit(0))
  } catch {
    process.exit(1)
  }
})
