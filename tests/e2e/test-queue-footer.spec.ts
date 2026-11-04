// Two tasks of one space ask for a test turn from their terminals: the footer flask counts both,
// its popover shows who tests and who waits, and Release turn on a holder idle for 10+ min hands
// the turn to the next task. The project has no Spotlight, so each turn only holds a test slot.
import type { Page } from '@stablyai/playwright-test'
import type {
  SpotlightAgentOnResult,
  SpotlightAgentStatus
} from '../../src/shared/spotlight-agent-turn'
import { orcaCliResult, runCompiledOrcaCli } from './helpers/compiled-orca-cli'
import { expect, test } from './helpers/orca-app'
import { addRepoWithWorkspaces } from './helpers/repo-with-workspaces'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  switchToWorktree,
  waitForSessionReady
} from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'

// addRepoWithWorkspaces names its branches `workspace-<n>`, and a branch name is a task.
const FIRST_TASK = 'workspace-0'
const SECOND_TASK = 'workspace-1'

/** What Orca sets in a terminal; `orca spotlight` reads its pane and workspace from it. */
type TerminalEnv = { ORCA_PANE_KEY: string; ORCA_WORKTREE_ID: string }

async function openTerminalIn(page: Page, worktreeId: string): Promise<TerminalEnv> {
  await switchToWorktree(page, worktreeId)
  await expect.poll(() => getActiveWorktreeId(page)).toBe(worktreeId)
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page)
  const pane = await waitForActivePaneHookDescriptor(page)
  return { ORCA_PANE_KEY: pane.paneKey, ORCA_WORKTREE_ID: pane.worktreeId }
}

/** Where the terminal's pane stands in the queue, as main reports it. */
async function standingOf(
  userDataDir: string,
  terminal: TerminalEnv
): Promise<SpotlightAgentStatus['mine']> {
  const status = await orcaCliResult<SpotlightAgentStatus>(
    userDataDir,
    ['spotlight', 'status'],
    undefined,
    terminal
  )
  return status.mine
}

/**
 * Hides and shows the page, as when the user comes back to Orca. Why: the test window is hidden,
 * so the popover's minute ticker never runs; a reveal makes it read the clock once, right away.
 */
async function returnToWindow(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
      document.dispatchEvent(new Event('visibilitychange'))
    }
  })
}

test('the footer test queue counts, lists and hands on the turn', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  const repo = await addRepoWithWorkspaces(orcaPage, testInfo, 2)
  const [firstId, secondId] = repo.ids
  const first = await openTerminalIn(orcaPage, firstId)
  const second = await openTerminalIn(orcaPage, secondId)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))

  // Why 5 s: a slot-only turn is granted at once, so a wait fails here instead of after 100 s.
  const held = await orcaCliResult<SpotlightAgentOnResult>(
    userDataDir,
    ['spotlight', 'on', '--timeout-ms', '5000'],
    undefined,
    first
  )
  expect(held).toMatchObject({
    status: 'on',
    taskKey: FIRST_TASK,
    servers: [],
    ready: true,
    note: expect.any(String)
  })

  // Same space as the holder: it waits although the limit of tasks at once has room.
  const queued = await runCompiledOrcaCli(
    userDataDir,
    ['spotlight', 'on', '--timeout-ms', '1000', '--json'],
    undefined,
    second
  )
  expect(queued.code).toBe(1)
  expect(queued.json?.result).toMatchObject({
    status: 'waiting',
    taskKey: SECOND_TASK,
    position: 1,
    blockers: [{ taskKey: FIRST_TASK, holding: true, reason: 'lane' }]
  })

  const flask = orcaPage.locator('[data-test-queue-trigger]')
  const testing = orcaPage.locator('[data-test-queue-section="testing"] [data-test-queue-row-name]')
  const waiting = orcaPage.locator('[data-test-queue-section="waiting"] [data-test-queue-row-name]')
  const releaseTurn = orcaPage.getByRole('button', { name: 'Release turn' })

  await expect(flask).toHaveText('2')
  await flask.click()
  await expect(testing).toHaveText([FIRST_TASK])
  await expect(waiting).toHaveText([SECOND_TASK])
  // A holder that just got its turn is not stuck: nothing to release yet.
  await expect(releaseTurn).toHaveCount(0)
  await orcaPage.screenshot({ path: testInfo.outputPath('queue-testing-and-waiting.png') })

  // Eleven minutes without a sign from the holder flag its row.
  await orcaPage.clock.install()
  await orcaPage.clock.fastForward('11:00')
  await returnToWindow(orcaPage)
  await expect(releaseTurn).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('queue-idle-holder.png') })

  await releaseTurn.click()
  await expect(testing).toHaveText([SECOND_TASK])
  await expect(waiting).toHaveCount(0)
  await expect(flask).toHaveText('1')
  await orcaPage.screenshot({ path: testInfo.outputPath('queue-turn-handed-on.png') })
  expect(await standingOf(userDataDir, second)).toEqual({ kind: 'holding', taskKey: SECOND_TASK })
  expect(await standingOf(userDataDir, first)).toEqual({ kind: 'none' })
})
