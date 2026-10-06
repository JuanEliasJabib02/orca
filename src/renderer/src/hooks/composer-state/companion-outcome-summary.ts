import { translate } from '@/i18n/i18n'
import type { CompanionWorktreeOutcome } from './multi-repo-worktree-creation'

export type CompanionOutcomeSummary = {
  kind: 'error' | 'warning'
  title: string
  description: string
}

type CreatedCompanionOutcome = Extract<CompanionWorktreeOutcome, { status: 'created' }>

function summaryTitle(flags: {
  hasFailures: boolean
  hasOffBranch: boolean
  hasBaseFallback: boolean
}): string {
  if (flags.hasFailures) {
    return translate(
      'auto.hooks.useComposerState.companionCreateFailed',
      'Some companion worktrees were not created'
    )
  }
  if (flags.hasOffBranch) {
    return translate(
      'auto.hooks.useComposerState.companionBranchMismatchTitle',
      'Some companion worktrees are on a different branch'
    )
  }
  if (flags.hasBaseFallback) {
    return translate(
      'auto.hooks.useComposerState.companionBaseFallbackTitle',
      'Some companion worktrees were created from their default base'
    )
  }
  return translate(
    'auto.hooks.useComposerState.companionSetupSkippedTitle',
    'Companion worktrees created without setup'
  )
}

function baseFallbackLine(outcome: CreatedCompanionOutcome): string {
  const params = { name: outcome.repo.displayName, base: outcome.baseFallback?.requested }
  return outcome.baseFallback?.reason === 'unchecked'
    ? translate(
        'auto.hooks.useComposerState.companionBaseUnchecked',
        '{{name}}: could not check {{base}}, created from its default base',
        params
      )
    : translate(
        'auto.hooks.useComposerState.companionBaseMissing',
        '{{name}}: no {{base}}, created from its default base',
        params
      )
}

/**
 * One toast for everything the user should know: failed repos first, then companions off the
 * shared branch, then companions off the shared base, then skipped setups.
 */
export function summarizeCompanionOutcomes(
  outcomes: readonly CompanionWorktreeOutcome[]
): CompanionOutcomeSummary | null {
  const failed = outcomes.flatMap((outcome) => (outcome.status === 'failed' ? [outcome] : []))
  const created = outcomes.flatMap((outcome) => (outcome.status === 'created' ? [outcome] : []))
  const offBranch = created.filter((outcome) => outcome.expectedBranch)
  const baseFallback = created.filter((outcome) => outcome.baseFallback)
  const setupSkipped = created.filter((outcome) => outcome.setupNeedsUserDecision)
  if (
    failed.length === 0 &&
    offBranch.length === 0 &&
    baseFallback.length === 0 &&
    setupSkipped.length === 0
  ) {
    return null
  }
  const lines = failed.map((outcome) => `${outcome.repo.displayName}: ${outcome.error}`)
  for (const outcome of offBranch) {
    lines.push(
      translate(
        'auto.hooks.useComposerState.companionBranchMismatch',
        '{{name}} is on {{branch}} instead of {{expected}}',
        { name: outcome.repo.displayName, branch: outcome.branch, expected: outcome.expectedBranch }
      )
    )
  }
  lines.push(...baseFallback.map(baseFallbackLine))
  if (setupSkipped.length > 0) {
    lines.push(
      translate(
        'auto.hooks.useComposerState.companionSetupSkipped',
        'Setup did not run in {{names}}: it needs a setup decision or script approval.',
        { names: setupSkipped.map((outcome) => outcome.repo.displayName).join(', ') }
      )
    )
  }
  return {
    kind: failed.length > 0 ? 'error' : 'warning',
    title: summaryTitle({
      hasFailures: failed.length > 0,
      hasOffBranch: offBranch.length > 0,
      hasBaseFallback: baseFallback.length > 0
    }),
    description: lines.join('\n')
  }
}
