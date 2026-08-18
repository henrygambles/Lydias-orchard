import { readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import { daysSince } from './format.mjs'
import { gitFlags, inspectGit, worstSeverity } from './git.mjs'
import { scanProject } from './scan.mjs'

/**
 * Staleness buckets. Ordered, contiguous, and open-ended at the top — every
 * project lands in exactly one.
 */
export const ACTIVITY_BANDS = Object.freeze([
  { key: 'week', label: 'Past week', maxDays: 7 },
  { key: 'month', label: '1–4 weeks', maxDays: 30 },
  { key: 'quarter', label: '1–3 months', maxDays: 90 },
  { key: 'year', label: '3–12 months', maxDays: 365 },
  { key: 'dormant', label: 'Over a year', maxDays: Infinity },
])

export function activityBand(days) {
  if (days === null || days === undefined) return ACTIVITY_BANDS.at(-1)
  return ACTIVITY_BANDS.find((band) => days <= band.maxDays) ?? ACTIVITY_BANDS.at(-1)
}

/** Top-level directories in `root`, symlinks included (resolved, not followed blindly). */
export async function listProjects(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const candidates = entries.filter((entry) => !entry.name.startsWith('.'))

  const resolved = await Promise.all(
    candidates.map(async (entry) => {
      const path = join(root, entry.name)
      // stat (not lstat) so a symlinked project directory counts as a project.
      const info = await stat(path).catch(() => null)
      return info?.isDirectory() ? { name: entry.name, path, symlink: entry.isSymbolicLink() } : null
    }),
  )

  return resolved.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Survey every project directory under `root`.
 *
 * @param {string} root
 * @param {{
 *   git?: boolean,
 *   concurrency?: number,
 *   now?: Date,
 *   onProgress?: (progress: { done: number, total: number, name: string }) => void,
 * }} [options]
 */
export async function survey(root, options = {}) {
  const absoluteRoot = resolve(root)
  const withGit = options.git !== false
  const now = options.now ?? new Date()
  const entries = await listProjects(absoluteRoot)

  let done = 0
  const projects = await mapPool(entries, options.concurrency ?? 8, async (entry) => {
    const [scan, git] = await Promise.all([
      scanProject(entry.path),
      withGit ? inspectGit(entry.path) : Promise.resolve(null),
    ])

    done += 1
    options.onProgress?.({ done, total: entries.length, name: entry.name })

    const flags = withGit ? gitFlags(git) : []
    // A commit date beats file mtimes: checking a branch out rewrites mtimes,
    // so on a repo they measure the last `git` operation, not the last work.
    const committed = git?.lastCommit?.date ?? null
    const lastActivity = committed ?? scan.lastModified

    return {
      name: entry.name,
      path: entry.path,
      symlink: entry.symlink,
      ...scan,
      git,
      flags,
      severity: worstSeverity(flags),
      lastActivity,
      activitySource: committed ? 'commit' : scan.lastModified ? 'mtime' : null,
      idleDays: daysSince(lastActivity, now),
    }
  })

  return {
    root: absoluteRoot,
    generatedAt: now,
    gitInspected: withGit,
    projects,
    totals: summarise(projects, now),
  }
}

function summarise(projects, now) {
  const byLanguage = new Map()
  const bands = new Map(ACTIVITY_BANDS.map((band) => [band.key, 0]))
  const flagCounts = new Map()
  let bytes = 0
  let files = 0
  let repos = 0
  let needsAttention = 0
  let truncated = 0

  for (const project of projects) {
    bytes += project.bytes
    files += project.files
    if (project.git?.isRepo) repos += 1
    if (project.severity) needsAttention += 1
    if (project.truncated) truncated += 1

    for (const [language, size] of project.byLanguage) {
      byLanguage.set(language, (byLanguage.get(language) ?? 0) + size)
    }
    const band = activityBand(project.idleDays)
    bands.set(band.key, bands.get(band.key) + 1)
    for (const flag of project.flags) {
      flagCounts.set(flag.key, (flagCounts.get(flag.key) ?? 0) + 1)
    }
  }

  const active = projects.filter((p) => p.lastActivity)
  const mostRecent = active.reduce(
    (best, p) => (!best || p.lastActivity > best.lastActivity ? p : best),
    null,
  )

  return {
    projects: projects.length,
    repos,
    bytes,
    files,
    languages: byLanguage.size,
    byLanguage: sortMap(byLanguage),
    bands,
    flagCounts,
    needsAttention,
    truncated,
    mostRecent: mostRecent ? { name: mostRecent.name, at: mostRecent.lastActivity } : null,
    idleMedian: median(projects.map((p) => p.idleDays).filter((d) => d !== null)),
    now,
  }
}

const SORTERS = {
  size: (a, b) => b.bytes - a.bytes,
  files: (a, b) => b.files - a.files,
  name: (a, b) => a.name.localeCompare(b.name),
  activity: (a, b) => (a.idleDays ?? Infinity) - (b.idleDays ?? Infinity),
  // A sentinel character cannot express "last" here: localeCompare uses ICU
  // collation, which orders punctuation before letters, so unlabelled projects
  // are ranked explicitly instead — matching how `activity` treats an unknown.
  language: (a, b) => {
    if (Boolean(a.primary) !== Boolean(b.primary)) return a.primary ? -1 : 1
    return (a.primary ?? '').localeCompare(b.primary ?? '') || b.bytes - a.bytes
  },
  attention: (a, b) => severityRank(b) - severityRank(a) || b.bytes - a.bytes,
}

export const SORT_KEYS = Object.freeze(Object.keys(SORTERS))

function severityRank(project) {
  return { critical: 3, serious: 2, warning: 1 }[project.severity] ?? 0
}

/** Sort a copy; ties always break by name so output is stable run to run. */
export function sortProjects(projects, key = 'size', reverse = false) {
  const compare = SORTERS[key]
  if (!compare) throw new Error(`Unknown sort key: ${key}`)
  const sorted = [...projects].sort((a, b) => compare(a, b) || a.name.localeCompare(b.name))
  return reverse ? sorted.reverse() : sorted
}

function sortMap(map) {
  return new Map([...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Fold a language map to the top `limit` entries plus an "Other" remainder. */
export function topLanguages(byLanguage, limit = 8) {
  const entries = [...byLanguage]
  const head = entries.slice(0, limit)
  const tail = entries.slice(limit)
  if (tail.length > 0) {
    head.push(['Other', tail.reduce((sum, [, bytes]) => sum + bytes, 0)])
  }
  return head
}
