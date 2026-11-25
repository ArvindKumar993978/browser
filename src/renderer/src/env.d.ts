import type { OrbitBrowserAPI } from '../../shared/types'

declare global {
  interface Window {
    orbitAPI: OrbitBrowserAPI
  }
}

export {}
