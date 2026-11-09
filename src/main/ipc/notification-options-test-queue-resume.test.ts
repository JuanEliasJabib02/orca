import { describe, expect, it } from 'vitest'
import type { NotificationDispatchRequest } from '../../shared/notification-settings-types'
import { buildNotificationOptions } from './notification-options'

const AUTO_RESUME_WITHOUT_ACCOUNT: NotificationDispatchRequest = {
  source: 'test-queue-auto-resume',
  worktreeId: 'wt-1',
  worktreeLabel: 'Fix login'
}
const AUTO_RESUME: NotificationDispatchRequest = {
  ...AUTO_RESUME_WITHOUT_ACCOUNT,
  accountLabel: 'personal'
}

/** Echoes the key and the fallback's placeholders, so the case reads no catalog's wording. */
function echoKey(key: string, fallback: string): string {
  return [key, ...(fallback.match(/\{\{\w+\}\}/g) ?? [])].join(' ')
}

// Why a fork-owned file: the test-queue resume notice is an Orca Pro Max feature.
describe('buildNotificationOptions test-queue resume', () => {
  it('fills the task and the account into the keys of an automatic test-queue resume', () => {
    expect(buildNotificationOptions(AUTO_RESUME, echoKey)).toEqual({
      title: 'notifications.testQueueAutoResume.title',
      body: 'notifications.testQueueAutoResume.body Fix login personal'
    })
    expect(buildNotificationOptions(AUTO_RESUME_WITHOUT_ACCOUNT, echoKey)).toEqual({
      title: 'notifications.testQueueAutoResume.title',
      body: 'notifications.testQueueAutoResume.bodyWithoutAccount Fix login'
    })
  })
})
