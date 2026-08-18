// Extension -> language. Only extensions listed here count toward language
// composition; everything else still counts toward files/bytes on disk.

const MAP = {
  JavaScript: ['.js', '.mjs', '.cjs', '.jsx'],
  TypeScript: ['.ts', '.mts', '.cts', '.tsx'],
  Python: ['.py', '.pyi'],
  Rust: ['.rs'],
  Go: ['.go'],
  Swift: ['.swift'],
  'C#': ['.cs'],
  'C/C++': ['.c', '.h', '.cc', '.cpp', '.hpp', '.cxx'],
  Java: ['.java'],
  Kotlin: ['.kt', '.kts'],
  Ruby: ['.rb'],
  PHP: ['.php'],
  Shell: ['.sh', '.bash', '.zsh', '.fish'],
  Lua: ['.lua'],
  Elixir: ['.ex', '.exs'],
  Haskell: ['.hs'],
  Zig: ['.zig'],
  SQL: ['.sql'],
  HTML: ['.html', '.htm'],
  CSS: ['.css', '.scss', '.sass', '.less'],
  Svelte: ['.svelte'],
  Vue: ['.vue'],
  Markdown: ['.md', '.mdx'],
  Config: ['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini'],
}

export const EXT_TO_LANGUAGE = Object.freeze(
  Object.fromEntries(
    Object.entries(MAP).flatMap(([lang, exts]) => exts.map((e) => [e, lang])),
  ),
)

export function languageForExtension(ext) {
  return EXT_TO_LANGUAGE[ext.toLowerCase()] ?? null
}

// Languages that describe a project's substance rather than its scaffolding.
// Used to pick a project's "primary" language so a repo of YAML and README
// doesn't get labelled Config.
const SCAFFOLDING = new Set(['Config', 'Markdown'])

export function isScaffolding(language) {
  return SCAFFOLDING.has(language)
}

/**
 * Pick the dominant language of a project. Prefers substantive languages;
 * falls back to scaffolding only when that is genuinely all there is.
 */
export function primaryLanguage(byLanguage) {
  const entries = [...byLanguage.entries()]
  if (entries.length === 0) return null
  const substantive = entries.filter(([lang]) => !isScaffolding(lang))
  const pool = substantive.length > 0 ? substantive : entries
  return pool.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
}
