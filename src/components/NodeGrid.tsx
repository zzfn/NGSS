import { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { Flag } from './Flag'
import { cpuLabel, deriveUsage, displayName } from '../utils/derive'
import { bytes } from '../utils/format'
import type { Node, HistorySample } from '../types'

// ── 三网颜色（与 wireframe 严格对齐） ────────────────────────────────────────
const TRI_COLORS = {
  tel: '#2f7fc0', // 电信 蓝
  cu:  '#c14a4a', // 联通 红
  mo:  '#3a8a55', // 移动 绿
}

const TRI_ISP_LABELS = ['电信', '联通', '移动'] as const
const TRI_KEYS = ['tel', 'cu', 'mo'] as const

function detectTriNet(cronNames: string[]): { key: 'tel' | 'cu' | 'mo'; cron: string }[] {
  const result: { key: 'tel' | 'cu' | 'mo'; cron: string }[] = []
  for (const [i, label] of TRI_ISP_LABELS.entries()) {
    const found = cronNames.find(c => c.includes(label))
    if (found) result.push({ key: TRI_KEYS[i], cron: found })
  }
  return result
}

// ── 波形路径 ──────────────────────────────────────────────────────────────────
function buildWavePath(samples: HistorySample[], w: number, h: number): string {
  const vals = samples.map(s => (s.netIn ?? 0) + (s.netOut ?? 0))
  if (vals.length < 2) return ''
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const pad = h * 0.1
  const step = w / (vals.length - 1)
  return vals
    .map((v, i) => {
      const x = (i * step).toFixed(1)
      const y = (h - pad - ((v - min) / range) * (h - pad * 2)).toFixed(1)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')
}

// ── 24H 在线率色块条 ───────────────────────────────────────────────────────────
const STRIP_COLS = 40

function UptimeStrip({ slots }: { slots: HistorySample[] | null }) {
  const pct = useMemo(() => {
    if (!slots || slots.length === 0) return null
    return (slots.filter(s => s.online).length / slots.length) * 100
  }, [slots])

  const pctColor =
    pct == null ? 'hsl(var(--muted-foreground))' :
    pct >= 99   ? 'hsl(142 71% 45%)' :
    pct >= 95   ? 'hsl(45 90% 52%)'  :
                  'hsl(0 72% 55%)'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 34px', gap: 4, alignItems: 'center' }}>
      <span style={{ fontSize: 8, fontFamily: 'JetBrains Mono, ui-monospace, monospace', color: 'hsl(var(--muted-foreground))', opacity: 0.6, letterSpacing: '0.08em' }}>
        24H
      </span>

      <div style={{ display: 'flex', gap: 1.5, height: 3 }}>
        {slots === null ? (
          Array.from({ length: STRIP_COLS }, (_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 1, background: 'hsl(var(--border) / 0.25)' }} />
          ))
        ) : (
          <>
            {Array.from({ length: Math.max(0, STRIP_COLS - slots.length) }, (_, i) => (
              <div key={`p${i}`} style={{ flex: 1, height: 3, borderRadius: 1, background: 'hsl(var(--border) / 0.12)' }} />
            ))}
            {slots.slice(-STRIP_COLS).map((s, i) => (
              <div
                key={i}
                title={`${new Date(s.t).toLocaleString()} · ${s.online ? '在线' : '离线'}`}
                style={{ flex: 1, height: 3, borderRadius: 1, background: s.online ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)', opacity: 0.85 }}
              />
            ))}
          </>
        )}
      </div>

      <span style={{ fontSize: 8, fontFamily: 'JetBrains Mono, ui-monospace, monospace', color: pctColor, textAlign: 'right', opacity: pct == null ? 0.35 : 1 }}>
        {pct != null ? `${pct.toFixed(1)}%` : '···'}
      </span>
    </div>
  )
}

// ── 进度条行（严格对齐 wireframe .bar-row） ───────────────────────────────────
function BarRow({ label, value }: { label: string; value: number | undefined }) {
  const pct = Math.max(0, Math.min(100, value ?? 0))
  const isAlert = pct >= 80
  const isWarn  = !isAlert && pct >= 60

  // wireframe: ink / warn / alert stripe; 3px on, 3px off diagonal
  const stripeColor = isAlert
    ? 'hsl(0 80% 55%)'
    : isWarn
      ? 'hsl(45 90% 55%)'
      : 'hsl(var(--foreground))'

  return (
    // wireframe: grid-template-columns: 34px 1fr 36px; gap: 6px
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: '34px 1fr 36px',
        gap: 6,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10,
      }}
    >
      {/* lbl */}
      <span style={{ color: 'hsl(var(--muted-foreground))', letterSpacing: '0.1em' }}>
        {label}
      </span>

      {/* bar — wireframe: height 6px, border 1px, bg var(--bg-2) */}
      <div
        style={{
          height: 6,
          border: '1px solid hsl(var(--border) / 0.8)',
          borderRadius: 2,
          position: 'relative',
          background: 'hsl(var(--secondary) / 0.6)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            width: `${pct}%`,
            // wireframe: repeating-linear-gradient(45deg, color 0 3px, transparent 3px 6px)
            backgroundImage: `repeating-linear-gradient(45deg, ${stripeColor} 0 3px, transparent 3px 6px)`,
            opacity: isAlert ? 0.85 : isWarn ? 0.75 : 0.5,
          }}
        />
      </div>

      {/* val */}
      <span style={{ color: 'hsl(var(--foreground))', textAlign: 'right' }}>
        {value != null ? `${value.toFixed(0)}%` : '—'}
      </span>
    </div>
  )
}

// ── 状态色 ────────────────────────────────────────────────────────────────────
function resolveStatus(node: Node): 'ok' | 'warn' | 'alert' | 'offline' {
  if (!node.online) return 'offline'
  const u = deriveUsage(node)
  if ((u.cpu ?? 0) >= 80 || (u.mem ?? 0) >= 85 || (u.disk ?? 0) >= 85) return 'alert'
  if ((u.cpu ?? 0) >= 60 || (u.mem ?? 0) >= 70 || (u.disk ?? 0) >= 70) return 'warn'
  return 'ok'
}

const STATUS_COLOR = {
  ok:    'hsl(142 71% 45%)',
  warn:  'hsl(45 90% 55%)',
  alert: 'hsl(0 80% 55%)',
}

// ── 单张卡片 ──────────────────────────────────────────────────────────────────
export const GridCard = memo(function GridCard({
  node,
  onSelect,
  fetchUptimeHistory,
}: {
  node: Node
  onSelect?: (uuid: string) => void
  fetchUptimeHistory?: (uuid: string) => Promise<HistorySample[]>
}) {
  const u      = deriveUsage(node)
  const status = resolveStatus(node)
  const color  = STATUS_COLOR[status]

  // 24H 在线率 —— IntersectionObserver 触发懒加载，防止全量并发请求
  const cardRef = useRef<HTMLButtonElement>(null)
  const [uptimeSlots, setUptimeSlots] = useState<HistorySample[] | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (!fetchUptimeHistory) return
    const el = cardRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || fetchedRef.current) return
      fetchedRef.current = true
      fetchUptimeHistory(node.uuid)
        .then(setUptimeSlots)
        .catch(() => setUptimeSlots([]))
    }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [node.uuid, fetchUptimeHistory])

  const cronNames = useMemo(
    () => [...new Set(node.tcpPings.map(p => p.cron))].sort(),
    [node.tcpPings],
  )
  const triNet = useMemo(() => detectTriNet(cronNames), [cronNames])
  const hasTriNet = triNet.length >= 2

  const lastPingByCron = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const p of [...node.tcpPings].reverse()) {
      if (!m.has(p.cron)) m.set(p.cron, p.latency)
    }
    return m
  }, [node.tcpPings])

  const W = 200
  const H = 36
  const wavePath = useMemo(() => buildWavePath(node.history, W, H), [node.history])

  // 波形悬浮
  const waveVals = useMemo(
    () => node.history.map(s => (s.netIn ?? 0) + (s.netOut ?? 0)),
    [node.history],
  )
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const hoverPoint = useMemo(() => {
    if (hoverIdx === null || waveVals.length < 2) return null
    const min = Math.min(...waveVals)
    const max = Math.max(...waveVals)
    const range = max - min || 1
    const pad = H * 0.1
    const step = W / (waveVals.length - 1)
    const x = hoverIdx * step
    const y = H - pad - ((waveVals[hoverIdx] - min) / range) * (H - pad * 2)
    return { x, y }
  }, [hoverIdx, waveVals])

  const handleWaveMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const idx = Math.round(ratio * (waveVals.length - 1))
    setHoverIdx(Math.max(0, Math.min(waveVals.length - 1, idx)))
  }, [waveVals.length])

  const handleWaveMouseLeave = useCallback(() => setHoverIdx(null), [])

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={() => onSelect?.(node.uuid)}
      className="text-left cursor-pointer relative flex flex-col"
      style={{
        // wireframe: border 1.5px, card.alert → alert border, card.warn → warn border
        border: `1.5px solid ${status === 'ok' || status === 'offline' ? 'hsl(var(--border) / 0.7)' : STATUS_COLOR[status]}`,
        background: 'hsl(var(--card) / 0.78)',
        borderRadius: 6,
        padding: '12px 14px 10px',
        gap: 8,
        minHeight: 168,
        ...(status === 'offline' && { filter: 'grayscale(0.9)', opacity: 0.5 }),
      }}
    >

      {/* 角标 tick — wireframe 的四角小框（::before top-left, ::after bottom-right） */}
      <span
        style={{
          position: 'absolute', top: -3, left: -3, width: 7, height: 7,
          border: `1.5px solid hsl(var(--border) / 0.6)`,
          borderRight: 'none', borderBottom: 'none',
          pointerEvents: 'none',
        }}
      />
      <span
        style={{
          position: 'absolute', bottom: -3, right: -3, width: 7, height: 7,
          border: `1.5px solid hsl(var(--border) / 0.6)`,
          borderLeft: 'none', borderTop: 'none',
          pointerEvents: 'none',
        }}
      />

      {/* ── head: flag · name · status-dot ── */}
      {/* wireframe: .head { display:flex; align-items:center; gap:8px } */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
        {/* wireframe flag: 22×16 text-code box; keep Flag image but match dimensions */}
        <span style={{
          width: 22, height: 16, border: '1px solid hsl(var(--border) / 0.7)',
          borderRadius: 2, flexShrink: 0, overflow: 'hidden', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'hsl(var(--secondary) / 0.5)',
        }}>
          <Flag code={node.meta?.region} className="w-full h-full object-cover" />
        </span>

        {/* wireframe: .name { font-family:'Caveat' cursive; font-size:22px; font-weight:600 } */}
        <span
          style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', lineHeight: 1,
            fontFamily: 'var(--font-display, ui-sans-serif, system-ui)',
            fontWeight: 700,
            fontSize: 18,  // 近似 wireframe 22px Caveat
            color: 'hsl(var(--foreground))',
          }}
        >
          {displayName(node)}
        </span>

        {/* wireframe: .status-dot { width:9px; height:9px } */}
        <span
          style={{
            width: 9, height: 9, borderRadius: '50%',
            background: color, flexShrink: 0,
          }}
        />
      </div>


      {/* ── CPU 型号 + 内存大小 ── */}
      {(() => {
        const cpu = cpuLabel(node)
        const totalMem = node.dynamic?.total_memory
        const memStr = totalMem ? `${(totalMem / 1024 ** 3).toFixed(0)} GB` : null
        const text = [cpu, memStr].filter(Boolean).join(' · ')
        if (!text) return null
        return (
          <div style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 9,
            color: 'hsl(var(--muted-foreground))',
            letterSpacing: '0.04em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {text}
          </div>
        )
      })()}

      {/* ── bars: CPU / MEM / DSK ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <BarRow label="CPU"  value={u.cpu} />
        <BarRow label="MEM"  value={u.mem} />
        <BarRow label="DISK" value={u.disk} />
      </div>

      {/* ── waveform: height 36px ── */}
      {/* wireframe: .waveform { height:36px; margin-top:2px } */}
      <div style={{ height: 36, marginTop: 2, color: 'hsl(var(--muted-foreground))', position: 'relative' }}>
        {wavePath ? (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              style={{ width: '100%', height: '100%', display: 'block' }}
              onMouseMove={handleWaveMouseMove}
              onMouseLeave={handleWaveMouseLeave}
            >
              <path d={`${wavePath} L ${W} ${H} L 0 ${H} Z`} fill="currentColor" opacity={0.08} />
              <path d={wavePath} fill="none" stroke="currentColor" strokeWidth={1.3}
                strokeLinecap="round" strokeLinejoin="round" />
              {hoverPoint && (
                <>
                  <line
                    x1={hoverPoint.x} y1={0} x2={hoverPoint.x} y2={H}
                    stroke="currentColor" strokeWidth={0.8} strokeDasharray="2 2" opacity={0.5}
                  />
                  <circle
                    cx={hoverPoint.x} cy={hoverPoint.y} r={2.5}
                    fill="hsl(var(--background))" stroke="currentColor" strokeWidth={1.5}
                  />
                </>
              )}
            </svg>
            {hoverIdx !== null && hoverPoint && node.history[hoverIdx] && (() => {
              const s = node.history[hoverIdx]
              const leftPct = Math.min(Math.max((hoverPoint.x / W) * 100, 18), 82)
              return (
                <div
                  style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: `${leftPct}%`,
                    transform: 'translateX(-50%)',
                    marginBottom: 4,
                    background: 'hsl(var(--popover) / 0.95)',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 4,
                    padding: '3px 7px',
                    fontSize: 9,
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    color: 'hsl(var(--foreground))',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    zIndex: 50,
                    lineHeight: 1.6,
                  }}
                >
                  <div>↓{bytes(s.netIn ?? 0)}/s ↑{bytes(s.netOut ?? 0)}/s</div>
                  <div style={{ color: 'hsl(var(--muted-foreground))' }}>
                    {new Date(s.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )
            })()}
          </>
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.2, fontSize: 9, fontFamily: 'monospace' }}>
            no data
          </div>
        )}
      </div>

      {/* ── 24H 在线率色块条 ── */}
      {fetchUptimeHistory && (
        <UptimeStrip slots={uptimeSlots} />
      )}

      {/* ── foot / tri-net ── */}
      {/* wireframe: .foot { border-top:1px dashed var(--line-soft); padding-top:6px; margin-top:auto } */}
      <div style={{
        marginTop: 'auto',
        borderTop: '1px dashed hsl(var(--border) / 0.5)',
        paddingTop: 6,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10,
        color: 'hsl(var(--muted-foreground))',
      }}>
        {hasTriNet && node.online ? (
          /* wireframe: .foot.tri { grid-template-columns: repeat(3,1fr); gap:4px } */
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4 }}>
            {triNet.map(({ key, cron }) => {
              const ping = lastPingByCron.get(cron)
              const dot = TRI_COLORS[key]
              const lbl = key === 'tel' ? '电' : key === 'cu' ? '联' : '移'
              return (
                <span
                  key={key}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                >
                  {/* wireframe: .tri-pill::before { width:6px; height:6px; border-radius:50% } */}
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  {/* wireframe: .lbl { font-family:'Patrick Hand'; font-size:11px } */}
                  <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>{lbl}</span>
                  {/* wireframe: .v { font-family:'JetBrains Mono'; font-size:10px; color:var(--ink) } */}
                  <span style={{ fontSize: 10, color: 'hsl(var(--foreground))' }}>
                    {ping != null ? `${Math.round(ping)}ms` : '—'}
                  </span>
                </span>
              )
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              {node.online && u.netIn != null && u.netOut != null
                ? `↓${bytes(u.netIn)}/s ↑${bytes(u.netOut)}/s`
                : ''}
            </span>
            {!node.online && (
              <span style={{ color: STATUS_COLOR.alert, fontWeight: 700 }}>OFFLINE</span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}, (prev, next) =>
  prev.node.uuid === next.node.uuid &&
  prev.node.online === next.node.online &&
  prev.node.dynamic?.timestamp === next.node.dynamic?.timestamp &&
  prev.node.history === next.node.history &&
  prev.node.tcpPings === next.node.tcpPings &&
  prev.fetchUptimeHistory === next.fetchUptimeHistory,
)

// ── 网格容器 ──────────────────────────────────────────────────────────────────
export function NodeGrid({
  nodes,
  onSelect,
  fetchUptimeHistory,
}: {
  nodes: Node[]
  onSelect?: (uuid: string) => void
  fetchUptimeHistory?: (uuid: string) => Promise<HistorySample[]>
}) {
  if (!nodes.length) {
    return (
      <div
        style={{ padding: '80px 0', textAlign: 'center', fontSize: 14, color: 'hsl(var(--muted-foreground))' }}
      >
        暂无节点
      </div>
    )
  }

  return (
    <div
      style={{
        padding: 12,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(max(160px, 19%), 1fr))',
        gap: 12,
      }}
    >
      {nodes.map(n => (
        <GridCard key={n.uuid} node={n} onSelect={onSelect} fetchUptimeHistory={fetchUptimeHistory} />
      ))}
    </div>
  )
}
