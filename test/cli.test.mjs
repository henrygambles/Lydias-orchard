import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { makeTree } from './helpers.mjs'

const run = promisify(execFile)
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'orchard.mjs')

/**
 * Link the binary the way a package manager does: `npm install -g` and `npx`
 * both put a symlink on PATH rather than the file itself, so argv[1] is the
 * link and not the module. Running through one of these is the only way to
 * catch an entrypoint guard that compares the two paths without resolving.
 */
async function linkedBin(t) {
  const dir = await mkdtemp(join(tmpdir(), 'orchard-bin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const link = join(dir, 'orchard')
  await symlink(BIN, link)
  return link
}

test('runs when invoked through its real path', async () => {
  const { stdout } = await run(process.execPath, [BIN, '--version'])
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/)
})

test('--version reports the version npm published, not a hardcoded copy', async () => {
  const manifest = JSON.parse(await readFile(join(dirname(BIN), '..', 'package.json'), 'utf8'))

  const { stdout } = await run(process.execPath, [BIN, '--version'])

  assert.equal(stdout.trim(), manifest.version)
})

test('runs when invoked through a symlink, as a global or npx install does', async (t) => {
  const link = await linkedBin(t)

  const { stdout } = await run(process.execPath, [link, '--version'])

  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/)
})

test('--help through a symlink prints usage rather than exiting silently', async (t) => {
  const link = await linkedBin(t)

  const { stdout } = await run(process.execPath, [link, '--help'])

  assert.match(stdout, /Usage/)
  assert.match(stdout, /--sort/)
})

test('surveys a directory through a symlink', async (t) => {
  const link = await linkedBin(t)
  const root = await makeTree({ 'alpha/index.js': 'console.log(1)\n' }, t)

  const { stdout } = await run(process.execPath, [link, root, '--json', '--no-git'])

  const report = JSON.parse(stdout)
  assert.deepEqual(
    report.projects.map((p) => p.name),
    ['alpha'],
  )
})

test('importing the module does not run the CLI', async () => {
  const { stdout } = await run(process.execPath, [
    '--input-type=module',
    '-e',
    `import { main } from ${JSON.stringify(BIN)}
     if (typeof main !== 'function') throw new Error('main not exported')
     process.stdout.write('imported\\n')`,
  ])

  assert.equal(stdout, 'imported\n')
})

test('exits non-zero with a message when the directory is missing', async (t) => {
  const link = await linkedBin(t)

  await assert.rejects(
    () => run(process.execPath, [link, join(tmpdir(), 'orchard-does-not-exist')]),
    (error) => {
      assert.equal(error.code, 1)
      assert.match(error.stderr, /No such directory/)
      return true
    },
  )
})
