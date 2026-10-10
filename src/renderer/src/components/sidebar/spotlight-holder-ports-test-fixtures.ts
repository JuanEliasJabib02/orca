import type { WorkspacePort, WorkspacePortScanResult } from '../../../../shared/workspace-ports'

/** A listener the scanner attributed to `worktreeId`. */
export function makeOwnedPort(
  worktreeId: string,
  port: number,
  host = '127.0.0.1'
): Extract<WorkspacePort, { kind: 'workspace' }> {
  return {
    id: `${host}:${port}:${port}`,
    bindHost: host,
    connectHost: host,
    port,
    pid: port,
    processName: 'node',
    protocol: 'http',
    kind: 'workspace',
    owner: {
      worktreeId,
      repoId: worktreeId.split('::')[0] ?? worktreeId,
      displayName: worktreeId,
      path: `/${worktreeId}`,
      confidence: 'cwd'
    }
  }
}

export function makePortScan(ports: WorkspacePort[]): {
  key: string
  result: WorkspacePortScanResult
} {
  return { key: 'local', result: { platform: 'darwin', scannedAt: 1, ports } }
}
