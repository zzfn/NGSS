import { useEffect, useState } from 'react'
import { MapPin, Menu, Moon, Search as SearchIcon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { Flag } from './Flag'
import { cn } from '../utils/cn'
import type { VisitorStats } from '../api/methods'

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
  visitorStats?: VisitorStats | null
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
  visitorStats,
  onRegionChange,
  onAlertToggle,
  onQueryChange,
  onMenuOpen,
  onHome,
}: Props) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  interface IPInfo { ip: string; asn?: string; org?: string; city?: string; country_code?: string }
  const [ipInfo, setIpInfo] = useState<IPInfo | null>(null)
  useEffect(() => {
    // ipinfo.io: HTTPS，免费 5万次/月，无需 key；org 格式 "AS1234 ISP Name"
    fetch('https://ipinfo.io/json')
      .then(r => r.json())
      .then((d: { ip: string; city?: string; country?: string; org?: string }) => {
        const [asn, ...rest] = (d.org ?? '').split(' ')
        setIpInfo({ ip: d.ip, city: d.city, country_code: d.country, org: rest.join(' ') || d.org, asn })
      })
      .catch(() => {})
  }, [])

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
        className="flex items-center gap-2 pl-2 pr-2 sm:gap-3 sm:pl-3 sm:pr-2 shrink-0 border-r"
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
              style={{ height: 28, width: 'auto' }}
            />
          )}
        </a>
      </div>

      {/* 中：搜索 + filter pills */}
      <div className="flex-1 min-w-0 flex items-center gap-2 px-2 overflow-x-auto scrollbar-none">
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
              width: 'clamp(112px, 18vw, 140px)',
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
        {ipInfo && (
          <span
            className="hidden md:inline-flex items-center gap-1.5 font-mono group relative cursor-default"
            style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0, fontSize: 11, letterSpacing: '0.06em' }}
          >
            <span style={{ opacity: 0.55, fontSize: 10 }}>你在</span>
            <span style={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}>{[ipInfo.city, ipInfo.country_code].filter(Boolean).join(', ') || ipInfo.ip}</span>
            {/* 悬浮详情 */}
            <span
              className="absolute right-0 top-full mt-1.5 hidden group-hover:flex flex-col gap-1 z-50"
              style={{
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 5,
                padding: '7px 10px',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 16px hsl(0 0% 0% / 0.25)',
              }}
            >
              {[
                ['IP',  ipInfo.ip],
                ['ASN', ipInfo.asn],
                ['ISP', ipInfo.org],
              ].filter(([, v]) => v).map(([k, v]) => (
                <span key={k} className="flex gap-2">
                  <span style={{ opacity: 0.45, width: 28 }}>{k}</span>
                  <span style={{ color: 'hsl(var(--foreground))' }}>{v}</span>
                </span>
              ))}
            </span>
          </span>
        )}
        {onlineViewers != null && onlineViewers > 0 && (
          <span
            className="hidden sm:inline-flex items-center gap-1.5 font-mono"
            style={{ color: 'hsl(142 71% 45%)', flexShrink: 0, letterSpacing: '0.06em' }}
          >
            <span
              style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                background: 'hsl(142 71% 45%)',
                boxShadow: '0 0 6px hsl(142 71% 45%)',
                animation: 'live-pulse-wl 1.4s ease-in-out infinite',
                flexShrink: 0,
              }}
            />
            <span style={{ fontWeight: 800, fontSize: 15, lineHeight: 1 }}>{onlineViewers}</span>
            <span style={{ opacity: 0.7, fontSize: 11 }}>人围观</span>
          </span>
        )}
        {visitorStats != null && (
          <span
            className="hidden sm:inline-flex items-center gap-1 font-mono"
            style={{ color: 'hsl(var(--muted-foreground))', flexShrink: 0, fontSize: 11, letterSpacing: '0.06em' }}
          >
            <span style={{ opacity: 0.55 }}>今日第</span>
            <span style={{ color: 'hsl(var(--foreground))', fontWeight: 700 }}>{visitorStats.today_rank}</span>
            <span style={{ opacity: 0.55 }}>位</span>
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
