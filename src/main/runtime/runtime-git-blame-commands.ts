import type { GitLineBlameResult } from '../../shared/git-line-blame-types'
import {
  normalizeRuntimeGitRelativePath,
  requireRuntimeGitProvider,
  type RuntimeGitCommandHost
} from './runtime-git-command-target'

export class RuntimeGitBlameCommands {
  constructor(private readonly host: RuntimeGitCommandHost) {}

  /**
   * Authorship for every line of a file, in one walk.
   *
   * Why whole-file: `-L` does not make blame cheaper — git walks the same history
   * either way — so one walk answers every line for the price of a single-line read.
   */
  async getRuntimeGitFileBlame(
    worktreeSelector: string,
    filePath: string
  ): Promise<Record<number, GitLineBlameResult> | null> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePath = normalizeRuntimeGitRelativePath(filePath)
    return requireRuntimeGitProvider(target).getFileBlame(target.worktree.path, relativePath)
  }

  /** Authorship for one 1-indexed line; the fallback when a whole-file read is unavailable. */
  async getRuntimeGitLineBlame(
    worktreeSelector: string,
    filePath: string,
    line1Indexed: number
  ): Promise<GitLineBlameResult | null> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const relativePath = normalizeRuntimeGitRelativePath(filePath)
    return requireRuntimeGitProvider(target).getLineBlame(
      target.worktree.path,
      relativePath,
      line1Indexed
    )
  }
}
