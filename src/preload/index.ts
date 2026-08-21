import { contextBridge, ipcRenderer } from 'electron'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as { ok: boolean; data?: T; error?: string }
  if (!r) return undefined as T
  if (!r.ok) throw new Error(r.error)
  return r.data as T
}

const api = {
  invoke,
  print: () => ipcRenderer.invoke('app:print')
}

contextBridge.exposeInMainWorld('api', api)
export type Api = typeof api
