import { execFile } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

// `%s` is a single line, so newline-separated fields parse unambiguously.
const LOG_FORMAT = '%h%n%aI%n%s'

/**
 * Ask git about a directory. Returns `{ isRepo: false }` for anything that is
 * not a repository root — including a directory that merely sits *inside* one,
 * which is reported as `nestedIn` so the caller can say why it looks bare.
 *
 * Every failure mode degrades to "no git information" rather than throwing: a
 * survey should still describe a project whose repo is broken.
 *
 * @param {string} dir
 * @param {{ timeout?: number }} [options]
 */
export async function inspectGit(dir, options = {}) {
  const exec = (args) =>
    run('git', ['-C', dir, ...args], {
      timeout: options.timeout ?? 10_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })

  let toplevel
  try {
    const { stdout } = await exec(['rev-parse', '--show-toplevel'])
    toplevel = stdout.trim()
  } catch {
    return { isRepo: false, nestedIn: null }
  }

  const [here, root] = await Promise.all([safeRealpath(dir), safeRealpath(toplevel)])
  if (here !== root) return { isRepo: false, nestedIn: toplevel }

  const [status, log, remotes, stashes] = await Promise.all([
    exec(['status', '--porcelain=v1', '-b', '--untracked-files=normal']).catch(() => null),
    exec(['log', '-1', `--format=${LOG_FORMAT}`]).catch(() => null),
    exec(['remote']).catch(() => null),
    exec(['stash', 'list']).catch(() => null),
  ])

  const { branch, upstream, ahead, behind, changed, untracked } = parseStatus(status?.stdout ?? '')

  return {
    isRepo: true,
    nestedIn: null,
    root,
    branch,
    upstream,
    ahead,
    behind,
    changed,
    untracked,
    remotes: lines(remotes?.stdout ?? ''),
    stashCount: lines(stashes?.stdout ?? '').length,
    lastCommit: parseLog(log?.stdout ?? ''),
  }
}

const UNBORN = 'No commits yet on '

/**
 * Parse `git status --porcelain=v1 -b`. The branch header is split on its
 * literal markers rather than matched as one pattern, because branch names may
 * contain dots (`release/1.2`) and the header has four irregular shapes:
 * `## main...origin/main [ahead 1]`, `## HEAD (no branch)`,
 * `## No commits yet on main`, and — for an unborn branch that already has an
 * upstream configured — `## No commits yet on main...origin/main [gone]`.
 */
export function parseStatus(stdout) {
  const result = { branch: null, upstream: null, ahead: 0, behind: 0, changed: 0, untracked: 0 }

  for (const line of stdout.split('\n')) {
    if (line.startsWith('## ')) {
      let rest = line.slice(3)

      const track = /\s\[([^\]]+)\]$/.exec(rest)
      if (track) {
        result.ahead = Number(/ahead (\d+)/.exec(track[1])?.[1] ?? 0)
        result.behind = Number(/behind (\d+)/.exec(track[1])?.[1] ?? 0)
        rest = rest.slice(0, track.index)
      }

      if (rest.includes('(no branch)')) {
        result.branch = 'HEAD (detached)'
      } else {
        // The unborn-branch lead-in is prose wrapped around an otherwise
        // ordinary header, so strip it before splitting: what follows still
        // carries the upstream when one is configured.
        if (rest.startsWith(UNBORN)) rest = rest.slice(UNBORN.length)
        const split = rest.indexOf('...')
        result.branch = split === -1 ? rest : rest.slice(0, split)
        result.upstream = split === -1 ? null : rest.slice(split + 3)
      }
    } else if (line.startsWith('??')) {
      result.untracked += 1
    } else if (line.trim() !== '') {
      result.changed += 1
    }
  }

  return result
}

function parseLog(stdout) {
  const [hash, date, ...subject] = stdout.split('\n')
  if (!hash || !date) return null
  const parsed = new Date(date)
  return {
    hash,
    date: Number.isNaN(parsed.getTime()) ? null : parsed,
    subject: subject.join(' ').trim(),
  }
}

function lines(stdout) {
  return stdout.split('\n').filter((line) => line.trim() !== '')
}

async function safeRealpath(path) {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * Reduce a git reading to the things worth acting on, most urgent first — the
 * first entry is what a one-line summary shows.
 *
 * @returns {{ key: string, label: string, severity: 'critical'|'serious'|'warning' }[]}
 */
export function gitFlags(git) {
  if (!git?.isRepo) {
    return git?.nestedIn
      ? [{ key: 'nested', label: 'inside another repo', severity: 'warning' }]
      : [{ key: 'no-repo', label: 'not a repo', severity: 'serious' }]
  }

  const flags = []
  if (git.changed > 0)
    flags.push({ key: 'dirty', label: `${git.changed} uncommitted`, severity: 'critical' })
  if (!git.lastCommit) flags.push({ key: 'no-commits', label: 'no commits', severity: 'serious' })
  if (git.ahead > 0) flags.push({ key: 'ahead', label: `${git.ahead} unpushed`, severity: 'serious' })
  if (git.lastCommit && git.remotes.length === 0)
    flags.push({ key: 'no-remote', label: 'no remote', severity: 'serious' })
  if (git.untracked > 0)
    flags.push({ key: 'untracked', label: `${git.untracked} untracked`, severity: 'warning' })
  if (git.behind > 0)
    flags.push({ key: 'behind', label: `${git.behind} behind`, severity: 'warning' })
  if (git.lastCommit && git.remotes.length > 0 && !git.upstream)
    flags.push({ key: 'no-upstream', label: 'no upstream', severity: 'warning' })
  if (git.stashCount > 0)
    flags.push({ key: 'stashed', label: `${git.stashCount} stashed`, severity: 'warning' })
  return flags
}

const SEVERITY_RANK = { critical: 3, serious: 2, warning: 1 }

/** The worst severity among a project's flags, or null when it is clean. */
export function worstSeverity(flags) {
  let worst = null
  for (const flag of flags) {
    if (!worst || SEVERITY_RANK[flag.severity] > SEVERITY_RANK[worst]) worst = flag.severity
  }
  return worst
}
