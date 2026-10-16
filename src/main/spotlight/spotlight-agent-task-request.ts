import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainEvent } from 'electron'
import type {
  SpotlightAgentLightResult,
  SpotlightAgentTaskReply,
  SpotlightAgentTaskRequest,
  SpotlightAgentTaskResolution
} from '../../shared/spotlight-agent-turn'

const RESOLVE_TIMEOUT_MS = 10_000
// Why long: lighting syncs git per project and queues each server; the renderer finishes regardless.
const LIGHT_TIMEOUT_MS = 120_000

type RequestBody =
  | { op: 'resolve'; worktreeId: string }
  | { op: 'light'; worktreeId: string; repoIds: string[] }

function askRenderer(
  win: BrowserWindow,
  body: RequestBody,
  timeoutMs: number
): Promise<SpotlightAgentTaskReply> {
  if (win.isDestroyed()) {
    return Promise.reject(new Error('The Orca window is closed.'))
  }
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener('spotlight:agentTaskReply', handler)
      reject(new Error('The Orca window did not answer in time.'))
    }, timeoutMs)
    const handler = (event: IpcMainEvent, reply: SpotlightAgentTaskReply): void => {
      if (event.sender !== win.webContents || reply?.requestId !== requestId) {
        return
      }
      clearTimeout(timer)
      ipcMain.removeListener('spotlight:agentTaskReply', handler)
      resolve(reply)
    }
    ipcMain.on('spotlight:agentTaskReply', handler)
    const request: SpotlightAgentTaskRequest = { requestId, ...body }
    win.webContents.send('spotlight:agentTaskRequest', request)
  })
}

/** The task of `worktreeId` and the projects its Spotlight would light. */
export async function resolveAgentTaskInRenderer(
  win: BrowserWindow,
  worktreeId: string
): Promise<SpotlightAgentTaskResolution> {
  const reply = await askRenderer(win, { op: 'resolve', worktreeId }, RESOLVE_TIMEOUT_MS)
  if ('error' in reply) {
    throw new Error(reply.error)
  }
  if (reply.op !== 'resolve') {
    throw new Error('The Orca window answered a different request.')
  }
  return reply.resolution
}

/** Lights the task of `worktreeId` in `repoIds`, like its header button; resolves per project. */
export async function lightAgentTaskInRenderer(
  win: BrowserWindow,
  worktreeId: string,
  repoIds: string[]
): Promise<SpotlightAgentLightResult[]> {
  const reply = await askRenderer(win, { op: 'light', worktreeId, repoIds }, LIGHT_TIMEOUT_MS)
  if ('error' in reply) {
    throw new Error(reply.error)
  }
  if (reply.op !== 'light') {
    throw new Error('The Orca window answered a different request.')
  }
  return reply.results
}
