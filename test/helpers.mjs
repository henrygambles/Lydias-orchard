import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Build a throwaway directory tree.
 *
 * Spec keys are relative paths; a string value writes a file, and
 * `{ link: 'target' }` writes a symlink. Directories are created implicitly,
 * and a key ending in `/` creates an empty one.
 *
 * @param {Record<string, string | { link: string }>} spec
 * @param {{ after: (fn: () => unknown) => void }} [t]  node:test context, for cleanup
 */
export async function makeTree(spec, t) {
  const root = await mkdtemp(join(tmpdir(), 'orchard-test-'))
  if (t) t.after(() => rm(root, { recursive: true, force: true }))

  for (const [path, value] of Object.entries(spec)) {
    const full = join(root, path)
    if (path.endsWith('/')) {
      await mkdir(full, { recursive: true })
      continue
    }
    await mkdir(dirname(full), { recursive: true })
    if (typeof value === 'string') await writeFile(full, value)
    else await symlink(join(root, value.link), full)
  }

  return root
}

/** Set a file's modification time, for staleness assertions. */
export async function touch(path, date) {
  await utimes(path, date, date)
}

const IDENTITY = [
  '-c',
  'user.name=Orchard Test',
  '-c',
  'user.email=test@example.invalid',
  '-c',
  'commit.gpgsign=false',
]

/** Run git in `cwd` with a fixed identity, so tests never depend on user config. */
export function git(cwd, args) {
  return run('git', ['-C', cwd, ...IDENTITY, ...args], { timeout: 20_000 })
}

/** True when a usable git is on PATH; the git-dependent tests skip without one. */
export async function hasGit() {
  try {
    await run('git', ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}
