import { lstat, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { languageForExtension, primaryLanguage } from './languages.mjs'

/**
 * Directories that hold machine-generated or vendored bytes. Counting them
 * would make every project look the same size — that of its node_modules — so
 * they are skipped wholesale and reported separately.
 */
export const DEFAULT_IGNORED_DIRS = Object.freeze([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'bower_components',
  'vendor',
  'Pods',
  'Carthage',
  '.build',
  'DerivedData',
  'target',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.astro',
  '.turbo',
  '.parcel-cache',
  '.cache',
  '.gradle',
  '.terraform',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  'coverage',
  '.nyc_output',
  '.idea',
  '.vscode',
])

/** Hard ceiling so a pathological tree cannot hang the survey. */
const DEFAULT_MAX_FILES = 200_000

/**
 * Walk a project directory and measure it: files, bytes on disk, language
 * composition, and the most recent file modification.
 *
 * Symlinks are skipped outright rather than followed — following them would
 * double-count shared trees and can cycle. Ignored directories are recorded by
 * name so the report can say what it chose not to look at.
 *
 * @param {string} dir
 * @param {{ ignoredDirs?: Iterable<string>, maxFiles?: number }} [options]
 */
export async function scanProject(dir, options = {}) {
  const ignored = new Set(options.ignoredDirs ?? DEFAULT_IGNORED_DIRS)
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES

  const byLanguage = new Map()
  const skipped = new Set()
  let files = 0
  let bytes = 0
  let lastModifiedMs = 0
  let truncated = false
  let unreadable = 0

  /** @type {string[]} */
  const queue = [dir]

  while (queue.length > 0) {
    const current = queue.pop()
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      // A directory we cannot read (permissions, or it vanished mid-walk) is
      // noted rather than fatal — a survey of 50 projects should not die on one.
      unreadable += 1
      continue
    }

    const filesHere = []
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) {
          skipped.add(entry.name)
          continue
        }
        queue.push(join(current, entry.name))
      } else if (entry.isFile()) {
        filesHere.push(entry.name)
      }
    }

    const stats = await Promise.all(
      filesHere.map((name) => lstat(join(current, name)).catch(() => null)),
    )

    for (let i = 0; i < stats.length; i += 1) {
      const stat = stats[i]
      if (!stat) {
        unreadable += 1
        continue
      }
      if (files >= maxFiles) {
        truncated = true
        queue.length = 0
        break
      }
      files += 1
      bytes += stat.size
      if (stat.mtimeMs > lastModifiedMs) lastModifiedMs = stat.mtimeMs

      const language = languageForExtension(extname(filesHere[i]))
      if (language) byLanguage.set(language, (byLanguage.get(language) ?? 0) + stat.size)
    }
  }

  return {
    files,
    bytes,
    byLanguage,
    primary: primaryLanguage(byLanguage),
    lastModified: lastModifiedMs > 0 ? new Date(lastModifiedMs) : null,
    skipped: [...skipped].sort(),
    unreadable,
    truncated,
  }
}
