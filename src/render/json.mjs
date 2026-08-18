import { ACTIVITY_BANDS } from '../survey.mjs'

/**
 * A survey result carries Maps and Dates, which `JSON.stringify` flattens badly
 * (`{}` for a Map). This projects it onto a stable, documented shape instead —
 * the contract other tools consume, so it changes deliberately rather than
 * whenever an internal field is renamed.
 */
export function toJSON(result) {
  return {
    orchard: 1,
    root: result.root,
    generatedAt: result.generatedAt.toISOString(),
    gitInspected: result.gitInspected,
    totals: {
      projects: result.totals.projects,
      repos: result.totals.repos,
      bytes: result.totals.bytes,
      files: result.totals.files,
      languages: result.totals.languages,
      needsAttention: result.totals.needsAttention,
      idleMedianDays: result.totals.idleMedian,
      byLanguage: Object.fromEntries(result.totals.byLanguage),
      activity: ACTIVITY_BANDS.map((band) => ({
        key: band.key,
        label: band.label,
        projects: result.totals.bands.get(band.key) ?? 0,
      })),
      flags: Object.fromEntries(result.totals.flagCounts),
    },
    projects: result.projects.map((project) => ({
      name: project.name,
      path: project.path,
      symlink: project.symlink,
      bytes: project.bytes,
      files: project.files,
      primaryLanguage: project.primary,
      byLanguage: Object.fromEntries(project.byLanguage),
      lastActivity: project.lastActivity?.toISOString() ?? null,
      activitySource: project.activitySource,
      idleDays: project.idleDays,
      severity: project.severity,
      flags: project.flags,
      skipped: project.skipped,
      truncated: project.truncated,
      unreadable: project.unreadable,
      git: project.git
        ? {
            isRepo: project.git.isRepo,
            nestedIn: project.git.nestedIn,
            branch: project.git.branch ?? null,
            upstream: project.git.upstream ?? null,
            ahead: project.git.ahead ?? 0,
            behind: project.git.behind ?? 0,
            changed: project.git.changed ?? 0,
            untracked: project.git.untracked ?? 0,
            remotes: project.git.remotes ?? [],
            stashCount: project.git.stashCount ?? 0,
            lastCommit: project.git.lastCommit
              ? {
                  hash: project.git.lastCommit.hash,
                  date: project.git.lastCommit.date?.toISOString() ?? null,
                  subject: project.git.lastCommit.subject,
                }
              : null,
          }
        : null,
    })),
  }
}
