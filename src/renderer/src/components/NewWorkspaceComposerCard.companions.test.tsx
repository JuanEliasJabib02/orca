// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import type { ProjectHostSetupOption } from '@/lib/project-host-setup-options'
import type { ComposerCompanionRepos } from './new-workspace/use-composer-companion-repos'
import NewWorkspaceComposerCard from './NewWorkspaceComposerCard'

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: unknown) => unknown) =>
      selector({
        closeModal: vi.fn(),
        openModal: vi.fn(),
        activeModal: 'new-workspace-composer',
        settings: { defaultTuiAgent: null, disabledTuiAgents: [] },
        updateSettings: vi.fn(),
        projects: [],
        repos: []
      }),
    { getState: () => ({}) }
  )
}))

const launchAppliesAgentArgs = vi.hoisted(() => vi.fn(() => true))
vi.mock(
  '@/components/right-sidebar/source-control/ai/source-control-launch-agent-args-applicability',
  () => ({
    sourceControlLaunchAppliesAgentArgs: launchAppliesAgentArgs
  })
)

vi.mock('@/components/contextual-tours/use-contextual-tour', () => ({
  useContextualTour: vi.fn()
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@/components/agent/AgentCombobox', () => ({
  default: () => <button type="button">Agent picker</button>
}))

vi.mock('@/components/sidebar/host-admission/ssh/AddRemoteHostDialog', () => ({
  AddRemoteHostDialog: () => null
}))

vi.mock('@/components/new-workspace/SmartWorkspaceNameField', () => ({
  default: () => <input aria-label="workspace name" />
}))

vi.mock('@/components/new-workspace/ProjectCombobox', () => ({
  default: () => <div data-testid="project-combobox" />
}))

// Why inline: upstream dropped the shared card fixture (#40072); this fork suite is its only user.
const projectOptions: NewWorkspaceProjectOption[] = [
  {
    kind: 'project-group',
    id: 'project-group:platform',
    projectGroupId: 'platform',
    displayName: 'Platform',
    badgeColor: 'var(--muted-foreground)',
    detail: '/workspace/platform',
    parentPath: '/workspace/platform',
    connectionId: null
  }
]

const hostOptions: ProjectHostSetupOption[] = [
  {
    kind: 'ready',
    id: 'setup-local',
    projectId: 'project-group:platform',
    hostId: 'local',
    repoId: 'repo-a',
    label: 'Local Mac',
    detail: 'Orca',
    path: '/Users/alice/orca'
  }
]

async function renderCard(
  overrides: Partial<React.ComponentProps<typeof NewWorkspaceComposerCard>> = {}
): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <NewWorkspaceComposerCard
        quickAgent={null}
        onQuickAgentChange={() => {}}
        eligibleRepos={[]}
        repoId="repo-a"
        projectOptions={projectOptions}
        selectedProjectId="project-group:platform"
        selectedRepoIsGit
        onRepoChange={() => {}}
        onProjectChange={() => {}}
        primaryActionLabel="Create workspace"
        name=""
        onNameValueChange={() => {}}
        onSmartGitHubItemSelect={() => {}}
        onSmartGitLabItemSelect={() => {}}
        onSmartBranchSelect={() => {}}
        onSmartLinearIssueSelect={() => {}}
        smartNameSelection={null}
        onClearSmartNameSelection={() => {}}
        canReuseSelectedBranch={false}
        reuseSelectedBranch={false}
        onReuseSelectedBranchChange={() => {}}
        forkPushWarning={null}
        detectedAgentIds={null}
        onOpenAgentSettings={() => {}}
        advancedOpen={false}
        onToggleAdvanced={() => {}}
        parentWorktreeId={null}
        onParentWorktreeIdChange={() => {}}
        createDisabled={false}
        projectError={null}
        creating={false}
        onCreate={() => {}}
        note=""
        onNoteChange={() => {}}
        setupConfig={null}
        requiresExplicitSetupChoice={false}
        setupDecision={null}
        onSetupDecisionChange={() => {}}
        setupAgentStartupPolicy="start-immediately"
        onSetupAgentStartupPolicyChange={() => {}}
        shouldWaitForSetupCheck={false}
        resolvedSetupDecision={null}
        createError={null}
        selectedRepoConnectionId={null}
        selectedRepoSshStatus={null}
        selectedRepoRequiresConnection={false}
        selectedRepoConnectInProgress={false}
        onConnectSelectedRepo={async () => {}}
        canUseSparseCheckout={false}
        sparsePresets={[]}
        sparseSelectedPresetId={null}
        onSparseSelectPreset={() => {}}
        branchNameOverride={undefined}
        onBranchNameOverrideChange={() => {}}
        branchesEnabled={false}
        setupControlsEnabled={false}
        sparseControlsEnabled={false}
        projectHostSetupOptions={hostOptions}
        selectedProjectHostSetupId="setup-local"
        {...overrides}
      />
    )
  })
  // Settle mount-time warm-up before clicking; Vitest serializes overlapping imports unlike browsers.
  await act(async () => {})
  return container
}

function repo(id: string): Repo {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the row renders only id, name and badge color.
  return {
    id,
    path: `/work/${id}`,
    displayName: id,
    badgeColor: '#111',
    addedAt: 0
  } as Repo
}

function companions(overrides: Partial<ComposerCompanionRepos> = {}): ComposerCompanionRepos {
  return {
    candidates: [repo('backend'), repo('admin')],
    selectedIds: [],
    toggle: vi.fn(),
    grantAgentAccess: true,
    setGrantAgentAccess: vi.fn(),
    submit: { repoIds: [], grantAgentAccess: true },
    ...overrides
  }
}

function chip(container: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (node) => node.hasAttribute('aria-pressed') && node.textContent?.includes(name)
  )
  if (!button) {
    throw new Error(`chip not found for ${name}`)
  }
  return button
}

function accessCheckbox(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[role="checkbox"]')
}

beforeEach(() => {
  launchAppliesAgentArgs.mockClear()
  launchAppliesAgentArgs.mockReturnValue(true)
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('NewWorkspaceComposerCard "Also create in" row', () => {
  it('stays hidden unless the composer passes companions', async () => {
    const container = await renderCard()
    expect(container.textContent).not.toContain('Also create in')
  })

  it('renders a toggle chip per companion and reports clicks', async () => {
    const model = companions({ selectedIds: ['admin'] })
    const container = await renderCard({ companionRepos: model })

    expect(container.textContent).toContain('Also create in')
    expect(chip(container, 'backend').getAttribute('aria-pressed')).toBe('false')
    expect(chip(container, 'admin').getAttribute('aria-pressed')).toBe('true')
    act(() => {
      chip(container, 'backend').click()
    })
    expect(model.toggle).toHaveBeenCalledWith('backend')
  })

  it('offers agent access only with a selection and an agent that takes --add-dir', async () => {
    const none = await renderCard({ companionRepos: companions(), quickAgent: 'claude' })
    expect(accessCheckbox(none)).toBeNull()

    const gemini = await renderCard({
      companionRepos: companions({ selectedIds: ['backend'] }),
      quickAgent: 'gemini'
    })
    expect(accessCheckbox(gemini)).toBeNull()

    const model = companions({ selectedIds: ['backend'] })
    const codex = await renderCard({ companionRepos: model, quickAgent: 'codex' })
    const checkbox = accessCheckbox(codex)
    expect(checkbox?.getAttribute('aria-checked')).toBe('true')
    expect(codex.textContent).toContain('Give the agent access to these worktrees')
    act(() => {
      checkbox?.click()
    })
    expect(model.setGrantAgentAccess).toHaveBeenCalledWith(false)
  })

  it('hides agent access when this launch would drop CLI args (structured chat)', async () => {
    launchAppliesAgentArgs.mockReturnValue(false)
    const container = await renderCard({
      companionRepos: companions({ selectedIds: ['backend'] }),
      quickAgent: 'claude',
      selectedRepoExecutionHostId: 'local'
    })

    expect(accessCheckbox(container)).toBeNull()
    expect(container.textContent).not.toContain('Give the agent access to these worktrees')
    expect(launchAppliesAgentArgs).toHaveBeenCalledWith({
      agent: 'claude',
      repoId: 'repo-a',
      executionHostId: 'local'
    })
  })

  it('renders nothing when no companion is available', async () => {
    const container = await renderCard({
      companionRepos: companions({ candidates: [] })
    })
    expect(container.textContent).not.toContain('Also create in')
  })
})
