// Runtime verification: no key presses and no League Client API mutations.
// node <this-file> <screenshot.png> [another-screenshot.png ...]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

if (process.platform !== 'win32') throw new Error('Windows OCR requires Windows')
const paths = process.argv.slice(2)
if (!paths.length) throw new Error('Pass at least one surrender announcement screenshot')
const script = await readFile(new URL('./ocr-worker.ps1', import.meta.url), 'utf8')
const images = await Promise.all(
  paths.map(async (path) => (await readFile(path)).toString('base64'))
)
const child = spawn(
  join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
  [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')
  ],
  { windowsHide: true, stdio: 'pipe' }
)
child.stderr.resume()
const lines = createInterface({ input: child.stdout })
const timeout = setTimeout(() => child.kill(), 20000)
let sequence = 0
let completed = 0
try {
  for await (const line of lines) {
    const result = JSON.parse(line)
    assert.notEqual(result.type, 'error', result.error)
    if (result.type === 'result') {
      assert.equal(result.id, sequence)
      assert.equal(result.skipped, false)
      assert.match(result.text.normalize('NFKC').replace(/[\s\p{P}\p{Cf}]/gu, ''), /军团同意投降/u)
      completed++
      console.log(`Screenshot ${sequence}: announcement recognized in ${result.durationMs} ms`)
    }
    if (sequence === images.length) {
      child.stdin.end()
    } else {
      child.stdin.write(JSON.stringify({ id: ++sequence, image: images[sequence - 1] }) + '\n')
    }
  }
  assert.equal(sequence, images.length)
  assert.equal(completed, images.length)
  assert.equal(child.exitCode === null || child.exitCode === 0, true)
} finally {
  clearTimeout(timeout)
  lines.close()
  child.kill()
}
