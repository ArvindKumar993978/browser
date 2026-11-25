import { create } from 'zustand'
import type { BrowserStateSnapshot, DownloadItem, UpdateState } from '@shared/types'

interface BrowserStore {
  snapshot: BrowserStateSnapshot | null
  downloads: DownloadItem[]
  updateState: UpdateState | null
  hydrate: () => Promise<void>
  setSnapshot: (snapshot: BrowserStateSnapshot) => void
  setDownloads: (downloads: DownloadItem[]) => void
  setUpdateState: (updateState: UpdateState) => void
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  snapshot: null,
  downloads: [],
  updateState: null,

  hydrate: async () => {
    const [snapshot, downloads, updateState] = await Promise.all([
      window.orbitAPI.getState(),
      window.orbitAPI.getDownloads(),
      window.orbitAPI.getUpdateState()
    ])
    set({ snapshot, downloads, updateState })
  },

  setSnapshot: (snapshot) => set({ snapshot }),
  setDownloads: (downloads) => set({ downloads }),
  setUpdateState: (updateState) => set({ updateState })
}))
