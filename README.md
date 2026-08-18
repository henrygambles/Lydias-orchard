# orchard

Survey a directory of projects: languages, size, git health, staleness.

Point it at the folder where all your repos live and get back one report —
what's in there, how big it is, which projects have uncommitted changes or
unpushed commits, and what hasn't been touched in a year.

```
$ orchard ~/Code --sort attention

  orchard  42 projects · 6.1 GB · 18 repos · updated moments ago

  NAME                LANG        SIZE     ACTIVITY        FLAGS
  legacy-api           Python      412 MB   14 months ago   ⚠ dirty, unpushed
  scratch-worker       Go          38 MB    7 months ago    ⚠ unpushed
  orchard              JavaScript  1 MB     moments ago
  ...
```

## Install

```
npx @lydia/orchard ~/Code
```

or install it globally:

```
npm install -g @lydia/orchard
```

## Usage

```
orchard [directory] [options]

Options
  -s, --sort <key>     size | files | name | activity | language | attention  (default: size)
  -r, --reverse         Reverse the sort
  -n, --top <n>         Only list the first N projects (totals still cover all)
  -H, --html <file>     Write an HTML report
  -j, --json             Print JSON to stdout
      --open             Open the HTML report when it is written
      --no-git           Skip git inspection (faster)
      --no-color         Disable colour
  -q, --quiet            No progress output
  -h, --help             Show this message
  -v, --version          Show the version
```

## Examples

```
orchard ~/Code
orchard ~/Code --sort attention
orchard ~/Code --html report.html --open
orchard ~/Code --json | jq '.projects[] | select(.severity == "critical")'
```

## What it looks at

For each top-level directory under the root, orchard reports:

- **Size** — bytes and file count, broken down by language
- **Git health** — dirty working tree, unpushed commits, missing remote, and
  other flags, each with a severity (`warning` / `serious` / `critical`)
- **Staleness** — days since the last commit (falling back to file mtime for
  non-git directories), bucketed into activity bands from "past week" to
  "over a year"

Sort by `attention` to put the projects most in need of a look at the top.

## Output formats

- **Terminal** (default) — a colour table, sized to your terminal width
- **HTML** (`--html`) — a self-contained report you can open or share
- **JSON** (`--json`) — for scripting, `jq`, or feeding into other tools

## Development

```
npm test
```

## License

MIT
