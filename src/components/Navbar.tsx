import { useState } from 'react'
import { Menu, Moon, Search as SearchIcon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { Flag } from './Flag'
import { cn } from '../utils/cn'

interface Props {
  siteName: string
  logo?: string
  regions?: string[]
  regionCounts?: Map<string, number>
  activeRegion?: string | null
  alertCount?: number
  alertOnly?: boolean
  query?: string
  onlineViewers?: number | null
  onRegionChange?: (r: string | null) => void
  onAlertToggle?: () => void
  onQueryChange?: (q: string) => void
  onMenuOpen?: () => void
  onHome?: () => void
}

export function Navbar({
  siteName,
  logo,
  regions,
  regionCounts,
  activeRegion,
  alertCount = 0,
  alertOnly = false,
  query = '',
  onlineViewers,
  onRegionChange,
  onAlertToggle,
  onQueryChange,
  onMenuOpen,
  onHome,
}: Props) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  const divider = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const pillBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '0 10px',
    height: 24,
    borderRadius: 999,
    fontSize: 10,
    fontFamily: 'ui-monospace, monospace',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    border: '1px solid',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  }
  const pillActive: React.CSSProperties = {
    ...pillBase,
    background: 'hsl(var(--foreground))',
    color: 'hsl(var(--background))',
    borderColor: 'hsl(var(--foreground))',
  }
  const pillInactive: React.CSSProperties = {
    ...pillBase,
    background: 'transparent',
    color: 'hsl(var(--muted-foreground))',
    borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
  }

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 h-11 flex items-stretch"
      style={{
        background: isDark ? 'rgba(8, 11, 18, 0.92)' : 'rgba(245, 247, 250, 0.92)',
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        borderBottom: isDark
          ? '1px solid rgba(255,255,255,0.08)'
          : '1px solid rgba(0,0,0,0.08)',
      }}
    >
      {/* 左：LOGO + 站点名 */}
      <div
        className="flex items-center gap-3 pl-3 pr-4 shrink-0 border-r"
        style={{ borderColor: divider }}
      >
        {onMenuOpen && (
          <button
            type="button"
            onClick={onMenuOpen}
            className="lg:hidden p-1 transition-colors shrink-0"
            style={{ color: 'hsl(var(--nx-text-muted))' }}
          >
            <Menu className="h-4 w-4" />
          </button>
        )}
        <a
          href="./"
          onClick={e => {
            e.preventDefault()
            onHome?.()
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          className="flex items-center gap-2 shrink-0"
        >
          {logo && (
            <img
              src={logo}
              alt=""
              style={{ height: 28, width: 'auto', filter: isDark ? 'invert(1)' : 'none' }}
            />
          )}
        </a>
      </div>

      {/* 中：搜索 + filter pills */}
      <div className="flex-1 min-w-0 flex items-center gap-2 px-3 overflow-x-auto scrollbar-none">
        {/* 搜索框 */}
        <div className="relative shrink-0">
          <SearchIcon
            className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none"
            style={{ color: 'hsl(var(--muted-foreground))' }}
          />
          <input
            type="search"
            placeholder="搜索…"
            value={query}
            onChange={e => onQueryChange?.(e.target.value)}
            style={{
              height: 26,
              paddingLeft: 22,
              paddingRight: 8,
              fontSize: 11,
              fontFamily: 'ui-monospace, monospace',
              background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
              border: `1px solid ${divider}`,
              borderRadius: 6,
              color: 'hsl(var(--foreground))',
              outline: 'none',
              width: 140,
            }}
          />
        </div>

        {/* All pill */}
        <button
          type="button"
          style={!activeRegion && !alertOnly ? pillActive : pillInactive}
          onClick={() => { onRegionChange?.(null) }}
        >
          全部
        </button>

        {/* Region pills */}
        {regions?.map(r => (
          <button
            key={r}
            type="button"
            style={activeRegion === r && !alertOnly ? pillActive : pillInactive}
            onClick={() => { onRegionChange?.(activeRegion === r ? null : r) }}
          >
            <Flag code={r} className="w-3.5 h-2.5" />
            {r}
            <span style={{ opacity: 0.5 }}>{regionCounts?.get(r)}</span>
          </button>
        ))}

        {/* Alert pill */}
        {alertCount > 0 && (
          <button
            type="button"
            style={alertOnly ? pillActive : { ...pillInactive, borderColor: 'hsl(0 80% 55% / 0.4)', color: 'hsl(0 80% 55%)' }}
            onClick={onAlertToggle}
          >
            ⚠ 告警
            <span style={{ opacity: 0.6 }}>{alertCount}</span>
          </button>
        )}
      </div>

      {/* 右：在线人数 + 时钟 + 主题切换 */}
      <div
        className="flex items-center gap-3 px-3 shrink-0 border-l"
        style={{ borderColor: divider }}
      >
        {onlineViewers != null && onlineViewers > 0 && (
          <span
            className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono tracking-[0.12em]"
            style={{ color: 'hsl(142 71% 45%)', flexShrink: 0 }}
          >
            <span
              style={{
                display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                background: 'hsl(142 71% 45%)',
                boxShadow: '0 0 5px hsl(142 71% 45%)',
                animation: 'live-pulse-wl 1.4s ease-in-out infinite',
              }}
            />
            <span style={{ fontWeight: 700 }}>{onlineViewers}</span>
            <span style={{ opacity: 0.75 }}>人围观</span>
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          title={theme === 'dark' ? '切换亮色' : '切换暗色'}
          className="p-1 transition-colors shrink-0"
          style={{ color: 'hsl(var(--nx-text-muted))' }}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  )
}
