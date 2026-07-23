import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { compareDiagnosticQualityArchives } from '../src/lib/diagnostics/quality-diff'

async function main() {
  const [leftPath, rightPath] = process.argv.slice(2)
  if (!leftPath || !rightPath) {
    console.error('Usage: npx tsx scripts/diagnostic-quality-diff.ts <left.zip> <right.zip>')
    process.exitCode = 1
    return
  }

  const [left, right] = await Promise.all([
    readFile(path.resolve(process.cwd(), leftPath)),
    readFile(path.resolve(process.cwd(), rightPath)),
  ])
  const comparison = await compareDiagnosticQualityArchives({ left, right })
  console.log(JSON.stringify(comparison, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
