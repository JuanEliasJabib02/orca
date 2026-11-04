// Why: older hosts answer git.lineBlame and git.fileBlame with method_not_found,
// so clients must hide authorship for remote runtimes unless advertised.
//
// Why one capability for both methods: they are registered together and
// unconditionally, so no host can ever answer one and not the other — two names
// could never disagree, and gating them separately made a client probe twice.
// That is not free: a negative capability answer clears its own cache entry to
// force a re-probe, so against an older host each resting cursor line would burn
// two `status.get` round trips instead of one, indefinitely.
export const GIT_BLAME_RUNTIME_CAPABILITY = 'git.blame.v1' as const

export const GIT_BLAME_RUNTIME_CAPABILITIES = [GIT_BLAME_RUNTIME_CAPABILITY] as const
