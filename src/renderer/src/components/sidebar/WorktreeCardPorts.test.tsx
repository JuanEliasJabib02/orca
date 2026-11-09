import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspacePort } from '../../../../shared/workspace-ports'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ recordFeatureInteraction: vi.fn(), settings: null })
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

const port: WorkspacePort = {
  id: '127.0.0.1:58941:1234',
  bindHost: '127.0.0.1',
  connectHost: '127.0.0.1',
  port: 58941,
  pid: 1234,
  processName: 'node',
  protocol: 'http',
  kind: 'workspace',
  owner: {
    worktreeId: 'repo::/workspace/app',
    repoId: 'repo',
    displayName: 'app',
    path: '/workspace/app',
    confidence: 'cwd'
  },
  advertisedUrl: 'http://dev.preview.localhost:58941'
}

describe('WorktreeCardPortsTrigger', () => {
  it('shows the plug icon when no label is given', async () => {
    const { WorktreeCardPortsTrigger } = await import('./workspace-card/details/WorktreeCardPorts')

    const markup = renderToStaticMarkup(<WorktreeCardPortsTrigger ports={[port]} />)

    expect(markup).toContain('aria-label="1 live port"')
    expect(markup).toContain('<svg')
  })

  it('shows the Spotlight port label in place of the plug icon', async () => {
    const { WorktreeCardPortsTrigger } = await import('./workspace-card/details/WorktreeCardPorts')

    const markup = renderToStaticMarkup(
      <WorktreeCardPortsTrigger ports={[port]} label=":8080 +1" />
    )

    expect(markup).toContain(':8080 +1</button>')
    expect(markup).toContain('aria-label="1 live port :8080 +1"')
    expect(markup).not.toContain('<svg')
  })

  it('renders nothing without ports', async () => {
    const { WorktreeCardPortsTrigger } = await import('./workspace-card/details/WorktreeCardPorts')

    expect(renderToStaticMarkup(<WorktreeCardPortsTrigger ports={[]} label=":8080" />)).toBe('')
  })
})
