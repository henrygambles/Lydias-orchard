/* Orchard report — client rendering.
 *
 * Everything below the filter row is derived from the filtered project list, so
 * the tiles, the three charts and the table can never disagree with each other.
 * Project names come from the filesystem, so every string reaches the DOM as a
 * text node — never as concatenated HTML.
 */
;(function () {
  'use strict'

  var DATA = window.ORCHARD
  var NOW = new Date(DATA.generatedAt)

  /* ---------- formatting ---------- */

  var UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

  function formatBytes(bytes) {
    if (!isFinite(bytes) || bytes < 0) return '-'
    var n = bytes
    var unit = 0
    while (n >= 1024 && unit < UNITS.length - 1) {
      n /= 1024
      unit += 1
    }
    var digits = unit === 0 ? 0 : n < 10 ? 1 : 0
    return n.toFixed(digits).replace(/\.0$/, '') + ' ' + UNITS[unit]
  }

  function formatCount(n) {
    return n.toLocaleString('en-US')
  }

  function formatRelative(iso) {
    if (!iso) return 'unknown'
    var ms = NOW.getTime() - new Date(iso).getTime()
    var minutes = Math.floor(ms / 60000)
    if (minutes < 1) return 'just now'
    if (minutes < 60) return plural(minutes, 'minute')
    var hours = Math.floor(minutes / 60)
    if (hours < 24) return plural(hours, 'hour')
    var days = Math.floor(hours / 24)
    if (days < 31) return plural(days, 'day')
    if (days < 365) return plural(Math.floor(days / 30.44), 'month')
    return plural(Math.floor(days / 365.25), 'year')
  }

  function plural(n, unit) {
    return n + ' ' + unit + (n === 1 ? '' : 's') + ' ago'
  }

  function percent(part, whole) {
    if (!whole) return '0%'
    var value = (part / whole) * 100
    return (value < 1 ? value.toFixed(1) : Math.round(value)) + '%'
  }

  function median(values) {
    if (values.length === 0) return null
    var sorted = values.slice().sort(function (a, b) {
      return a - b
    })
    var mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid]
  }

  /* ---------- tiny DOM helpers ---------- */

  function el(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild)
  }

  function $(id) {
    return document.getElementById(id)
  }

  /* ---------- state ---------- */

  var state = {
    search: '',
    language: '',
    attentionOnly: false,
    sort: { key: 'bytes', direction: 'desc' },
  }

  function filtered() {
    var needle = state.search.trim().toLowerCase()
    return DATA.projects.filter(function (project) {
      if (needle && project.name.toLowerCase().indexOf(needle) === -1) return false
      if (state.language && project.primaryLanguage !== state.language) return false
      if (state.attentionOnly && !project.severity) return false
      return true
    })
  }

  /* ---------- tooltip ---------- */

  var tooltip = $('tooltip')

  function showTooltip(anchor, value, label, note) {
    clear(tooltip)
    tooltip.appendChild(el('div', 'tip-value', value))

    var labelRow = el('div', 'tip-label')
    labelRow.appendChild(el('span', 'key'))
    labelRow.appendChild(el('span', null, label))
    tooltip.appendChild(labelRow)

    if (note) tooltip.appendChild(el('div', 'tip-note', note))

    tooltip.dataset.open = 'true'
    position(anchor)
  }

  function position(anchor) {
    var box = tooltip.getBoundingClientRect()
    var x, y
    if (anchor.clientX !== undefined) {
      x = anchor.clientX + 14
      y = anchor.clientY + 16
    } else {
      var rect = anchor.getBoundingClientRect()
      x = rect.left + 24
      y = rect.bottom + 8
    }
    x = Math.min(x, window.innerWidth - box.width - 12)
    y = Math.min(y, window.innerHeight - box.height - 12)
    tooltip.style.left = Math.max(12, x) + 'px'
    tooltip.style.top = Math.max(12, y) + 'px'
  }

  function hideTooltip() {
    tooltip.dataset.open = 'false'
  }

  /* ---------- bar charts ---------- */

  /**
   * rows: [{ label, fraction, value, note, color }]
   * The value label sits at the bar's tip; space for the longest one is reserved
   * out of the track first, so a bar can never grow under its own label.
   */
  function renderBars(container, rows, emptyMessage) {
    clear(container)

    if (rows.length === 0) {
      container.appendChild(el('p', 'empty', emptyMessage))
      return
    }

    // Reserve the tip label's width out of the track before any bar is drawn,
    // so the longest label always has room and no bar grows under its own value.
    // Every row reserves the same amount, so bar lengths stay proportional.
    var widest = rows.reduce(function (max, row) {
      return Math.max(max, labelText(row).length)
    }, 0)
    var reserve = Math.ceil(widest * 7.2) + 20

    var list = el('ul', 'bars')
    rows.forEach(function (row) {
      var item = el('li', 'bar-row')
      item.tabIndex = 0

      var label = el('div', 'bar-label', row.label)
      label.title = row.label
      item.appendChild(label)

      var track = el('div', 'track')
      var bar = el('div', 'bar')
      bar.style.width = 'calc((100% - ' + reserve + 'px) * ' + row.fraction.toFixed(4) + ')'
      if (row.color) bar.style.background = row.color
      track.appendChild(bar)

      var value = el('span', 'bar-value', row.value)
      if (row.note) {
        value.appendChild(document.createTextNode(' '))
        value.appendChild(el('span', 'bar-note', row.note))
      }
      track.appendChild(value)
      item.appendChild(track)

      var text = labelText(row)
      item.setAttribute('aria-label', row.label + ': ' + text)

      var open = function (event) {
        showTooltip(event.type === 'focus' ? item : event, text, row.label, row.tip)
      }
      item.addEventListener('pointerenter', open)
      item.addEventListener('pointermove', open)
      item.addEventListener('focus', open)
      item.addEventListener('pointerleave', hideTooltip)
      item.addEventListener('blur', hideTooltip)

      list.appendChild(item)
    })

    container.appendChild(list)
  }

  function labelText(row) {
    return row.value + (row.note ? ' ' + row.note : '')
  }

  /* ---------- sections ---------- */

  function renderTiles(projects) {
    var bytes = sum(projects, 'bytes')
    var files = sum(projects, 'files')
    var repos = projects.filter(function (p) {
      return p.git && p.git.isRepo
    }).length
    var attention = projects.filter(function (p) {
      return p.severity
    })

    var languages = aggregateLanguages(projects)
    var top = languages[0]
    var languageBytes = languages.reduce(function (total, entry) {
      return total + entry[1]
    }, 0)

    var idle = median(
      projects
        .map(function (p) {
          return p.idleDays
        })
        .filter(function (d) {
          return d !== null && d !== undefined
        }),
    )

    var worst = attention.reduce(function (rank, p) {
      var order = { critical: 3, serious: 2, warning: 1 }
      return (order[p.severity] || 0) > (order[rank] || 0) ? p.severity : rank
    }, null)

    var container = $('tiles')
    clear(container)

    container.appendChild(tile('Projects', formatCount(projects.length), repos + ' under git'))
    container.appendChild(tile('On disk', formatBytes(bytes), formatCount(files) + ' files'))
    container.appendChild(
      tile(
        'Languages',
        formatCount(languages.length),
        top ? top[0] + ' leads at ' + percent(top[1], languageBytes) : 'none detected',
      ),
    )
    container.appendChild(
      tile(
        'Need attention',
        formatCount(attention.length),
        attentionDetail(attention),
        attention.length > 0 ? worst : 'clean',
      ),
    )
    container.appendChild(
      tile(
        'Median idle',
        idle === null ? '—' : formatCount(idle),
        idle === null ? 'no dated activity' : 'days since last activity',
      ),
    )
  }

  function tile(label, value, detail, severity) {
    var node = el('div', 'tile')
    node.appendChild(el('div', 'label', label))
    node.appendChild(el('div', 'value', value))

    if (severity) {
      var status = el('div', 'status detail')
      status.dataset.severity = severity
      status.appendChild(el('span', 'dot'))
      status.appendChild(el('span', null, detail))
      node.appendChild(status)
    } else {
      node.appendChild(el('div', 'detail', detail))
    }
    return node
  }

  function attentionDetail(attention) {
    if (attention.length === 0) return 'everything is clean'
    var counts = {}
    attention.forEach(function (project) {
      project.flags.forEach(function (flag) {
        counts[flag.key] = (counts[flag.key] || 0) + 1
      })
    })
    var top = Object.keys(counts)
      .sort(function (a, b) {
        return counts[b] - counts[a]
      })
      .slice(0, 2)
      .map(function (key) {
        return counts[key] + ' ' + (DATA.flagNouns[key] || key)
      })
    return top.join(', ')
  }

  function renderLargest(projects) {
    var top = projects
      .slice()
      .sort(function (a, b) {
        return b.bytes - a.bytes || a.name.localeCompare(b.name)
      })
      .slice(0, 12)
    var max = top.length > 0 ? top[0].bytes : 0

    renderBars(
      $('chart-largest'),
      top.map(function (project) {
        return {
          label: project.name,
          fraction: max > 0 ? project.bytes / max : 0,
          value: formatBytes(project.bytes),
          tip:
            formatCount(project.files) +
            ' files · ' +
            (project.primaryLanguage || 'no detected language') +
            ' · ' +
            formatRelative(project.lastActivity),
        }
      }),
      'No projects match these filters.',
    )

    $('largest-sub').textContent =
      top.length < projects.length
        ? 'Top ' + top.length + ' of ' + projects.length + ', excluding dependency and build directories'
        : 'Excluding dependency and build directories'
  }

  function renderLanguages(projects) {
    var languages = aggregateLanguages(projects)
    var total = languages.reduce(function (sumBytes, entry) {
      return sumBytes + entry[1]
    }, 0)

    // Past eight slots the tail folds into one bucket rather than growing hues.
    var head = languages.slice(0, 8)
    var tail = languages.slice(8)
    if (tail.length > 0) {
      head.push([
        'Other (' + tail.length + ')',
        tail.reduce(function (sumBytes, entry) {
          return sumBytes + entry[1]
        }, 0),
      ])
    }

    var max = head.length > 0 ? head[0][1] : 0

    renderBars(
      $('chart-languages'),
      head.map(function (entry) {
        return {
          label: entry[0],
          fraction: max > 0 ? entry[1] / max : 0,
          value: formatBytes(entry[1]),
          note: percent(entry[1], total),
          tip: percent(entry[1], total) + ' of all recognised source',
        }
      }),
      'No recognised source files.',
    )
  }

  function renderActivity(projects) {
    var bands = DATA.bands.map(function (band) {
      return { band: band, count: 0 }
    })

    projects.forEach(function (project) {
      var days = project.idleDays
      var index = bands.length - 1
      for (var i = 0; i < bands.length; i += 1) {
        var max = bands[i].band.maxDays
        if (days !== null && days !== undefined && (max === null || days <= max)) {
          index = i
          break
        }
      }
      bands[index].count += 1
    })

    var max = bands.reduce(function (best, entry) {
      return Math.max(best, entry.count)
    }, 0)

    renderBars(
      $('chart-activity'),
      bands.map(function (entry, index) {
        return {
          label: entry.band.label,
          fraction: max > 0 ? entry.count / max : 0,
          value: formatCount(entry.count),
          note: percent(entry.count, projects.length),
          color: 'var(--ord-' + (index + 1) + ')',
          tip: entry.count === 1 ? '1 project' : entry.count + ' projects',
        }
      }),
      'No projects match these filters.',
    )
  }

  var COLUMNS = {
    name: function (p) {
      return p.name.toLowerCase()
    },
    language: function (p) {
      return (p.primaryLanguage || '~').toLowerCase()
    },
    bytes: function (p) {
      return p.bytes
    },
    files: function (p) {
      return p.files
    },
    branch: function (p) {
      return ((p.git && p.git.branch) || '~').toLowerCase()
    },
    status: function (p) {
      return { critical: 3, serious: 2, warning: 1 }[p.severity] || 0
    },
    idleDays: function (p) {
      return p.idleDays === null || p.idleDays === undefined ? Infinity : p.idleDays
    },
  }

  function renderTable(projects) {
    var read = COLUMNS[state.sort.key] || COLUMNS.bytes
    var direction = state.sort.direction === 'asc' ? 1 : -1

    var sorted = projects.slice().sort(function (a, b) {
      var left = read(a)
      var right = read(b)
      if (left < right) return -1 * direction
      if (left > right) return 1 * direction
      return a.name.localeCompare(b.name)
    })

    var body = $('table-body')
    clear(body)

    sorted.forEach(function (project) {
      var row = document.createElement('tr')

      row.appendChild(cell('name', project.name, project.path))
      row.appendChild(cell(null, project.primaryLanguage || '—'))
      row.appendChild(cell('num', formatBytes(project.bytes)))
      row.appendChild(cell('num', formatCount(project.files)))
      row.appendChild(branchCell(project))
      row.appendChild(statusCell(project))
      row.appendChild(activityCell(project))

      body.appendChild(row)
    })

    document.querySelectorAll('th[data-key]').forEach(function (header) {
      var active = header.dataset.key === state.sort.key
      if (active) header.setAttribute('aria-sort', state.sort.direction === 'asc' ? 'ascending' : 'descending')
      else header.removeAttribute('aria-sort')

      var arrow = header.querySelector('.arrow')
      if (arrow) arrow.textContent = active ? (state.sort.direction === 'asc' ? ' ↑' : ' ↓') : ''
    })
  }

  function cell(className, text, title) {
    var node = el('td', className, text)
    if (title) node.title = title
    return node
  }

  function branchCell(project) {
    var node = el('td')
    if (!project.git) {
      node.appendChild(el('span', 'soft', '—'))
    } else if (!project.git.isRepo) {
      node.appendChild(el('span', 'soft', project.git.nestedIn ? 'nested' : 'no repo'))
    } else {
      node.appendChild(el('span', 'mono', project.git.branch || '—'))
      if (project.git.upstream) node.title = 'tracking ' + project.git.upstream
    }
    return node
  }

  function statusCell(project) {
    var node = el('td')
    var status = el('span', 'status')
    status.dataset.severity = project.severity || 'clean'
    status.appendChild(el('span', 'dot'))
    status.appendChild(
      el(
        'span',
        null,
        project.flags.length === 0
          ? 'clean'
          : project.flags
              .map(function (flag) {
                return flag.label
              })
              .join(', '),
      ),
    )
    node.appendChild(status)
    return node
  }

  function activityCell(project) {
    var node = el('td')
    var text = formatRelative(project.lastActivity)
    // A leading tilde marks a date inferred from file mtimes rather than a commit.
    node.appendChild(el('span', null, project.activitySource === 'mtime' ? '~' + text : text))
    if (project.git && project.git.lastCommit && project.git.lastCommit.subject) {
      node.title = project.git.lastCommit.hash + '  ' + project.git.lastCommit.subject
    }
    return node
  }

  /* ---------- plumbing ---------- */

  function sum(projects, key) {
    return projects.reduce(function (total, project) {
      return total + project[key]
    }, 0)
  }

  function aggregateLanguages(projects) {
    var totals = {}
    projects.forEach(function (project) {
      Object.keys(project.byLanguage).forEach(function (language) {
        totals[language] = (totals[language] || 0) + project.byLanguage[language]
      })
    })
    return Object.keys(totals)
      .map(function (language) {
        return [language, totals[language]]
      })
      .sort(function (a, b) {
        return b[1] - a[1] || a[0].localeCompare(b[0])
      })
  }

  function render() {
    var projects = filtered()
    hideTooltip()
    renderTiles(projects)
    renderLargest(projects)
    renderLanguages(projects)
    renderActivity(projects)
    renderTable(projects)

    $('result-count').textContent =
      projects.length === DATA.projects.length
        ? DATA.projects.length + ' projects'
        : projects.length + ' of ' + DATA.projects.length + ' projects'
  }

  function populateLanguageFilter() {
    var select = $('filter-language')
    aggregateLanguages(DATA.projects).forEach(function (entry) {
      var count = DATA.projects.filter(function (project) {
        return project.primaryLanguage === entry[0]
      }).length
      if (count === 0) return
      var option = el('option', null, entry[0] + ' (' + count + ')')
      option.value = entry[0]
      select.appendChild(option)
    })
  }

  function wireFilters() {
    $('filter-search').addEventListener('input', function (event) {
      state.search = event.target.value
      render()
    })
    $('filter-language').addEventListener('change', function (event) {
      state.language = event.target.value
      render()
    })
    $('filter-attention').addEventListener('change', function (event) {
      state.attentionOnly = event.target.checked
      render()
    })
    document.querySelectorAll('th[data-key] button').forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.parentElement.dataset.key
        if (state.sort.key === key) {
          state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc'
        } else {
          state.sort.key = key
          // Names read naturally A→Z; every measure reads largest-first.
          state.sort.direction = key === 'name' || key === 'language' || key === 'branch' ? 'asc' : 'desc'
        }
        render()
      })
    })
    window.addEventListener('scroll', hideTooltip, { passive: true })
  }

  /* ---------- theme ---------- */

  var THEMES = ['system', 'light', 'dark']
  var LABELS = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' }

  function applyTheme(theme) {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    $('theme-toggle').textContent = LABELS[theme]
    try {
      window.localStorage.setItem('orchard-theme', theme)
    } catch (error) {
      /* private mode: the toggle still works for this page view */
    }
  }

  function wireTheme() {
    var stored
    try {
      stored = window.localStorage.getItem('orchard-theme')
    } catch (error) {
      stored = null
    }
    var current = THEMES.indexOf(stored) === -1 ? 'system' : stored
    applyTheme(current)

    $('theme-toggle').addEventListener('click', function () {
      current = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]
      applyTheme(current)
    })
  }

  populateLanguageFilter()
  wireFilters()
  wireTheme()
  render()
})()
