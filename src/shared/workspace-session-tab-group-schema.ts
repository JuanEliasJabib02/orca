import { z } from 'zod'
import type { TabGroupLayoutNode } from './tab-types'

export const tabGroupSchema = z.object({
  id: z.string(),
  worktreeId: z.string(),
  activeTabId: z.string().nullable(),
  tabOrder: z.array(z.string()),
  recentTabIds: z.array(z.string()).optional()
})

const tabGroupSplitDirectionSchema = z.enum(['horizontal', 'vertical'])

export const tabGroupLayoutNodeSchema: z.ZodType<TabGroupLayoutNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('leaf'),
      groupId: z.string()
    }),
    z.object({
      type: z.literal('split'),
      direction: tabGroupSplitDirectionSchema,
      first: tabGroupLayoutNodeSchema,
      second: tabGroupLayoutNodeSchema,
      ratio: z.number().optional()
    })
  ])
)
