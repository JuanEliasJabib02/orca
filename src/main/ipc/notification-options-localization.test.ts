import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NotificationDispatchRequest } from '../../shared/notification-settings-types'
import { UI_LANGUAGE_ENGLISH, UI_LANGUAGE_SPANISH } from '../../shared/ui-language'
import { setMainUiLanguage, translateMain } from '../i18n/main-i18n'
import { buildNotificationOptions } from './notification-options'

vi.mock('electron', () => ({ app: { getLocale: () => 'en-US' } }))

const BELL: NotificationDispatchRequest = {
  source: 'terminal-bell',
  worktreeId: 'wt-1',
  worktreeLabel: 'feature-x',
  repoLabel: 'orca'
}
const TOOL: NotificationDispatchRequest = {
  source: 'agent-task-complete',
  worktreeId: 'wt-1',
  agentType: 'claude',
  agentState: 'working',
  agentToolName: 'Bash',
  agentToolInput: 'ls {{tool}}'
}
const FALLBACK: NotificationDispatchRequest = { source: 'agent-task-complete', worktreeId: 'wt-1' }
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

afterEach(async () => {
  await setMainUiLanguage(UI_LANGUAGE_ENGLISH)
})

describe('buildNotificationOptions localization', () => {
  it('reads the copy from the active catalog', async () => {
    await setMainUiLanguage(UI_LANGUAGE_SPANISH)

    expect(buildNotificationOptions(BELL, translateMain)).toEqual({
      title: 'Campana en feature-x',
      body: 'orca · Se solicita atención'
    })
    expect(buildNotificationOptions(TOOL, translateMain)).toEqual({
      title: 'espacio de trabajo - Claude trabajando',
      body: 'Usando Bash: ls {{tool}}'
    })
    expect(buildNotificationOptions(FALLBACK, translateMain)).toEqual({
      title: 'Tarea completada en espacio de trabajo',
      body: 'Un agente de programación terminó de trabajar.'
    })
  })

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
