import { describe, expect, it } from 'vitest'
import { getDefaultUIState } from '../../../shared/constants'
import { normalizeGroupBy } from './ui-selection-normalization'

describe('normalizeGroupBy', () => {
  it.each(['none', 'workspace-status', 'repo', 'pr-status', 'task'] as const)(
    'keeps %s across a restart',
    (groupBy) => {
      expect(normalizeGroupBy(groupBy)).toBe(groupBy)
    }
  )

  it('migrates the legacy flat mode and defaults anything unknown', () => {
    expect(normalizeGroupBy('flat')).toBe('none')
    expect(normalizeGroupBy('kanban')).toBe(getDefaultUIState().groupBy)
    expect(normalizeGroupBy(undefined)).toBe(getDefaultUIState().groupBy)
  })
})
