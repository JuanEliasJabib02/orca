// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import TaskNoteDialog from './TaskNoteDialog'

const initialState = useAppStore.getInitialState()
const uiSet = vi.fn(() => Promise.resolve())
let container: HTMLDivElement
let root: Root

async function openDialog(taskKey = 'AX-3423'): Promise<void> {
  await act(async () => {
    useAppStore.getState().openModal('edit-task-note', { taskKey })
    root.render(<TaskNoteDialog />)
  })
}

function getTextarea(): HTMLTextAreaElement {
  const textarea = document.body.querySelector('textarea')
  if (!textarea) {
    throw new Error('Note field not rendered')
  }
  return textarea
}

function getButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find(
    (entry) => entry.textContent === label
  )
  if (!button) {
    throw new Error(`Button not found: ${label}`)
  }
  return button
}

async function type(value: string): Promise<void> {
  const textarea = getTextarea()
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function press(key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    getTextarea().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    )
  })
}

describe('TaskNoteDialog', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    vi.stubGlobal('api', { ui: { set: uiSet } })
    useAppStore.setState(initialState, true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    useAppStore.setState(initialState, true)
  })

  it('names the task and starts empty when it has no note', async () => {
    await openDialog()

    expect(document.body.textContent).toContain('Note for AX-3423')
    expect(getTextarea().value).toBe('')
  })

  it('starts from the saved note when editing', async () => {
    useAppStore.setState({ taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear' } })

    await openDialog()

    expect(getTextarea().value).toBe('POS Action Wear')
  })

  it('saves the typed note and closes', async () => {
    await openDialog()
    await type('POS Action Wear')

    await act(async () => {
      getButton('Save').click()
    })

    expect(useAppStore.getState().taskNoteByTaskKey).toEqual({ 'AX-3423': 'POS Action Wear' })
    expect(uiSet).toHaveBeenCalledWith({ taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear' } })
    expect(useAppStore.getState().activeModal).toBe('none')
  })

  it('removes the note when it is saved empty', async () => {
    useAppStore.setState({
      taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear', 'AX-3500': 'Kiosk refund flow' }
    })
    await openDialog()
    await type('   ')

    await act(async () => {
      getButton('Save').click()
    })

    expect(useAppStore.getState().taskNoteByTaskKey).toEqual({ 'AX-3500': 'Kiosk refund flow' })
    expect(useAppStore.getState().activeModal).toBe('none')
  })

  it('discards the draft on Cancel', async () => {
    useAppStore.setState({ taskNoteByTaskKey: { 'AX-3423': 'POS Action Wear' } })
    await openDialog()
    await type('something else')

    await act(async () => {
      getButton('Cancel').click()
    })

    expect(useAppStore.getState().taskNoteByTaskKey).toEqual({ 'AX-3423': 'POS Action Wear' })
    expect(uiSet).not.toHaveBeenCalled()
    expect(useAppStore.getState().activeModal).toBe('none')
  })

  it('saves on Enter but keeps Shift+Enter for a line break', async () => {
    await openDialog()
    await type('POS Action Wear')

    await press('Enter', { shiftKey: true })
    expect(useAppStore.getState().taskNoteByTaskKey).toEqual({})
    expect(useAppStore.getState().activeModal).toBe('edit-task-note')

    await press('Enter')
    expect(useAppStore.getState().taskNoteByTaskKey).toEqual({ 'AX-3423': 'POS Action Wear' })
    expect(useAppStore.getState().activeModal).toBe('none')
  })

  it('limits the field to the stored length', async () => {
    await openDialog()

    expect(getTextarea().maxLength).toBe(500)
  })
})
