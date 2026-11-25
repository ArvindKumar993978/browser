import { useState } from 'react'
import { BookOpen, Minus, Plus, X } from 'lucide-react'
import type { ReaderArticle } from '@shared/types'

interface ReaderOverlayProps {
  article: ReaderArticle
  onClose: () => void
}

export function ReaderOverlay({ article, onClose }: ReaderOverlayProps): React.JSX.Element {
  const [theme, setTheme] = useState<'dark' | 'sepia' | 'light'>('dark')
  const [fontSize, setFontSize] = useState(17)

  const themeClasses =
    theme === 'sepia'
      ? 'bg-[#f4ecd8] text-[#3a2f22]'
      : theme === 'light'
        ? 'bg-[#fafafa] text-slate-900'
        : 'bg-[#10131a] text-slate-200'

  const mutedClass =
    theme === 'sepia'
      ? 'text-[#6e5a41]'
      : theme === 'light'
        ? 'text-slate-500'
        : 'text-slate-400'

  return (
    <div className={`flex flex-1 flex-col overflow-hidden ${themeClasses}`}>
      {/* Reader Controls */}
      <div className="flex items-center justify-between border-b border-slate-500/20 px-6 py-2.5 text-xs">
        <div className="flex items-center gap-2 font-medium">
          <BookOpen className="h-4 w-4 text-sky-400" />
          <span>Reader Mode (Plain-Text Safe View)</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-slate-500/30 px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.max(13, s - 1))}
              className="p-1 hover:opacity-75"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="px-1 text-[11px]">{fontSize}px</span>
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.min(24, s + 1))}
              className="p-1 hover:opacity-75"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {(['dark', 'sepia', 'light'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`rounded-md px-2 py-1 text-[11px] capitalize border ${
                theme === t
                  ? 'border-sky-500 font-semibold'
                  : 'border-slate-500/30 opacity-75 hover:opacity-100'
              }`}
            >
              {t}
            </button>
          ))}

          <button
            type="button"
            onClick={onClose}
            className="ml-2 flex items-center gap-1 rounded-md bg-slate-700/40 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-700/60"
          >
            <X className="h-3.5 w-3.5" />
            Exit Reader
          </button>
        </div>
      </div>

      {/* Article Body (strictly JSX text nodes - zero raw HTML injection) */}
      <div className="flex-1 overflow-y-auto px-6 py-10">
        <article className="mx-auto max-w-2xl space-y-5 leading-relaxed">
          <header className="space-y-2 border-b border-slate-500/20 pb-5">
            {article.siteName && (
              <div className={`text-xs font-semibold uppercase tracking-wider ${mutedClass}`}>
                {article.siteName}
              </div>
            )}
            <h1 className="text-2xl font-bold leading-snug">{article.title}</h1>
            {article.byline && <div className={`text-xs ${mutedClass}`}>By {article.byline}</div>}
          </header>

          {article.blocks.length === 0 ? (
            <p className={`text-sm ${mutedClass}`}>
              Could not extract enough article paragraphs from this page.
            </p>
          ) : (
            <div className="space-y-4" style={{ fontSize: `${fontSize}px` }}>
              {article.blocks.map((block, idx) => {
                if (block.type === 'h1' || block.type === 'h2') {
                  return (
                    <h2 key={idx} className="pt-3 text-lg font-semibold leading-snug">
                      {block.text}
                    </h2>
                  )
                }
                if (block.type === 'quote') {
                  return (
                    <blockquote
                      key={idx}
                      className="border-l-2 border-sky-500 pl-4 italic opacity-90"
                    >
                      {block.text}
                    </blockquote>
                  )
                }
                if (block.type === 'li') {
                  return (
                    <div key={idx} className="flex gap-2 pl-2">
                      <span>•</span>
                      <span>{block.text}</span>
                    </div>
                  )
                }
                return <p key={idx}>{block.text}</p>
              })}
            </div>
          )}
        </article>
      </div>
    </div>
  )
}
