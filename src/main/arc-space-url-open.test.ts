import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openUrlInArcSpace, resolveRequestedArcSpace } from './arc-space-url-open'

const { runProcessMock, statMock } = vi.hoisted(() => ({
  runProcessMock: vi.fn(),
  statMock: vi.fn()
}))
vi.mock('@orca/process-host', () => ({ runProcess: runProcessMock }))
vi.mock('node:fs/promises', () => ({ stat: statMock }))

describe('resolveRequestedArcSpace', () => {
  it('returns nothing while the opt-in is off', () => {
    expect(resolveRequestedArcSpace({ openLinksInArcSpaces: false }, { arcSpace: 'Action' })).toBe(
      null
    )
    expect(resolveRequestedArcSpace({}, { arcSpace: 'Action' })).toBe(null)
  })

  it('returns the trimmed space name when the opt-in is on', () => {
    expect(resolveRequestedArcSpace({ openLinksInArcSpaces: true }, { arcSpace: ' Action ' })).toBe(
      'Action'
    )
  })
})

describe('openUrlInArcSpace', () => {
  beforeEach(() => {
    runProcessMock.mockReset()
    statMock.mockReset()
    statMock.mockResolvedValue({ isDirectory: () => true })
    runProcessMock.mockResolvedValue({ code: 0, stdout: '', stderr: '', timedOut: false })
  })

  it('never runs AppleScript off macOS', async () => {
    await expect(openUrlInArcSpace('https://example.com', 'Action', 'linux')).resolves.toBe(false)
    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('never runs AppleScript when Arc is not installed', async () => {
    statMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    await expect(openUrlInArcSpace('https://example.com', 'Action', 'darwin')).resolves.toBe(false)
    expect(runProcessMock).not.toHaveBeenCalled()
  })

  it('passes the URL and space name as arguments, never as script text', async () => {
    const spaceName = 'Bulba" & (do shell script "id") & "'
    const url = 'https://example.com/?q="x"'
    await expect(openUrlInArcSpace(url, spaceName, 'darwin')).resolves.toBe(true)
    const spec = runProcessMock.mock.calls[0]?.[0]
    expect(spec.program).toBe('/usr/bin/osascript')
    expect(spec.args.slice(-2)).toEqual([url, spaceName])
    const scriptLines = spec.args.slice(0, -2).filter((_: string, i: number) => i % 2 === 1)
    expect(scriptLines.join('\n')).not.toContain('do shell script')
    expect(scriptLines.join('\n')).not.toContain('example.com')
  })

  it.each([
    { code: 1, stdout: '', stderr: "Can't get space", timedOut: false },
    { code: null, stdout: '', stderr: '', timedOut: true }
  ])('reports failure so the caller falls back: %j', async (result) => {
    runProcessMock.mockResolvedValue(result)
    await expect(openUrlInArcSpace('https://example.com', 'Action', 'darwin')).resolves.toBe(false)
  })

  it('reports failure when osascript cannot start', async () => {
    runProcessMock.mockRejectedValue(new Error('spawn failed'))
    await expect(openUrlInArcSpace('https://example.com', 'Action', 'darwin')).resolves.toBe(false)
  })
})
