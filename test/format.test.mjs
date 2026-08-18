import assert from 'node:assert/strict'
import test from 'node:test'

import {
  daysSince,
  displayWidth,
  formatBytes,
  formatCount,
  formatRelative,
  layoutTable,
  padEnd,
  textBar,
  truncate,
} from '../src/format.mjs'

const ESC = String.fromCharCode(27)
const red = (text) => `${ESC}[31m${text}${ESC}[0m`

test('formatBytes scales and drops a trailing .0', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1024), '1 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(10 * 1024), '10 KB')
  assert.equal(formatBytes(1024 ** 3), '1 GB')
  assert.equal(formatBytes(5.2 * 1024 ** 4), '5.2 TB')
})

test('formatBytes refuses nonsense rather than printing NaN', () => {
  assert.equal(formatBytes(-1), '-')
  assert.equal(formatBytes(Number.NaN), '-')
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), '-')
})

test('formatCount groups thousands', () => {
  assert.equal(formatCount(0), '0')
  assert.equal(formatCount(84201), '84,201')
})

test('formatRelative reports whole units and pluralises', () => {
  const now = new Date('2026-08-18T12:00:00Z')
  const ago = (ms) => formatRelative(new Date(now.getTime() - ms), now)

  assert.equal(ago(30_000), 'just now')
  assert.equal(ago(60_000), '1 minute ago')
  assert.equal(ago(5 * 60_000), '5 minutes ago')
  assert.equal(ago(3 * 3600_000), '3 hours ago')
  assert.equal(ago(24 * 3600_000), '1 day ago')
  assert.equal(ago(30 * 24 * 3600_000), '30 days ago')
  assert.equal(ago(60 * 24 * 3600_000), '1 month ago')
  assert.equal(ago(400 * 24 * 3600_000), '1 year ago')
})

test('formatRelative treats a future date as now, not as a negative age', () => {
  const now = new Date('2026-08-18T12:00:00Z')
  assert.equal(formatRelative(new Date(now.getTime() + 7200_000), now), 'just now')
  assert.equal(formatRelative(null, now), 'never')
})

test('daysSince floors at zero', () => {
  const now = new Date('2026-08-18T12:00:00Z')
  assert.equal(daysSince(new Date('2026-08-15T12:00:00Z'), now), 3)
  assert.equal(daysSince(new Date('2026-08-18T11:00:00Z'), now), 0)
  assert.equal(daysSince(new Date('2026-09-01T12:00:00Z'), now), 0)
  assert.equal(daysSince(null, now), null)
})

test('displayWidth ignores colour escapes so columns still line up', () => {
  assert.equal(displayWidth('plain'), 5)
  assert.equal(displayWidth(red('plain')), 5)
  assert.equal(displayWidth(padEnd(red('ab'), 5)), 5)
})

test('layoutTable aligns each column to its widest cell', () => {
  const { header, rows } = layoutTable(
    [
      { header: 'NAME', align: 'left' },
      { header: 'SIZE', align: 'right' },
    ],
    [
      ['a', '1 KB'],
      ['longer-name', '12 MB'],
    ],
  )

  assert.equal(header, 'NAME          SIZE')
  assert.deepEqual(rows, ['a             1 KB', 'longer-name  12 MB'])
})

test('layoutTable measures coloured cells by printable width', () => {
  const { rows } = layoutTable(
    [
      { header: 'A', align: 'left' },
      { header: 'B', align: 'left' },
    ],
    [[red('xx'), 'end']],
  )
  assert.equal(displayWidth(rows[0]), 'xx  end'.length)
})

test('truncate keeps the requested width exactly', () => {
  assert.equal(truncate('short', 10), 'short')
  assert.equal(truncate('a-very-long-name', 8), 'a-very-…')
  assert.equal(truncate('a-very-long-name', 8).length, 8)
  assert.equal(truncate('anything', 0), '')
})

test('textBar fills proportionally and clamps out-of-range input', () => {
  assert.equal(textBar(0, 4), '░░░░')
  assert.equal(textBar(0.5, 4), '██░░')
  assert.equal(textBar(1, 4), '████')
  assert.equal(textBar(2, 4), '████')
  assert.equal(textBar(-1, 4), '░░░░')
})
