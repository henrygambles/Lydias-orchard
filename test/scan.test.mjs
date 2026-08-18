import assert from 'node:assert/strict'
import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import test from 'node:test'

import { DEFAULT_IGNORED_DIRS, scanProject } from '../src/scan.mjs'
import { makeTree, touch } from './helpers.mjs'

const JS = 'console.log(1)\n'
const TS = 'export const a = 1\n'
const MD = '# hi\n'

test('scanProject measures files and bytes, and skips generated trees', async (t) => {
  const root = await makeTree(
    {
      'index.js': JS,
      'src/app.ts': TS,
      'README.md': MD,
      'node_modules/dep/index.js': 'x'.repeat(5000),
      'dist/bundle.js': 'y'.repeat(1000),
    },
    t,
  )

  const scan = await scanProject(root)

  assert.equal(scan.files, 3)
  assert.equal(scan.bytes, JS.length + TS.length + MD.length)
  assert.equal(scan.truncated, false)
  assert.equal(scan.unreadable, 0)
  // Recorded by name, so the report can say what it declined to look at.
  assert.deepEqual(scan.skipped, ['dist', 'node_modules'])
})

test('scanProject attributes bytes to languages and picks a primary', async (t) => {
  const root = await makeTree({ 'index.js': JS, 'src/app.ts': TS, 'README.md': MD }, t)

  const scan = await scanProject(root)

  assert.deepEqual(
    [...scan.byLanguage].sort(),
    [
      ['JavaScript', JS.length],
      ['Markdown', MD.length],
      ['TypeScript', TS.length],
    ].sort(),
  )
  assert.equal(scan.primary, 'TypeScript')
})

test('scanProject counts unrecognised files toward size but not toward languages', async (t) => {
  const root = await makeTree({ 'photo.heic': 'binary-ish', 'notes.md': MD }, t)

  const scan = await scanProject(root)

  assert.equal(scan.files, 2)
  assert.equal(scan.bytes, 'binary-ish'.length + MD.length)
  assert.deepEqual([...scan.byLanguage.keys()], ['Markdown'])
  // Markdown is scaffolding, but it is all there is, so it still wins.
  assert.equal(scan.primary, 'Markdown')
})

test('scanProject does not follow symlinks, to files or to directories', async (t) => {
  const root = await makeTree(
    {
      'real.js': JS,
      'pkg/inner.js': JS,
      'alias.js': { link: 'real.js' },
      mirror: { link: 'pkg' },
    },
    t,
  )

  const scan = await scanProject(root)

  // real.js and pkg/inner.js only — the two links are neither counted nor walked.
  assert.equal(scan.files, 2)
  assert.equal(scan.bytes, JS.length * 2)
})

test('scanProject reports the newest file mtime as lastModified', async (t) => {
  const root = await makeTree({ 'old.js': JS, 'nested/new.js': JS }, t)
  const newest = new Date('2021-06-15T12:00:00Z')
  await touch(join(root, 'old.js'), new Date('2020-01-01T00:00:00Z'))
  await touch(join(root, 'nested/new.js'), newest)

  const scan = await scanProject(root)

  assert.equal(scan.lastModified.toISOString(), newest.toISOString())
})

test('scanProject describes an empty directory without inventing values', async (t) => {
  const root = await makeTree({ 'sub/': '' }, t)

  const scan = await scanProject(root)

  assert.equal(scan.files, 0)
  assert.equal(scan.bytes, 0)
  assert.equal(scan.lastModified, null)
  assert.equal(scan.primary, null)
  assert.deepEqual(scan.skipped, [])
})

test('scanProject stops at maxFiles and says so', async (t) => {
  const root = await makeTree({ 'a.js': JS, 'b.js': JS, 'c.js': JS }, t)

  const scan = await scanProject(root, { maxFiles: 2 })

  assert.equal(scan.files, 2)
  assert.equal(scan.truncated, true)
})

test('scanProject honours a custom ignore list', async (t) => {
  const root = await makeTree({ 'keep.js': JS, 'node_modules/dep.js': JS, 'attic/old.js': JS }, t)

  const scan = await scanProject(root, { ignoredDirs: ['attic'] })

  // node_modules is no longer ignored; attic now is.
  assert.equal(scan.files, 2)
  assert.deepEqual(scan.skipped, ['attic'])
})

// chmod is advisory for the superuser, so the case cannot be staged as root.
const SKIP_AS_ROOT = process.getuid?.() === 0 && 'chmod does not restrict the superuser'

test('scanProject counts an unreadable directory instead of failing', { skip: SKIP_AS_ROOT }, async (t) => {
  const root = await makeTree({ 'keep.js': JS, 'locked/secret.js': JS }, t)
  const locked = join(root, 'locked')
  await chmod(locked, 0o000)

  let scan
  try {
    scan = await scanProject(root)
  } finally {
    // Restore before cleanup runs: rm cannot recurse into a directory it cannot read.
    await chmod(locked, 0o755)
  }

  assert.equal(scan.files, 1)
  assert.equal(scan.unreadable, 1)
})

test('the default ignore list is frozen and free of duplicates', () => {
  assert.ok(Object.isFrozen(DEFAULT_IGNORED_DIRS))
  assert.equal(new Set(DEFAULT_IGNORED_DIRS).size, DEFAULT_IGNORED_DIRS.length)
})
