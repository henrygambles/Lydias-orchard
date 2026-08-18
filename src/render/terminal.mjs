import {
  formatBytes,
  formatCount,
  formatRelative,
  layoutTable,
  textBar,
  truncate,
} from '../format.mjs'
import { ACTIVITY_BANDS, topLanguages } from '../survey.mjs'

const CSI = '\u001b['

const CODES = {
  reset: 0,
  bold: 1,
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  cyan: 36,
}

/** Build a palette that either wraps text in SGR codes or leaves it alone. */
export function makeStyle(enabled) {
  const style = {}
  for (const [name, code] of Object.entries(CODES)) {
    style[name] = enabled ? (text) => `${CSI}${code}m${text}${CSI}0m` : (text) => String(text)
  }
  return style
}

const SEVERITY_COLOR = { critical: 'red', serious: 'yellow', warning: 'yellow' }

/**
 * Render a survey as a terminal report.
 *
 * @param {object} result       a `survey()` result
 * @param {object} [options]
 * @param {boolean} [options.color]
 * @param {number} [options.width]   terminal width, for truncating names
 * @param {object[]} [options.projects]  sorted/limited projects to table (defaults to all)
 */
export function renderTerminal(result, options = {}) {
  const s = makeStyle(options.color !== false)
  const width = options.width ?? 100
  const projects = options.projects ?? result.projects
  const { totals } = result

  const out = []
  out.push(`${s.bold('orchard')}  ${s.dim(result.root)}`)
  out.push(
    s.dim(
      [
        `${formatCount(totals.projects)} projects`,
        formatBytes(totals.bytes),
        `${formatCount(totals.files)} files`,
        `${totals.languages} languages`,
        result.gitInspected ? `${totals.repos} repos` : 'git skipped',
      ].join(' · '),
    ),
  )
  out.push('')

  if (projects.length > 0) {
    out.push(projectTable(projects, s, width, result.gitInspected, result.generatedAt))
    if (projects.length < result.projects.length) {
      out.push(s.dim(`  … ${result.projects.length - projects.length} more`))
    }
    out.push('')
  }

  const languages = topLanguages(totals.byLanguage, 8)
  if (languages.length > 0) {
    out.push(s.bold('Languages'), block(languageRows(languages, s)), '')
  }

  out.push(s.bold('Activity'), block(activityRows(totals, s)), '')

  if (result.gitInspected) out.push(attentionLine(result, s))
  if (totals.truncated > 0) {
    out.push(s.dim(`  ${totals.truncated} project(s) hit the file-count ceiling; sizes are floors.`))
  }

  return out.join('\n')
}

function projectTable(projects, s, width, gitInspected, now) {
  // Give the name column whatever the fixed columns leave, within reason.
  const nameWidth = Math.max(14, Math.min(32, width - 66))

  const columns = [
    { header: 'PROJECT', align: 'left' },
    { header: 'LANGUAGE', align: 'left' },
    { header: 'SIZE', align: 'right' },
    { header: 'FILES', align: 'right' },
    { header: 'BRANCH', align: 'left' },
    { header: 'STATUS', align: 'left' },
    { header: 'LAST ACTIVITY', align: 'left' },
  ]

  const rows = projects.map((project) => [
    truncate(project.name, nameWidth),
    project.primary ? s.cyan(project.primary) : s.dim('—'),
    formatBytes(project.bytes),
    formatCount(project.files),
    branchCell(project, s, gitInspected),
    statusCell(project, s, gitInspected),
    activityCell(project, s, now),
  ])

  const table = layoutTable(columns, rows)
  return [s.dim(table.header), ...table.rows].join('\n')
}

function branchCell(project, s, gitInspected) {
  if (!gitInspected) return s.dim('—')
  if (!project.git?.isRepo) return s.dim(project.git?.nestedIn ? 'nested' : 'no repo')
  return project.git.branch ?? s.dim('—')
}

function statusCell(project, s, gitInspected) {
  if (!gitInspected) return s.dim('—')
  const [first, ...rest] = project.flags
  if (!first) return s.green('clean')
  const colour = s[SEVERITY_COLOR[first.severity]] ?? s.yellow
  return colour(first.label) + (rest.length > 0 ? s.dim(` +${rest.length}`) : '')
}

/** A leading `~` marks an mtime-derived date, which is softer evidence than a commit. */
function activityCell(project, s, now) {
  if (!project.lastActivity) return s.dim('unknown')
  const text = formatRelative(project.lastActivity, now)
  return project.activitySource === 'mtime' ? s.dim(`~${text}`) : text
}

function languageRows(languages, s) {
  const max = Math.max(...languages.map(([, bytes]) => bytes))
  const codeBytes = languages.reduce((sum, [, bytes]) => sum + bytes, 0)
  return languages.map(([language, bytes]) => [
    language,
    s.blue(textBar(bytes / max, 24)),
    formatBytes(bytes),
    `${percent(bytes, codeBytes)}%`,
  ])
}

function activityRows(totals, s) {
  const max = Math.max(1, ...ACTIVITY_BANDS.map((band) => totals.bands.get(band.key) ?? 0))
  return ACTIVITY_BANDS.map((band) => {
    const count = totals.bands.get(band.key) ?? 0
    return [
      band.label,
      count === 0 ? s.dim(textBar(0, 24)) : s.blue(textBar(count / max, 24)),
      formatCount(count),
      '',
    ]
  })
}

function attentionLine(result, s) {
  const { totals } = result
  if (totals.needsAttention === 0) return s.green('Every project is clean.')

  const detail = [...totals.flagCounts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, count]) => `${count} ${FLAG_NOUNS[key] ?? key}`)
    .join(' · ')

  return `${s.yellow(`${totals.needsAttention} of ${totals.projects} projects need attention`)}  ${s.dim(detail)}`
}

const FLAG_NOUNS = {
  dirty: 'with uncommitted changes',
  untracked: 'with untracked files',
  ahead: 'with unpushed commits',
  behind: 'behind upstream',
  'no-remote': 'without a remote',
  'no-upstream': 'without an upstream',
  'no-repo': 'not under git',
  'no-commits': 'without commits',
  nested: 'nested in another repo',
  stashed: 'with stashes',
}

function percent(part, whole) {
  if (!whole) return '0'
  const value = (part / whole) * 100
  return value < 1 ? value.toFixed(1) : Math.round(value).toString()
}

function block(rows) {
  const table = layoutTable(
    [
      { header: '', align: 'left' },
      { header: '', align: 'left' },
      { header: '', align: 'right' },
      { header: '', align: 'right' },
    ],
    rows,
  )
  return table.rows.map((row) => `  ${row}`).join('\n')
}
