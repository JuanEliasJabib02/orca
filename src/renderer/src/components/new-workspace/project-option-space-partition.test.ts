import { describe, expect, it } from 'vitest'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import { rankProjectOptions } from './project-combobox-matching'
import {
  resolveOutOfSpaceProjectOptionIds,
  sectionProjectOptionsBySpace
} from './project-option-space-partition'

function project(id: string, displayName = id): NewWorkspaceProjectOption {
  return {
    kind: 'project',
    id,
    projectId: id,
    displayName,
    badgeColor: '#111111',
    detail: `org/${displayName}`
  }
}

function folder(groupId: string, displayName: string): NewWorkspaceProjectOption {
  return {
    kind: 'project-group',
    id: `project-group:${groupId}`,
    projectGroupId: groupId,
    displayName,
    badgeColor: '#222222',
    detail: `/work/${displayName}`,
    parentPath: `/work/${displayName}`,
    connectionId: null
  }
}

const scope = {
  groupIds: new Set(['space-ax', 'space-ax-child']),
  repoIds: new Set(['repo-backend', 'repo-admin', 'repo-spaceless'])
}

const repoIdsByProjectId = new Map<string, string[]>([
  ['backend', ['repo-backend']],
  ['admin', ['repo-admin']],
  ['shared-tools', ['repo-spaceless']],
  ['blog', ['repo-blog']],
  ['multi-host', ['repo-blog-ssh', 'repo-backend']]
])

describe('resolveOutOfSpaceProjectOptionIds', () => {
  it('returns null when no space narrows the picker', () => {
    expect(
      resolveOutOfSpaceProjectOptionIds({
        options: [project('backend')],
        scope: null,
        repoIdsByProjectId
      })
    ).toBeNull()
  })

  it('marks projects whose repos all sit in another space', () => {
    const outOfSpace = resolveOutOfSpaceProjectOptionIds({
      options: [
        project('backend'),
        project('admin'),
        project('shared-tools'),
        project('blog'),
        project('multi-host')
      ],
      scope,
      repoIdsByProjectId
    })
    expect([...(outOfSpace ?? [])]).toEqual(['blog'])
  })

  it('keeps a project with unknown repos listed instead of hiding it', () => {
    const outOfSpace = resolveOutOfSpaceProjectOptionIds({
      options: [project('unmapped')],
      scope,
      repoIdsByProjectId
    })
    expect(outOfSpace?.size).toBe(0)
  })

  it('places folder targets by their group, nested groups included', () => {
    const outOfSpace = resolveOutOfSpaceProjectOptionIds({
      options: [
        folder('space-ax', 'ax'),
        folder('space-ax-child', 'ax-child'),
        folder('space-other', 'other')
      ],
      scope,
      repoIdsByProjectId
    })
    expect([...(outOfSpace ?? [])]).toEqual(['project-group:space-other'])
  })
})

describe('sectionProjectOptionsBySpace', () => {
  const options = [
    project('backend'),
    project('admin'),
    project('shared-tools'),
    project('blog'),
    project('blog-api'),
    project('api-gateway'),
    project('web'),
    project('docs'),
    project('infra'),
    project('mobile')
  ]
  const outOfSpace = new Set(['blog', 'blog-api', 'api-gateway'])

  function sectionIds(query: string, recentIds: string[] = []): Record<string, string[]> {
    const sections = sectionProjectOptionsBySpace(
      rankProjectOptions(options, query, recentIds),
      query,
      recentIds,
      outOfSpace
    )
    return Object.fromEntries(
      sections.map((section) => [section.key, section.items.map((item) => item.option.id)])
    )
  }

  it('lists only the active space without a query, Recent included', () => {
    const sections = sectionIds('', ['blog', 'admin'])
    expect(sections.recent).toEqual(['admin'])
    expect(sections.projects).toEqual(['backend', 'docs', 'infra', 'mobile', 'shared-tools', 'web'])
    expect(sections['other-spaces']).toBeUndefined()
    expect(Object.values(sections).flat()).not.toContain('blog')
  })

  it('appends matching projects from other spaces as the last section while searching', () => {
    const sections = sectionProjectOptionsBySpace(
      rankProjectOptions(options, 'a', []),
      'a',
      [],
      outOfSpace
    )
    expect(sections.at(-1)?.key).toBe('other-spaces')
    expect(sections.at(-1)?.heading).toBe('Other spaces')
    expect(
      sections
        .at(-1)
        ?.items.map((item) => item.option.id)
        .sort()
    ).toEqual(['api-gateway', 'blog-api'])
    expect(sections[0]?.key).toBe('results')
    expect(sections[0]?.items.map((item) => item.option.id)).not.toContain('api-gateway')
  })

  it('shows only the other-spaces section when nothing in the space matches', () => {
    expect(sectionIds('blog')).toEqual({ 'other-spaces': ['blog', 'blog-api'] })
  })

  it('falls back to the plain sections when no space narrows the picker', () => {
    const matches = rankProjectOptions(options, '', [])
    const sections = sectionProjectOptionsBySpace(matches, '', [], null)
    expect(sections.flatMap((section) => section.items.map((item) => item.option.id))).toHaveLength(
      options.length
    )
    expect(sections.some((section) => section.key === 'other-spaces')).toBe(false)
  })
})
