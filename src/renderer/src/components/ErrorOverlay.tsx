import { AlertTriangle, ArrowLeft, RotateCw, ShieldAlert } from 'lucide-react'
import type { TabState } from '@shared/types'

interface ErrorOverlayProps {
  tab: TabState
  onBack: () => void
  onReload: () => void
}

export function ErrorOverlay({ tab, onBack, onReload }: ErrorOverlayProps): React.JSX.Element {
  const isCert = Boolean(tab.certError)

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#0d1017] px-6 text-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#151923] p-6 shadow-2xl">
        <div
          className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${
            isCert ? 'bg-rose-500/15 text-rose-400' : 'bg-amber-500/15 text-amber-400'
          }`}
        >
          {isCert ? <ShieldAlert className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
        </div>

        <h1 className="text-base font-semibold text-slate-100">
          {isCert ? 'Your connection is not private' : "This site can't be reached"}
        </h1>

        <p className="mt-2 break-all text-xs text-slate-400">{tab.url}</p>

        <div className="mt-3 rounded-lg bg-[#0f1117] px-3 py-2 text-xs text-slate-300 border border-slate-800">
          {tab.certError || tab.lastError}
        </div>

        {isCert && (
          <p className="mt-3 text-xs text-slate-400">
            Orbit blocked this page because its security certificate could not be verified.
          </p>
        )}

        <div className="mt-5 flex items-center justify-center gap-2">
          {tab.canGoBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Go Back Safely
            </button>
          )}
          {!isCert && (
            <button
              type="button"
              onClick={onReload}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-500"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Reload Page
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
