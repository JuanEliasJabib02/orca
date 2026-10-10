import { ipcRenderer } from 'electron'
import type { SpotlightChangedEvent } from '../../shared/spotlight'
import type { PreloadApi } from '../api-types'

export const spotlightApi = {
  getState: () => ipcRenderer.invoke('spotlight:getState'),

  activate: (args) => ipcRenderer.invoke('spotlight:activate', args),

  sync: (args) => ipcRenderer.invoke('spotlight:sync', args),

  deactivate: (args) => ipcRenderer.invoke('spotlight:deactivate', args),

  setLogPty: (args) => ipcRenderer.invoke('spotlight:setLogPty', args),

  clearLogPty: (args) => ipcRenderer.invoke('spotlight:clearLogPty', args),

  startServer: (args) => ipcRenderer.invoke('spotlight:startServer', args),

  prepareServerLaunch: (args) => ipcRenderer.invoke('spotlight:prepareServerLaunch', args),

  cancelPreparedServerLaunch: (args) =>
    ipcRenderer.invoke('spotlight:cancelPreparedServerLaunch', args),

  serverState: (args) => ipcRenderer.invoke('spotlight:serverState', args),

  noteServerAutostart: (args) => ipcRenderer.invoke('spotlight:noteServerAutostart', args),

  inferServerVariant: (args) => ipcRenderer.invoke('spotlight:inferServerVariant', args),

  onChanged: (callback: (event: SpotlightChangedEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: SpotlightChangedEvent) =>
      callback(data)
    ipcRenderer.on('spotlight:changed', listener)
    return () => ipcRenderer.removeListener('spotlight:changed', listener)
  }
} satisfies PreloadApi['spotlight']
