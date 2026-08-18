#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { renderHTML } from '../src/render/html.mjs'
import { toJSON } from '../src/render/json.mjs'
import { renderTerminal } from '../src/render/terminal.mjs'
import { SORT_KEYS, sortProjects, survey } from '../src/survey.mjs'

// Read from the manifest rather than duplicating it, so `--version` cannot
// drift from what npm published. npm always ships package.json.
const VERSION = createRequire(import.meta.url)('../package.json').version

const USAGE = `orchard — survey a directory of projects

Usage
  orchard [directory] [options]

Options
  -s, --sort <key>     ${SORT_KEYS.join(' | ')}  (default: size)
  -r, --reverse        Reverse the sort
  -n, --top <n>        Only list the first N projects (totals still cover all)
  -H, --html <file>    Write an HTML report
  -j, --json           Print JSON to stdout
      --open           Open the HTML report when it is written
      --no-git         Skip git inspection (faster)
      --no-color       Disable colour
  -q, --quiet          No progress output
  -h, --help           Show this message
  -v, --version        Show the version

Examples
  orchard ~/Code
  orchard ~/Code --sort attention
  orchard ~/Code --html report.html --open
  orchard ~/Code --json | jq '.projects[] | select(.severity == "critical")'
`

const OPTIONS = {
  sort: { type: 'string', short: 's', default: 'size' },
  reverse: { type: 'boolean', short: 'r', default: false },
  top: { type: 'string', short: 'n' },
  html: { type: 'string', short: 'H' },
  json: { type: 'boolean', short: 'j', default: false },
  open: { type: 'boolean', default: false },
  'no-git': { type: 'boolean', default: false },
  'no-color': { type: 'boolean', default: false },
  quiet: { type: 'boolean', short: 'q', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
}

async function main(argv) {
  let values
  let positionals
  try {
    ;({ values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true }))
  } catch (error) {
    return fail(`${error.message}\n\nRun \`orchard --help\` for usage.`)
  }

  if (values.help) return print(USAGE)
  if (values.version) return print(VERSION)

  if (!SORT_KEYS.includes(values.sort)) {
    return fail(`Unknown sort key "${values.sort}". Try: ${SORT_KEYS.join(', ')}`)
  }

  const top = values.top === undefined ? null : Number.parseInt(values.top, 10)
  if (top !== null && (!Number.isFinite(top) || top < 1)) {
    return fail(`--top expects a positive integer, got "${values.top}"`)
  }

  const root = resolve(positionals[0] ?? '.')
  // Progress goes to stderr so `--json` and `--html` stay pipeable.
  const interactive = !values.quiet && !values.json && process.stderr.isTTY
  const color = !values['no-color'] && !process.env.NO_COLOR && process.stdout.isTTY

  let result
  try {
    result = await survey(root, {
      git: !values['no-git'],
      onProgress: interactive ? showProgress : undefined,
    })
  } catch (error) {
    if (error.code === 'ENOENT') return fail(`No such directory: ${root}`)
    if (error.code === 'ENOTDIR') return fail(`Not a directory: ${root}`)
    if (error.code === 'EACCES') return fail(`Permission denied: ${root}`)
    throw error
  }
  if (interactive) clearProgress()

  if (result.projects.length === 0) {
    return fail(`No project directories found in ${root}`)
  }

  const sorted = sortProjects(result.projects, values.sort, values.reverse)
  result.projects = sorted

  if (values.html) {
    const target = resolve(values.html)
    await writeFile(target, renderHTML(result), 'utf8')
    if (!values.json) print(`Report written to ${target}`)
    if (values.open) openFile(target)
  }

  if (values.json) {
    print(JSON.stringify(toJSON(result), null, 2))
  } else if (!values.html) {
    print(
      renderTerminal(result, {
        color,
        width: process.stdout.columns ?? 100,
        projects: top ? sorted.slice(0, top) : sorted,
      }),
    )
  }

  return 0
}

let progressWidth = 0

function showProgress({ done, total, name }) {
  const line = `  scanning ${done}/${total}  ${name}`
  process.stderr.write(`\r${line.padEnd(progressWidth)}`)
  progressWidth = Math.max(progressWidth, line.length)
}

function clearProgress() {
  if (progressWidth > 0) process.stderr.write(`\r${' '.repeat(progressWidth)}\r`)
}

function openFile(path) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  execFile(opener, [path], (error) => {
    if (error) process.stderr.write(`Could not open ${path}: ${error.message}\n`)
  })
}

function print(text) {
  process.stdout.write(`${text}\n`)
  return 0
}

function fail(message) {
  process.stderr.write(`orchard: ${message}\n`)
  return 1
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  let entry = resolve(process.argv[1])
  try {
    entry = realpathSync(entry)
  } catch {
    // Entry point vanished mid-run; the unresolved path is the best we have.
  }
  return entry === fileURLToPath(import.meta.url)
}

// Only run when invoked as a program, so tests can import the module.
// argv[1] is whatever path the shell used, which for a global or npx install is
// a symlink into node_modules/.bin; import.meta.url is always the real path, so
// the two only line up once the link is followed.
if (invokedDirectly()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error) => {
      process.stderr.write(`orchard: ${error.stack ?? error.message}\n`)
      process.exitCode = 1
    })
}

export { main }
