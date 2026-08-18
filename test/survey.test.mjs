import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'

import { toJSON } from '../src/render/json.mjs'
import {
  ACTIVITY_BANDS,
  activityBand,
  listProjects,
  sortProjects,
  survey,
  topLanguages,
} from '../src/survey.mjs'
import { git, hasGit, makeTree, touch } from './helpers.mjs'

const JS = 'console.log(1)\n'
const PY = 'print(1)\n'
const MD = '# hi\n'

const NOW = new Date('2026-03-01T00:00:00Z')
const daysBefore = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)

// ---------------------------------------------------------------------------
// listProjects
// ---------------------------------------------------------------------------

test('listProjects returns directories only, sorted, skipping dotfiles', async (t) => {
  const root = await makeTree(
    {
      'beta/index.js': JS,
      'alpha/index.js': JS,
      'loose.txt': 'not a project',
      '.hidden/index.js': JS,
    },
    t,
  )

  const projects = await listProjects(root)

  assert.deepEqual(
    projects.map((p) => p.name),
    ['alpha', 'beta'],
  )
  assert.equal(projects[0].path, join(root, 'alpha'))
})

test('listProjects counts a symlinked directory as a project and says so', async (t) => {
  const root = await makeTree({ 'pkg/index.js': JS, mirror: { link: 'pkg' } }, t)

  const projects = await listProjects(root)

  assert.deepEqual(
    projects.map((p) => [p.name, p.symlink]),
    [
      ['mirror', true],
      ['pkg', false],
    ],
  )
})

// ---------------------------------------------------------------------------
// activityBand
// ---------------------------------------------------------------------------

test('activityBand places every age in exactly one band', () => {
  const band = (days) => activityBand(days).key

  assert.equal(band(0), 'week')
  assert.equal(band(7), 'week')
  assert.equal(band(8), 'month')
  assert.equal(band(30), 'month')
  assert.equal(band(31), 'quarter')
  assert.equal(band(90), 'quarter')
  assert.equal(band(91), 'year')
  assert.equal(band(365), 'year')
  assert.equal(band(366), 'dormant')
  // An age we could not determine is dormant rather than missing.
  assert.equal(band(null), 'dormant')
  assert.equal(band(undefined), 'dormant')
})

test('the bands are contiguous and open-ended at the top', () => {
  assert.equal(ACTIVITY_BANDS.at(-1).maxDays, Infinity)
  const bounds = ACTIVITY_BANDS.map((b) => b.maxDays)
  assert.deepEqual(bounds, [...bounds].sort((a, b) => a - b))
})

// ---------------------------------------------------------------------------
// survey
// ---------------------------------------------------------------------------

test('survey measures each project and totals them', async (t) => {
  const root = await makeTree(
    {
      'alpha/index.js': JS,
      'alpha/node_modules/dep.js': 'x'.repeat(9999),
      'beta/main.py': PY,
      'beta/README.md': MD,
      'loose.txt': 'not a project',
    },
    t,
  )
  await touch(join(root, 'alpha/index.js'), daysBefore(3))
  await touch(join(root, 'beta/main.py'), daysBefore(200))
  await touch(join(root, 'beta/README.md'), daysBefore(200))

  const result = await survey(root, { git: false, now: NOW })

  assert.equal(result.root, root)
  assert.equal(result.gitInspected, false)
  assert.deepEqual(
    result.projects.map((p) => p.name),
    ['alpha', 'beta'],
  )

  const [alpha, beta] = result.projects
  assert.equal(alpha.files, 1)
  assert.equal(alpha.bytes, JS.length)
  assert.equal(alpha.primary, 'JavaScript')
  assert.equal(alpha.idleDays, 3)
  assert.equal(alpha.activitySource, 'mtime')
  assert.equal(beta.primary, 'Python')
  assert.equal(beta.idleDays, 200)

  assert.equal(result.totals.projects, 2)
  assert.equal(result.totals.repos, 0)
  assert.equal(result.totals.files, 3)
  assert.equal(result.totals.bytes, JS.length + PY.length + MD.length)
  assert.equal(result.totals.languages, 3)
  assert.equal(result.totals.bands.get('week'), 1)
  assert.equal(result.totals.bands.get('year'), 1)
  assert.equal(result.totals.mostRecent.name, 'alpha')
  assert.equal(result.totals.idleMedian, 102) // (3 + 200) / 2, rounded
})

test('survey flags nothing when git inspection is turned off', async (t) => {
  const root = await makeTree({ 'alpha/index.js': JS }, t)

  const result = await survey(root, { git: false, now: NOW })

  assert.equal(result.projects[0].git, null)
  assert.deepEqual(result.projects[0].flags, [])
  assert.equal(result.projects[0].severity, null)
  assert.equal(result.totals.needsAttention, 0)
})

test('survey flags a directory that is not under git', async (t) => {
  const root = await makeTree({ 'alpha/index.js': JS }, t)

  const result = await survey(root, { now: NOW })

  assert.equal(result.projects[0].git.isRepo, false)
  assert.equal(result.projects[0].severity, 'serious')
  assert.equal(result.totals.needsAttention, 1)
  assert.equal(result.totals.flagCounts.get('no-repo'), 1)
})

test('survey reports progress once per project', async (t) => {
  const root = await makeTree({ 'alpha/index.js': JS, 'beta/index.js': JS }, t)
  const seen = []

  await survey(root, { git: false, now: NOW, onProgress: (p) => seen.push(p) })

  assert.equal(seen.length, 2)
  assert.deepEqual(
    seen.map((p) => p.done),
    [1, 2],
  )
  assert.ok(seen.every((p) => p.total === 2))
  assert.deepEqual(seen.map((p) => p.name).sort(), ['alpha', 'beta'])
})

test(
  'survey prefers a commit date over file mtimes',
  { skip: (await hasGit()) ? false : 'git is not on PATH' },
  async (t) => {
    const root = await makeTree({ 'alpha/index.js': JS }, t)
    const alpha = join(root, 'alpha')
    await git(alpha, ['init', '-q', '-b', 'main'])
    await git(alpha, ['add', '-A'])
    await git(alpha, ['commit', '-q', '-m', 'first'])
    // Checking a branch out rewrites mtimes, so an old mtime on a live repo is
    // not evidence of an old project. The commit date is.
    await touch(join(alpha, 'index.js'), new Date('2015-01-01T00:00:00Z'))

    const result = await survey(root, { now: new Date() })
    const [project] = result.projects

    assert.equal(project.activitySource, 'commit')
    assert.equal(project.idleDays, 0)
    assert.equal(project.git.branch, 'main')
  },
)

test('survey copes with an empty root by returning nothing, not by throwing', async (t) => {
  const root = await makeTree({ 'loose.txt': 'no directories here' }, t)

  const result = await survey(root, { git: false, now: NOW })

  assert.deepEqual(result.projects, [])
  assert.equal(result.totals.projects, 0)
  assert.equal(result.totals.idleMedian, null)
  assert.equal(result.totals.mostRecent, null)
})

// ---------------------------------------------------------------------------
// sortProjects
// ---------------------------------------------------------------------------

const FIXTURES = [
  { name: 'cherry', bytes: 300, files: 3, idleDays: 1, primary: 'Python', severity: 'warning' },
  { name: 'apple', bytes: 100, files: 9, idleDays: 90, primary: 'JavaScript', severity: 'critical' },
  { name: 'banana', bytes: 300, files: 1, idleDays: null, primary: null, severity: null },
]

test('sortProjects orders by each supported key', () => {
  const names = (key) => sortProjects(FIXTURES, key).map((p) => p.name)

  assert.deepEqual(names('size'), ['banana', 'cherry', 'apple']) // tie broken by name
  assert.deepEqual(names('files'), ['apple', 'cherry', 'banana'])
  assert.deepEqual(names('name'), ['apple', 'banana', 'cherry'])
  assert.deepEqual(names('activity'), ['cherry', 'apple', 'banana']) // unknown age sorts last
  assert.deepEqual(names('language'), ['apple', 'cherry', 'banana']) // no language sorts last
  assert.deepEqual(names('attention'), ['apple', 'cherry', 'banana'])
})

test('sortProjects does not mutate its input', () => {
  const before = FIXTURES.map((p) => p.name)
  sortProjects(FIXTURES, 'name')
  assert.deepEqual(
    FIXTURES.map((p) => p.name),
    before,
  )
})

test('sortProjects reverses on request', () => {
  assert.deepEqual(
    sortProjects(FIXTURES, 'name', true).map((p) => p.name),
    ['cherry', 'banana', 'apple'],
  )
})

test('sortProjects rejects an unknown key', () => {
  assert.throws(() => sortProjects(FIXTURES, 'nonsense'), /Unknown sort key/)
})

// ---------------------------------------------------------------------------
// topLanguages
// ---------------------------------------------------------------------------

test('topLanguages folds the tail into an Other remainder', () => {
  const byLanguage = new Map([
    ['JavaScript', 100],
    ['Python', 50],
    ['Go', 20],
    ['Rust', 5],
  ])

  assert.deepEqual(topLanguages(byLanguage, 2), [
    ['JavaScript', 100],
    ['Python', 50],
    ['Other', 25],
  ])
})

test('topLanguages leaves a short list alone', () => {
  const byLanguage = new Map([['JavaScript', 100]])

  assert.deepEqual(topLanguages(byLanguage, 8), [['JavaScript', 100]])
})

// ---------------------------------------------------------------------------
// toJSON — the documented contract other tools consume.
// ---------------------------------------------------------------------------

test('toJSON projects the survey onto a stable, serialisable shape', async (t) => {
  const root = await makeTree({ 'alpha/index.js': JS }, t)
  await touch(join(root, 'alpha/index.js'), daysBefore(5))

  const json = JSON.parse(JSON.stringify(toJSON(await survey(root, { git: false, now: NOW }))))

  assert.equal(json.orchard, 1)
  assert.equal(json.root, root)
  assert.equal(json.generatedAt, NOW.toISOString())
  assert.equal(json.gitInspected, false)
  // Maps and Dates would otherwise stringify to `{}` and be lost.
  assert.deepEqual(json.totals.byLanguage, { JavaScript: JS.length })
  assert.deepEqual(
    json.totals.activity.map((band) => band.key),
    ACTIVITY_BANDS.map((band) => band.key),
  )
  assert.equal(json.totals.activity.find((band) => band.key === 'week').projects, 1)

  const [project] = json.projects
  assert.equal(project.name, 'alpha')
  assert.equal(project.primaryLanguage, 'JavaScript')
  assert.equal(project.idleDays, 5)
  assert.equal(project.activitySource, 'mtime')
  assert.equal(project.lastActivity, daysBefore(5).toISOString())
  assert.equal(project.git, null)
})
