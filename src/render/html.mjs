import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatBytes, formatCount, formatRelative } from '../format.mjs'
import { ACTIVITY_BANDS } from '../survey.mjs'
import { toJSON } from './json.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// Inlined so a report is one file you can mail, commit, or open from a USB stick.
const CSS = readFileSync(join(here, 'report.css'), 'utf8')
const CLIENT = readFileSync(join(here, 'client.js'), 'utf8')

/** Short forms for the stat tile, where a full phrase would not fit. */
const FLAG_NOUNS = {
  dirty: 'uncommitted',
  untracked: 'untracked',
  ahead: 'unpushed',
  behind: 'behind',
  'no-remote': 'no remote',
  'no-upstream': 'no upstream',
  'no-repo': 'not a repo',
  'no-commits': 'no commits',
  nested: 'nested',
  stashed: 'stashed',
}

const TABLE_COLUMNS = [
  { key: 'name', label: 'Project' },
  { key: 'language', label: 'Language' },
  { key: 'bytes', label: 'Size', align: 'num' },
  { key: 'files', label: 'Files', align: 'num' },
  { key: 'branch', label: 'Branch' },
  { key: 'status', label: 'Status' },
  { key: 'idleDays', label: 'Last activity' },
]

/**
 * Render a survey as a single self-contained HTML file.
 *
 * The table is rendered server-side so the report still carries every number
 * with scripting off; the filters and charts are the scripted layer on top.
 *
 * @param {object} result a `survey()` result
 */
export function renderHTML(result) {
  const payload = {
    ...toJSON(result),
    flagNouns: FLAG_NOUNS,
    bands: ACTIVITY_BANDS.map((band) => ({
      key: band.key,
      label: band.label,
      maxDays: Number.isFinite(band.maxDays) ? band.maxDays : null,
    })),
  }

  const stamp = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(result.generatedAt)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="orchard">
<title>Orchard — ${escapeHtml(result.root)}</title>
<style>
${CSS}
.stack { margin-bottom: 16px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <div>
      <h1>Orchard</h1>
      <p class="root">${escapeHtml(result.root)}</p>
      <p class="stamp">Surveyed ${escapeHtml(stamp)}</p>
    </div>
    <button id="theme-toggle" class="theme-toggle" type="button">Theme: system</button>
  </header>

  <div class="filters">
    <input id="filter-search" type="search" placeholder="Filter by name…" aria-label="Filter projects by name" autocomplete="off">
    <select id="filter-language" aria-label="Filter by primary language">
      <option value="">All languages</option>
    </select>
    <label class="check"><input id="filter-attention" type="checkbox"> Needs attention only</label>
    <span class="count" id="result-count">${formatCount(result.projects.length)} projects</span>
  </div>

  <noscript>
    <p class="empty">Filters and charts need JavaScript. The table below carries every value regardless.</p>
  </noscript>

  <section class="tiles" id="tiles"></section>

  <div class="grid-2">
    <section class="card">
      <h2>Largest projects</h2>
      <p class="sub" id="largest-sub">Excluding dependency and build directories</p>
      <div id="chart-largest"></div>
    </section>
    <section class="card">
      <h2>Language composition</h2>
      <p class="sub">Bytes of recognised source across every project</p>
      <div id="chart-languages"></div>
    </section>
  </div>

  <section class="card stack">
    <h2>Time since last activity</h2>
    <p class="sub">Last commit where there is one, newest file otherwise</p>
    <div id="chart-activity"></div>
  </section>

  <section class="card table-card">
    <h2>All projects</h2>
    <p class="sub">Every value in the charts above, in full. Choose a column heading to sort.</p>
    <table>
      <thead>
        <tr>
${TABLE_COLUMNS.map(
  (column) => `          <th data-key="${column.key}"${column.align === 'num' ? ' class="num"' : ''}${
    column.key === 'bytes' ? ' aria-sort="descending"' : ''
  }><button type="button">${column.label}<span class="arrow">${
    column.key === 'bytes' ? ' ↓' : ''
  }</span></button></th>`,
).join('\n')}
        </tr>
      </thead>
      <tbody id="table-body">
${result.projects.map((project) => staticRow(project, result.generatedAt)).join('\n')}
      </tbody>
    </table>
  </section>

  <footer>
    <p>Sizes count files on disk, skipping dependency, build and VCS directories
    (<code>node_modules</code>, <code>.git</code>, <code>dist</code>, and the like).
    Language shares count only recognised source extensions.
    A leading <code>~</code> on a date means it came from file timestamps rather than a commit.</p>
  </footer>
</div>

<div class="tooltip" id="tooltip" role="status" aria-live="polite"></div>

<script>window.ORCHARD = ${embedJSON(payload)};</script>
<script>
${CLIENT}
</script>
</body>
</html>
`
}

function staticRow(project, now) {
  const branch = !project.git
    ? '<span class="soft">—</span>'
    : !project.git.isRepo
      ? `<span class="soft">${project.git.nestedIn ? 'nested' : 'no repo'}</span>`
      : `<span class="mono">${escapeHtml(project.git.branch ?? '—')}</span>`

  const status = project.flags.length === 0 ? 'clean' : project.flags.map((flag) => flag.label).join(', ')

  const activity = project.lastActivity ? formatRelative(project.lastActivity, now) : 'unknown'

  return `        <tr>
          <td class="name">${escapeHtml(project.name)}</td>
          <td>${escapeHtml(project.primary ?? '—')}</td>
          <td class="num">${formatBytes(project.bytes)}</td>
          <td class="num">${formatCount(project.files)}</td>
          <td>${branch}</td>
          <td><span class="status" data-severity="${project.severity ?? 'clean'}"><span class="dot"></span><span>${escapeHtml(status)}</span></span></td>
          <td>${project.activitySource === 'mtime' ? '~' : ''}${escapeHtml(activity)}</td>
        </tr>`
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Serialise for inclusion in a `<script>` body. `<` is escaped so a project
 * named `</script>` cannot close the element, and the two Unicode line
 * separators are escaped because a JS parser reads them as literal newlines.
 */
function embedJSON(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
