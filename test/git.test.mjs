import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { gitFlags, inspectGit, parseStatus, worstSeverity } from '../src/git.mjs'
import { git, hasGit, makeTree } from './helpers.mjs'

// ---------------------------------------------------------------------------
// parseStatus — the branch header, which has four irregular shapes. These are
// verbatim outputs of `git status --porcelain=v1 -b`.
// ---------------------------------------------------------------------------

test('parseStatus reads a tracking branch and its ahead/behind counts', () => {
  const status = parseStatus('## main...origin/main [ahead 2, behind 1]\n')

  assert.equal(status.branch, 'main')
  assert.equal(status.upstream, 'origin/main')
  assert.equal(status.ahead, 2)
  assert.equal(status.behind, 1)
})

test('parseStatus keeps dots that belong to the branch name', () => {
  const status = parseStatus('## release/1.2...origin/release/1.2 [ahead 1]\n')

  assert.equal(status.branch, 'release/1.2')
  assert.equal(status.upstream, 'origin/release/1.2')
})

test('parseStatus names a detached HEAD rather than reporting no branch', () => {
  assert.equal(parseStatus('## HEAD (no branch)\n').branch, 'HEAD (detached)')
})

test('parseStatus unwraps the unborn-branch prose', () => {
  const status = parseStatus('## No commits yet on main\n')

  assert.equal(status.branch, 'main')
  assert.equal(status.upstream, null)
})

test('parseStatus separates an unborn branch from the upstream it already has', () => {
  // The prose lead-in wraps an otherwise ordinary header; the upstream must not
  // end up glued to the branch name.
  const status = parseStatus('## No commits yet on main...origin/main [gone]\nA  a.js\n')

  assert.equal(status.branch, 'main')
  assert.equal(status.upstream, 'origin/main')
})

test('parseStatus counts changed and untracked entries separately', () => {
  const status = parseStatus(
    ['## main', ' M src/a.js', 'A  src/b.js', 'R  old.js -> new.js', '?? scratch/', ''].join('\n'),
  )

  assert.equal(status.changed, 3)
  assert.equal(status.untracked, 1)
})

test('parseStatus survives empty output', () => {
  assert.deepEqual(parseStatus(''), {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    changed: 0,
    untracked: 0,
  })
})

// ---------------------------------------------------------------------------
// inspectGit — against real repositories, so the parsing above stays honest
// about what git actually prints.
// ---------------------------------------------------------------------------

const SKIP_WITHOUT_GIT = (await hasGit()) ? false : 'git is not on PATH'

/** A work tree at `<tmp>/work` and a bare remote at `<tmp>/remote.git`. */
async function scaffold(t, spec = {}) {
  const root = await makeTree({ 'work/a.js': 'console.log(1)\n', ...spec }, t)
  const work = join(root, 'work')
  const remote = join(root, 'remote.git')
  await git(root, ['init', '-q', '--bare', remote])
  await git(work, ['init', '-q', '-b', 'main'])
  return { root, work, remote }
}

async function commitAll(work, message) {
  await git(work, ['add', '-A'])
  await git(work, ['commit', '-q', '-m', message])
}

test('inspectGit reports a plain directory as not a repo', { skip: SKIP_WITHOUT_GIT }, async (t) => {
  const root = await makeTree({ 'notes.md': '# hi\n' }, t)

  assert.deepEqual(await inspectGit(root), { isRepo: false, nestedIn: null })
})

test('inspectGit describes a clean repo with a remote', { skip: SKIP_WITHOUT_GIT }, async (t) => {
  const { work, remote } = await scaffold(t)
  await commitAll(work, 'first')
  await git(work, ['remote', 'add', 'origin', remote])
  await git(work, ['push', '-q', '-u', 'origin', 'main'])

  const info = await inspectGit(work)

  assert.equal(info.isRepo, true)
  assert.equal(info.branch, 'main')
  assert.equal(info.upstream, 'origin/main')
  assert.equal(info.ahead, 0)
  assert.equal(info.behind, 0)
  assert.equal(info.changed, 0)
  assert.equal(info.untracked, 0)
  assert.deepEqual(info.remotes, ['origin'])
  assert.equal(info.stashCount, 0)
  assert.equal(info.lastCommit.subject, 'first')
  assert.match(info.lastCommit.hash, /^[0-9a-f]{7,}$/)
  assert.ok(info.lastCommit.date instanceof Date)
  assert.deepEqual(gitFlags(info), [])
  assert.equal(worstSeverity(gitFlags(info)), null)
})

test('inspectGit reports a subdirectory as nested, not as its own repo', { skip: SKIP_WITHOUT_GIT }, async (t) => {
  const { work } = await scaffold(t, { 'work/src/app.js': 'export default 1\n' })
  await commitAll(work, 'first')

  const info = await inspectGit(join(work, 'src'))

  assert.equal(info.isRepo, false)
  assert.match(info.nestedIn, /work$/)
  assert.deepEqual(gitFlags(info), [
    { key: 'nested', label: 'inside another repo', severity: 'warning' },
  ])
})

test('inspectGit counts uncommitted and untracked work', { skip: SKIP_WITHOUT_GIT }, async (t) => {
  const { work } = await scaffold(t)
  await commitAll(work, 'first')
  await writeFile(join(work, 'a.js'), 'console.log(2)\n')
  await writeFile(join(work, 'scratch.js'), 'debugger\n')

  const info = await inspectGit(work)

  assert.equal(info.changed, 1)
  assert.equal(info.untracked, 1)
  assert.equal(worstSeverity(gitFlags(info)), 'critical')
})

test('inspectGit counts unpushed commits as ahead', { skip: SKIP_WITHOUT_GIT }, async (t) => {
  const { work, remote } = await scaffold(t)
  await commitAll(work, 'first')
  await git(work, ['remote', 'add', 'origin', remote])
  await git(work, ['push', '-q', '-u', 'origin', 'main'])
  await writeFile(join(work, 'a.js'), 'console.log(2)\n')
  await commitAll(work, 'second')

  const info = await inspectGit(work)

  assert.equal(info.ahead, 1)
  assert.equal(info.behind, 0)
  assert.ok(gitFlags(info).some((flag) => flag.key === 'ahead' && flag.label === '1 unpushed'))
})

test('inspectGit reads a repo with no commits yet', { skip: SKIP_WITHOUT_GIT }, async (t) => {
  const { work } = await scaffold(t)

  const info = await inspectGit(work)

  assert.equal(info.isRepo, true)
  assert.equal(info.branch, 'main')
  assert.equal(info.lastCommit, null)
  assert.equal(info.untracked, 1)
  assert.ok(gitFlags(info).some((flag) => flag.key === 'no-commits'))
  // Nothing has been committed, so "no remote" would be noise, not a finding.
  assert.ok(!gitFlags(info).some((flag) => flag.key === 'no-remote'))
})

test('inspectGit keeps the upstream of an unborn branch out of the branch name', { skip: SKIP_WITHOUT_GIT }, async (t) => {
  const { work, remote } = await scaffold(t)
  await git(work, ['remote', 'add', 'origin', remote])
  await git(work, ['config', 'branch.main.remote', 'origin'])
  await git(work, ['config', 'branch.main.merge', 'refs/heads/main'])
  await git(work, ['add', '-A'])

  const info = await inspectGit(work)

  assert.equal(info.branch, 'main')
  assert.equal(info.upstream, 'origin/main')
})

test('inspectGit names a detached HEAD', { skip: SKIP_WITHOUT_GIT }, async (t) => {
  const { work } = await scaffold(t)
  await commitAll(work, 'first')
  await writeFile(join(work, 'a.js'), 'console.log(2)\n')
  await commitAll(work, 'second')
  await git(work, ['checkout', '-q', 'HEAD~1'])

  const info = await inspectGit(work)

  assert.equal(info.branch, 'HEAD (detached)')
  assert.equal(info.lastCommit.subject, 'first')
})

test('inspectGit counts stashes', { skip: SKIP_WITHOUT_GIT }, async (t) => {
  const { work } = await scaffold(t)
  await commitAll(work, 'first')
  await writeFile(join(work, 'a.js'), 'console.log(2)\n')
  await git(work, ['stash', 'push', '-q', '-m', 'wip'])

  const info = await inspectGit(work)

  assert.equal(info.stashCount, 1)
  assert.equal(info.changed, 0)
  assert.ok(gitFlags(info).some((flag) => flag.key === 'stashed'))
})

test('inspectGit does not hang on a directory it cannot read as a repo', { skip: SKIP_WITHOUT_GIT }, async (t) => {
  const root = await makeTree({ '.git': 'this is a file, not a repo\n' }, t)

  const info = await inspectGit(root)

  // Broken or fake git metadata degrades to "no information", never a throw.
  assert.equal(info.isRepo, false)
})

// ---------------------------------------------------------------------------
// gitFlags / worstSeverity — the reduction from a reading to things to act on.
// ---------------------------------------------------------------------------

test('gitFlags puts the most urgent finding first', () => {
  const flags = gitFlags({
    isRepo: true,
    changed: 3,
    untracked: 2,
    ahead: 1,
    behind: 0,
    remotes: ['origin'],
    upstream: 'origin/main',
    stashCount: 1,
    lastCommit: { hash: 'abc1234', date: new Date(), subject: 'x' },
  })

  assert.equal(flags[0].key, 'dirty')
  assert.equal(flags[0].label, '3 uncommitted')
  assert.deepEqual(
    flags.map((flag) => flag.key),
    ['dirty', 'ahead', 'untracked', 'stashed'],
  )
  assert.equal(worstSeverity(flags), 'critical')
})

test('gitFlags calls out a directory that is not under git at all', () => {
  assert.deepEqual(gitFlags({ isRepo: false, nestedIn: null }), [
    { key: 'no-repo', label: 'not a repo', severity: 'serious' },
  ])
  assert.deepEqual(gitFlags(null), [
    { key: 'no-repo', label: 'not a repo', severity: 'serious' },
  ])
})

test('worstSeverity returns null for a clean project', () => {
  assert.equal(worstSeverity([]), null)
})
