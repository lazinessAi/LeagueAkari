// Runtime verification: no key presses and no League Client API mutations.
// node <this-file> [--vote|--selection|--no-vote|--pair] <screenshot.png> [another-screenshot.png ...]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

if (process.platform !== 'win32') throw new Error('Windows OCR requires Windows')
const rejectVote = process.argv.includes('--no-vote')
const selection = process.argv.includes('--selection')
const pair = process.argv.includes('--pair')
const vote = process.argv.includes('--vote') || rejectVote || selection
const paths = process.argv
  .slice(2)
  .filter((arg) => !['--vote', '--no-vote', '--selection', '--pair'].includes(arg))
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
      const normalize = (text) => text.normalize('NFKC').replace(/[\s\p{P}\p{Cf}]/gu, '')
      if (pair || !vote) {
        assert.match(normalize(result.chatText), /军团同意投降/u)
      }
      if (pair || vote) {
        const panel = normalize(result.panelText)
        if (selection) {
          assert.match(panel, /你选择/u)
        } else if (rejectVote) {
          assert.doesNotMatch(panel, /发起投[降的]/u)
        } else {
          assert.match(panel, /发起投[降的]/u)
        }
      }
      completed++
      console.log(
        `Screenshot ${sequence}: ${pair ? 'paired regions' : vote ? 'vote panel' : 'announcement'} recognized in ${result.durationMs} ms`
      )
    }
    if (sequence === images.length) {
      child.stdin.end()
    } else {
      child.stdin.write(
        JSON.stringify({
          id: ++sequence,
          image: images[sequence - 1],
          regions: pair
            ? {
                chat: { x: 0, y: 50, width: 50, height: 50 },
                panel: { x: 50, y: 50, width: 50, height: 50 }
              }
            : {
                chat: { x: 0, y: 0, width: 100, height: 100 },
                panel: { x: 0, y: 0, width: 100, height: 100 }
              }
        }) + '\n'
      )
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
