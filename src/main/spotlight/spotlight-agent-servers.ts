import path from 'node:path'
import type { Repo } from '../../shared/repo-types'
import type { SpotlightRepoState, SpotlightServerState } from '../../shared/spotlight'
import type {
  SpotlightAgentLightResult,
  SpotlightAgentServer,
  SpotlightAgentTaskMember
} from '../../shared/spotlight-agent-turn'
import type { WorkspacePort, WorkspacePortScanResult } from '../../shared/workspace-ports'

export type SpotlightServerProbe = {
  getRepo: (repoId: string) => Repo | undefined
  getSpotlightState: (repoId: string) => SpotlightRepoState | null
  readServer: (repoId: string) => Promise<SpotlightServerState>
  /** One scan of every project's ports; null when the scan failed. */
  scanPorts: () => Promise<WorkspacePortScanResult | null>
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b)
}

/** Ports the scanner attributes to the project root, where every Spotlight server runs. */
function rootPorts(scan: WorkspacePortScanResult | null, repo: Repo): WorkspacePort[] {
  return (scan?.ports ?? []).filter(
    (port) =>
      port.kind === 'workspace' &&
      port.owner.repoId === repo.id &&
      samePath(port.owner.path, repo.path)
  )
}

function portUrl(port: WorkspacePort): string {
  if (port.kind === 'workspace' && port.advertisedUrl) {
    return port.advertisedUrl
  }
  return `${port.protocol === 'https' ? 'https' : 'http'}://${port.connectHost}:${port.port}`
}

function pickPort(ports: WorkspacePort[], configured: number | undefined): WorkspacePort | null {
  if (configured !== undefined) {
    return ports.find((port) => port.port === configured) ?? null
  }
  return ports.reduce<WorkspacePort | null>(
    (lowest, port) => (lowest === null || port.port < lowest.port ? port : lowest),
    null
  )
}

/** Where each project of a turn stands: lit for the task, its server, its port and its log. */
export async function describeTurnServers(args: {
  repoIds: readonly string[]
  members: readonly SpotlightAgentTaskMember[]
  lightResults: ReadonlyMap<string, SpotlightAgentLightResult>
  probe: SpotlightServerProbe
}): Promise<SpotlightAgentServer[]> {
  const { repoIds, members, lightResults, probe } = args
  const scan = await probe.scanPorts().catch(() => null)
  const servers = await Promise.all(
    repoIds.map(async (repoId): Promise<SpotlightAgentServer | null> => {
      const repo = probe.getRepo(repoId)
      if (!repo) {
        return null
      }
      const member = members.find((entry) => entry.repoId === repoId)
      const holder = probe.getSpotlightState(repoId)?.holderWorktreeId
      const lit = holder !== undefined && (member?.taskWorktreeIds.includes(holder) ?? false)
      const light = lightResults.get(repoId)
      const configured = repo.spotlightServer?.port
      const port = pickPort(rootPorts(scan, repo), configured)
      return {
        repoId,
        repoName: repo.displayName,
        lit,
        ...(light && !light.ok && light.message ? { error: light.message } : {}),
        port: port?.port ?? configured ?? null,
        url: port
          ? portUrl(port)
          : configured !== undefined
            ? `http://localhost:${configured}`
            : null,
        listening: port !== null,
        server: lit ? await probe.readServer(repoId).catch(() => 'unknown' as const) : 'unknown',
        logPath: path.join(repo.path, '.orca', 'spotlight.log')
      }
    })
  )
  return servers.filter((server): server is SpotlightAgentServer => server !== null)
}
