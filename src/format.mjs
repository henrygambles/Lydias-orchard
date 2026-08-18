// Presentation helpers shared by the terminal and HTML renderers: byte sizes,
// relative dates, and an ANSI-aware column layout.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** Human-readable size, base 1024. 0 -> "0 B", 1536 -> "1.5 KB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  let n = bytes
  let unit = 0
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024
    unit += 1
  }
  // Whole numbers below KB; one decimal once we're scaling, dropped when it's .0
  const digits = unit === 0 ? 0 : n < 10 ? 1 : 0
  return `${n.toFixed(digits).replace(/\.0$/, '')} ${UNITS[unit]}`
}

/** 84201 -> "84,201" */
export function formatCount(n) {
  return n.toLocaleString('en-US')
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Coarse relative time, past only ("3 days ago"). Future timestamps — clock
 * skew, a rebased commit date — report as "just now" rather than "in 2 hours",
 * which would read as a bug in a survey of things that already happened.
 */
export function formatRelative(date, now = new Date()) {
  if (!date) return 'never'
  const ms = now.getTime() - date.getTime()
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'minute')
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour')
  const days = Math.floor(ms / DAY)
  if (days < 31) return plural(days, 'day')
  if (days < 365) return plural(Math.floor(days / 30.44), 'month')
  return plural(Math.floor(days / 365.25), 'year')
}

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}

/** Whole days between then and now, floored at 0. */
export function daysSince(date, now = new Date()) {
  if (!date) return null
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY))
}

const ANSI = /\u001b\[[0-9;]*m/g

/** Printable width of a string, ignoring ANSI colour escapes. */
export function displayWidth(str) {
  return str.replace(ANSI, '').length
}

export function padEnd(str, width) {
  return str + ' '.repeat(Math.max(0, width - displayWidth(str)))
}

export function padStart(str, width) {
  return ' '.repeat(Math.max(0, width - displayWidth(str))) + str
}

/** Truncate to width, ellipsising with a single character so widths stay exact. */
export function truncate(str, width) {
  if (width <= 0) return ''
  return str.length <= width ? str : str.slice(0, width - 1) + '…'
}

/**
 * Lay out rows as aligned columns. `columns` is [{ header, align }]; each row is
 * an array of cells, which may contain ANSI escapes.
 */
export function layoutTable(columns, rows, gap = '  ') {
  const widths = columns.map((col, i) =>
    Math.max(displayWidth(col.header), ...rows.map((r) => displayWidth(r[i] ?? ''))),
  )
  const line = (cells) =>
    cells
      .map((cell, i) =>
        columns[i].align === 'right'
          ? padStart(cell ?? '', widths[i])
          : padEnd(cell ?? '', widths[i]),
      )
      .join(gap)
      .trimEnd()
  return {
    widths,
    header: line(columns.map((c) => c.header)),
    rows: rows.map(line),
  }
}

/** A proportional bar drawn with block characters, for the terminal summary. */
export function textBar(fraction, width) {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}
