import { useEffect, useMemo, useRef, useState, useDeferredValue } from 'react'
import { Routes, Route, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence } from 'motion/react'
import { AlertTriangle, Map as MapIcon } from 'lucide-react'
import { LoadingScreen } from './components/LoadingScreen'
import { Toaster } from './components/ui/sonner'
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert'
import { useConfig } from './hooks/useConfig'
import { useNodes } from './hooks/useNodes'
import { Background } from './components/Background'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { AlertBanner } from './components/AlertBanner'
import { WorldMap } from './components/WorldMap'
import { NodeDetail } from './components/NodeDetail'
import { NodeGrid } from './components/NodeGrid'
import { VisitorStatsCard } from './components/VisitorStatsCard'
import { deriveUsage } from './utils/derive'
import { resolveCoords } from './utils/coords'
import type { View, Node, TcpPingRecord, HistorySample } from './types'
import type { SummaryBucket } from './api/methods'

const DEFAULT_LOGO = `${import.meta.env.BASE_URL}favicon.svg`

// ── 移动端检测 hook ────────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 640)
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return mobile
}

function initialView(): View {
  return 'cards'
}

// ── 主题色 ────────────────────────────────────────────────────────────────────
const C_OK   = 'hsl(170 75% 52%)'  // 青绿主色（正常/在线）
const C_WARN = 'hsl(45 90% 52%)'   // 琥珀（告警）
const C_BAD  = 'hsl(0 72% 58%)'    // 红（严重/危险）

// ── 聚合流量 Sparkline ────────────────────────────────────────────────────────
const SPARKLINE_WINDOW_MS = 30 * 60 * 1000   // 30 分钟
const SPARKLINE_BUCKETS   = 30               // 30 桶（每桶 60s）
const SPARKLINE_REFRESH_MS = 2 * 60 * 1000  // 每 2 分钟刷新一次

function TrafficSparkline({
  nodes,
  fetchBuckets,
}: {
  nodes: Node[]
  fetchBuckets?: (from: number, to: number, buckets: number) => Promise<SummaryBucket[]>
}) {
  const W = 600
  const H = 72
  const PAD = { t: 10, b: 12, l: 8, r: 8 }

  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [serverBuckets, setServerBuckets] = useState<SummaryBucket[] | null>(null)

  const hasNodes = nodes.length > 0
  useEffect(() => {
    if (!fetchBuckets || !hasNodes) return
    let cancelled = false
    const doFetch = () => {
      const now = Date.now()
      fetchBuckets(now - SPARKLINE_WINDOW_MS, now, SPARKLINE_BUCKETS)
        .then(data => { if (!cancelled && data?.length >= 2) setServerBuckets(data) })
        .catch(() => {})
    }
    doFetch()
    const timer = setInterval(doFetch, SPARKLINE_REFRESH_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [hasNodes, fetchBuckets])

  const { inPath, outPath, totalIn, totalOut, ins, outs, keys, step, maxVal } = useMemo(() => {
    const cW = W - PAD.l - PAD.r
    const cH = H - PAD.t - PAD.b

    let ins: number[], outs: number[], keys: number[]

    if (serverBuckets && serverBuckets.length >= 2) {
      ins  = serverBuckets.map(b => (b.receive_speed  as number | null) ?? 0)
      outs = serverBuckets.map(b => (b.transmit_speed as number | null) ?? 0)
      keys = serverBuckets.map(b => b.t)
    } else {
      // 后端数据未就绪时，降级使用 nodes 实时历史（4 分钟窗口）
      const BUCKET = 30_000
      const bucketIn  = new Map<number, number>()
      const bucketOut = new Map<number, number>()
      for (const n of nodes) {
        for (const h of n.history) {
          const k = Math.floor(h.t / BUCKET) * BUCKET
          bucketIn.set(k,  (bucketIn.get(k)  ?? 0) + (h.netIn  ?? 0))
          bucketOut.set(k, (bucketOut.get(k) ?? 0) + (h.netOut ?? 0))
        }
      }
      keys = [...new Set([...bucketIn.keys(), ...bucketOut.keys()])].sort()
      if (keys.length < 2) return { inPath: '', outPath: '', totalIn: 0, totalOut: 0, ins: [], outs: [], keys: [], step: 0, maxVal: 1 }
      ins  = keys.map(k => bucketIn.get(k)  ?? 0)
      outs = keys.map(k => bucketOut.get(k) ?? 0)
    }

    const maxVal = Math.max(...ins, ...outs, 1)
    const step   = cW / (keys.length - 1)

    const toPath = (vals: number[]) =>
      vals
        .map((v, i) => {
          const x = PAD.l + i * step
          const y = PAD.t + cH - (v / maxVal) * cH
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
        })
        .join(' ')

    return { inPath: toPath(ins), outPath: toPath(outs), totalIn: ins[ins.length - 1], totalOut: outs[outs.length - 1], ins, outs, keys, step, maxVal }
  }, [nodes, serverBuckets])

  function fmtSpeed(v: number) {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}G`
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
    return `${v.toFixed(0)}B`
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || keys.length < 2) return
    const rect = svgRef.current.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * W
    const idx = Math.round((mouseX - PAD.l) / step)
    setHoverIdx(Math.max(0, Math.min(keys.length - 1, idx)))
    setMousePos({ x: e.clientX, y: e.clientY })
  }

  const cH = H - PAD.t - PAD.b
  const hoverX = hoverIdx !== null && step > 0 ? PAD.l + hoverIdx * step : null
  const hoverInY = hoverIdx !== null && ins[hoverIdx] !== undefined
    ? PAD.t + cH - (ins[hoverIdx] / maxVal) * cH : null
  const hoverOutY = hoverIdx !== null && outs[hoverIdx] !== undefined
    ? PAD.t + cH - (outs[hoverIdx] / maxVal) * cH : null

  return (
    <div className="relative h-full flex flex-col" style={{ minWidth: 0 }}>
      {/* 图表标头 */}
      <div
        className="flex items-baseline justify-between px-3 pt-1.5 text-[9px] font-mono uppercase tracking-widest shrink-0"
        style={{ color: 'hsl(var(--muted-foreground))' }}
      >
        <span>Aggregate Traffic</span>
        <span>
          {hoverIdx !== null && ins[hoverIdx] !== undefined
            ? <>↓{fmtSpeed(ins[hoverIdx])}/s · ↑{fmtSpeed(outs[hoverIdx])}/s</>
            : <>↓{fmtSpeed(totalIn)}/s · ↑{fmtSpeed(totalOut)}/s</>
          }
        </span>
      </div>
      {/* SVG 波形 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full h-full"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { setHoverIdx(null); setMousePos(null) }}
        >
          {inPath && (
            <>
              <path
                d={`${inPath} L ${W - PAD.r} ${H - PAD.b} L ${PAD.l} ${H - PAD.b} Z`}
                fill={C_OK}
                opacity={0.1}
              />
              <path
                d={inPath}
                fill="none"
                stroke={C_OK}
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}
          {outPath && (
            <>
              <path
                d={`${outPath} L ${W - PAD.r} ${H - PAD.b} L ${PAD.l} ${H - PAD.b} Z`}
                fill="hsl(217 91% 60%)"
                opacity={0.08}
              />
              <path
                d={outPath}
                fill="none"
                stroke="hsl(217 91% 60%)"
                strokeWidth={1.1}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.75}
              />
            </>
          )}

          {/* hover 竖线 + 数据点 */}
          {hoverX !== null && (
            <>
              <line
                x1={hoverX} y1={PAD.t} x2={hoverX} y2={H - PAD.b}
                stroke="white" strokeWidth={0.6} opacity={0.3}
              />
              {hoverInY !== null && (
                <circle cx={hoverX} cy={hoverInY} r={2.5} fill={C_OK} />
              )}
              {hoverOutY !== null && (
                <circle cx={hoverX} cy={hoverOutY} r={2} fill="hsl(217 91% 60%)" />
              )}
            </>
          )}
        </svg>
      </div>

      {/* 浮动 tooltip */}
      {hoverIdx !== null && mousePos && ins[hoverIdx] !== undefined && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md font-mono"
          style={{ left: mousePos.x + 14, top: mousePos.y - 40 }}
        >
          <div style={{ color: C_OK }}>↓ {fmtSpeed(ins[hoverIdx])}/s</div>
          <div style={{ color: 'hsl(217 91% 60%)' }}>↑ {fmtSpeed(outs[hoverIdx])}/s</div>
          <div className="mt-0.5 text-muted-foreground text-[10px]">
            {new Date(keys[hoverIdx]).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 排行榜 ──────────────────────────────────────────────────────────────────
function fmtSpeed(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}G`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return `${v.toFixed(0)}B`
}

function buildRankedIds(nodes: Node[]) {
  const online = nodes.filter(n => n.online)
  return {
    cpu: [...online]
      .filter(n => n.dynamic?.cpu_usage != null)
      .sort((a, b) => b.dynamic!.cpu_usage! - a.dynamic!.cpu_usage!)
      .slice(0, 5).map(n => n.uuid),
    mem: [...online]
      .filter(n => n.dynamic?.used_memory && n.dynamic?.total_memory)
      .sort((a, b) => b.dynamic!.used_memory! / b.dynamic!.total_memory! - a.dynamic!.used_memory! / a.dynamic!.total_memory!)
      .slice(0, 5).map(n => n.uuid),
    traffic: [...online]
      .filter(n => n.dynamic)
      .sort((a, b) => {
        const ta = (a.dynamic!.receive_speed ?? 0) + (a.dynamic!.transmit_speed ?? 0)
        const tb = (b.dynamic!.receive_speed ?? 0) + (b.dynamic!.transmit_speed ?? 0)
        return tb - ta
      })
      .slice(0, 5).map(n => n.uuid),
  }
}

function TopRanking({ nodes, onSelect }: { nodes: Node[]; onSelect: (uuid: string) => void }) {
  // 排名顺序稳定：首次有数据立即填充，之后每 20s 才重排
  const [rankedIds, setRankedIds] = useState<ReturnType<typeof buildRankedIds>>({ cpu: [], mem: [], traffic: [] })
  const lastRankTime = useRef(0)
  const rankedIdsRef = useRef(rankedIds)
  rankedIdsRef.current = rankedIds

  useEffect(() => {
    const hasData = nodes.some(n => n.online && n.dynamic != null)
    if (!hasData) return
    const now = Date.now()
    if (rankedIdsRef.current.cpu.length === 0 || now - lastRankTime.current > 20_000) {
      lastRankTime.current = now
      setRankedIds(buildRankedIds(nodes))
    }
  }, [nodes])

  // 实时值从 nodeMap 取
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.uuid, n])), [nodes])

  const online = nodes.filter(n => n.online)
  if (online.length === 0) return null

  const topCpu     = rankedIds.cpu.map(id => nodeMap.get(id)).filter(Boolean) as Node[]
  const topMem     = rankedIds.mem.map(id => nodeMap.get(id)).filter(Boolean) as Node[]
  const topTraffic = rankedIds.traffic.map(id => nodeMap.get(id)).filter(Boolean) as Node[]

  const maxCpu = Math.max(...topCpu.map(n => n.dynamic?.cpu_usage ?? 0), 1)
  const maxMem = Math.max(...topMem.map(n => n.dynamic ? n.dynamic.used_memory! / n.dynamic.total_memory! : 0), 1)
  const maxTx  = Math.max(...topTraffic.map(n => (n.dynamic?.receive_speed ?? 0) + (n.dynamic?.transmit_speed ?? 0)), 1)

  function RankRow({ label, value, valueStr, color, max, rank, onClick }: {
    label: string; value: number; valueStr: string; color: string; max: number; rank: number; onClick: () => void
  }) {
    const barW = max > 0 ? Math.max(2, (value / max) * 100) : 0
    const alpha = Math.max(0.65, 1 - rank * 0.08)
    const rankColor = rank === 0 ? C_BAD : rank === 1 ? C_WARN : color
    return (
      <div
        onClick={onClick}
        style={{ position: 'relative', padding: '3px 4px 5px', cursor: 'pointer', borderRadius: 3 }}
        className="group"
      >
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity rounded"
          style={{ background: 'hsl(var(--muted) / 0.4)' }} />
        {/* label + value */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
          <span className="truncate text-xs" style={{ color: 'hsl(var(--foreground))', opacity: alpha }}>{label}</span>
          <span className="font-mono tabular-nums text-xs shrink-0" style={{ color: rankColor, opacity: alpha }}>{valueStr}</span>
        </div>
        {/* 斜纹进度条 */}
        <div style={{
          position: 'relative', height: 4,
          border: '1px solid hsl(var(--border) / 0.7)',
          borderRadius: 2,
          background: 'hsl(var(--secondary) / 0.5)',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0, width: `${barW}%`,
            backgroundImage: `repeating-linear-gradient(45deg, ${rankColor} 0 3px, transparent 3px 6px)`,
            opacity: 0.6,
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>
    )
  }

  const col = 'flex-1 min-w-0 px-3 py-2'
  const title = 'text-[10px] font-mono uppercase tracking-widest mb-2 opacity-75'

  return (
    <div className="flex flex-col sm:flex-row">
      {/* Top CPU */}
      <div className={col} style={{ borderRight: '1px solid hsl(var(--border) / 0.3)' }}>
        <div className={title}>TOP CPU</div>
        {topCpu.map((n, i) => {
          const v = n.dynamic!.cpu_usage!
          const c = v >= 85 ? C_BAD : v >= 65 ? C_WARN : C_OK
          return <RankRow key={n.uuid} label={n.meta?.name || n.uuid.slice(0, 8)} value={v} valueStr={`${v.toFixed(1)}%`} color={c} max={maxCpu} rank={i} onClick={() => onSelect(n.uuid)} />
        })}
      </div>

      {/* Top Memory */}
      <div className={col} style={{ borderRight: '1px solid hsl(var(--border) / 0.3)' }}>
        <div className={title}>TOP MEM</div>
        {topMem.map((n, i) => {
          const v = n.dynamic!.used_memory! / n.dynamic!.total_memory! * 100
          const c = v >= 85 ? C_BAD : v >= 65 ? C_WARN : C_OK
          return <RankRow key={n.uuid} label={n.meta?.name || n.uuid.slice(0, 8)} value={v} valueStr={`${v.toFixed(1)}%`} color={c} max={maxMem * 100} rank={i} onClick={() => onSelect(n.uuid)} />
        })}
      </div>

      {/* TOP SPEED */}
      <div className={col}>
        <div className={title}>TOP SPEED</div>
        {topTraffic.map((n, i) => {
          const rx = n.dynamic!.receive_speed ?? 0
          const tx = n.dynamic!.transmit_speed ?? 0
          const total = rx + tx
          return (
            <RankRow
              key={n.uuid}
              label={n.meta?.name || n.uuid.slice(0, 8)}
              value={total}
              valueStr={`↓${fmtSpeed(rx)} ↑${fmtSpeed(tx)}`}
              color={C_OK}
              max={maxTx}
              rank={i}
              onClick={() => onSelect(n.uuid)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── 状态色辅助 ──────────────────────────────────────────────────────────────
function nodeStatus(n: Node): 'ok' | 'warn' | 'alert' {
  if (!n.online) return 'alert'
  const u = deriveUsage(n)
  if ((u.cpu ?? 0) >= 80 || (u.mem ?? 0) >= 85 || (u.disk ?? 0) >= 85) return 'alert'
  if ((u.cpu ?? 0) >= 60 || (u.mem ?? 0) >= 70 || (u.disk ?? 0) >= 70) return 'warn'
  return 'ok'
}

// ── 状态计数组件 ─────────────────────────────────────────────────────────────
type StatusKey = 'ok' | 'warn' | 'alert'

function StatusCounts({
  nodes,
  statusFilter,
  onStatusFilter,
  isMobile = false,
}: {
  nodes: Node[]
  statusFilter: StatusKey | null
  onStatusFilter: (s: StatusKey) => void
  isMobile?: boolean
}) {
  const counts = {
    ok:    nodes.filter(n => nodeStatus(n) === 'ok').length,
    warn:  nodes.filter(n => nodeStatus(n) === 'warn').length,
    alert: nodes.filter(n => nodeStatus(n) === 'alert').length,
  }
  const onlinePct = nodes.length > 0
    ? ((counts.ok + counts.warn) / nodes.length) * 100
    : null

  const rows: { key: StatusKey; label: string; color: string }[] = [
    { key: 'ok',    label: '正常',   color: 'hsl(142 71% 45%)' },
    { key: 'warn',  label: '告警',   color: C_WARN },
    { key: 'alert', label: '严重',   color: C_BAD },
  ]

  return (
    <div
      style={{
        borderRight: isMobile ? 'none' : '1px solid hsl(var(--border) / 0.5)',
        borderBottom: isMobile ? '1px solid hsl(var(--border) / 0.5)' : 'none',
        minWidth: isMobile ? undefined : 'min(180px, 45vw)',
        display: 'flex',
        flexDirection: isMobile ? 'row' : 'column',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 2,
        padding: '8px 10px',
        flexShrink: 0,
      }}
    >
      {rows.map(({ key, label, color }) => {
        const active = statusFilter === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onStatusFilter(key)}
            style={{
              display: 'grid',
              gridTemplateColumns: '11px auto 1fr',
              gap: 10,
              alignItems: 'center',
              padding: '3px 6px',
              margin: '0 -6px',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              background: active ? `${color}22` : 'transparent',
              outline: active ? `1px solid ${color}55` : '1px solid transparent',
              transition: 'background 0.15s, outline-color 0.15s',
              textAlign: 'left',
            }}
          >
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontWeight: 700,
                fontSize: 28,
                lineHeight: 1,
                color: active ? color : 'hsl(var(--foreground))',
                transition: 'color 0.15s',
              }}
            >
              {counts[key]}
            </span>
            <span
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 10,
                letterSpacing: '0.18em',
                color: active ? color : 'hsl(var(--muted-foreground))',
                textTransform: 'uppercase',
                textAlign: 'right',
                transition: 'color 0.15s',
              }}
            >
              {label}
            </span>
          </button>
        )
      })}

      {/* 整体在线率 */}
      {onlinePct != null && (
        <div style={{
          borderTop: '1px dashed hsl(var(--border) / 0.4)',
          marginTop: 4,
          paddingTop: 6,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 9,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'hsl(var(--muted-foreground))',
          }}>
            在线率
          </span>
          <span style={{
            fontFamily: 'ui-monospace, monospace',
            fontWeight: 700,
            fontSize: 13,
            color: onlinePct >= 99 ? 'hsl(142 71% 45%)' :
                   onlinePct >= 90 ? 'hsl(45 90% 52%)' :
                   'hsl(0 72% 55%)',
          }}>
            {onlinePct.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  )
}

// ── 迷你世界地图 ──────────────────────────────────────────────────────────────
function MiniWorldMap({
  nodes,
  onViewMap,
  hidden = false,
}: {
  nodes: Node[]
  onViewMap?: () => void
  hidden?: boolean
}) {
  const W = 320
  const H = 110

  const pins = useMemo(() => {
    const seen = new Map<string, { x: number; y: number; color: string }>()
    for (const n of nodes) {
      const c = resolveCoords(n.meta)
      if (!c) continue
      const [lng, lat] = c
      const x = ((lng + 180) / 360) * W
      const y = ((75 - lat) / 130) * H
      const key = `${Math.round(x)},${Math.round(y)}`
      if (!seen.has(key)) {
        const s = nodeStatus(n)
        seen.set(key, {
          x,
          y,
          color: s === 'alert' ? C_BAD : s === 'warn' ? C_WARN : C_OK,
        })
      }
    }
    return [...seen.values()]
  }, [nodes])

  if (hidden) return null

  return (
    <button
      type="button"
      onClick={onViewMap}
      className="relative h-full min-w-[180px] flex-1 overflow-hidden cursor-pointer"
      style={{
        borderLeft: '1px solid hsl(var(--border) / 0.5)',
        background: 'hsl(var(--card) / 0.4)',
      }}
      title="打开世界地图"
    >
      {/* 大陆轮廓（等经纬度投影） */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full"
        style={{ opacity: 0.22 }}
      >
        <g fill="hsl(var(--foreground))" stroke="hsl(var(--foreground))" strokeWidth="0.4" strokeLinejoin="round">
          {/* 北美 */}
          <polygon points="11,13 22,6 36,4 62,3 90,2 113,22 106,28 98,30 89,42 81,51 75,51 66,46 56,37 52,25 45,18 25,15" />
          {/* 南美 */}
          <polygon points="87,49 107,48 118,55 130,58 128,69 120,76 114,88 106,95 99,101 93,88 89,74 87,62" />
          {/* 欧洲 */}
          <polygon points="149,35 154,30 163,30 170,29 185,30 191,29 188,25 185,18 187,8 182,4 169,13 162,18 155,26 149,35" />
          {/* 非洲 */}
          <polygon points="145,47 153,29 169,29 188,35 198,50 196,67 191,77 184,85 176,85 171,79 168,59 156,59 147,58" />
          {/* 亚洲（含中东/东南亚） */}
          <polygon points="187,8 182,4 222,2 249,3 284,3 308,12 320,22 320,38 295,28 284,31 276,33 267,41 256,48 253,57 248,55 231,50 229,42 220,43 211,49 199,50 198,40 193,30 188,25 185,18 187,8" />
          {/* 澳大利亚 */}
          <polygon points="261,82 263,92 272,92 283,94 293,96 296,88 293,82 289,79 277,76 268,79" />
        </g>
      </svg>

      {/* 节点点 */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full"
      >
        {pins.map(({ x, y, color }, i) => (
          <circle
            key={i}
            cx={x.toFixed(1)}
            cy={y.toFixed(1)}
            r={3}
            fill={color}
            stroke="hsl(var(--background))"
            strokeWidth={0.8}
          />
        ))}
      </svg>

      {/* 右下角标签 */}
      <div
        className="absolute bottom-1 right-1.5 text-[9px] uppercase tracking-[0.15em] font-mono opacity-60 flex items-center gap-1"
        style={{ color: 'hsl(var(--muted-foreground))' }}
      >
        <MapIcon className="w-2.5 h-2.5" />
        Map
      </div>
    </button>
  )
}


export function App() {
  const isMobile = useIsMobile()
  const { config, error: configError } = useConfig()
  const { nodes, errors, loading, visitorStats, fetchNodeTcpHistory, fetchUptimeHistory, fetchIncidentHistory, fetchAggregateTrafficBuckets, fetchNetworkBuckets } = useNodes(config)
  const deferredNodes = useDeferredValue(nodes)
  const navigate = useNavigate()

  const topStickyRef = useRef<HTMLDivElement>(null)
  const [topH, setTopH] = useState(0)
  useEffect(() => {
    const el = topStickyRef.current
    if (!el) return
    const ro = new ResizeObserver(es => {
      for (const e of es) setTopH(Math.round(e.contentRect.height))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])


  const [query, setQuery] = useState('')
  const [activeRegion, setActiveRegion] = useState<string | null>(null)
  const [alertOnly, setAlertOnly] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusKey | null>(null)

  useEffect(() => {
    if (config?.site_name) document.title = config.site_name
  }, [config?.site_name])

  const regionCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const n of deferredNodes.values()) {
      if (n.meta?.hidden) continue
      const r = n.meta?.region?.trim().toUpperCase()
      if (r) map.set(r, (map.get(r) ?? 0) + 1)
    }
    return map
  }, [deferredNodes])

  const allRegions = useMemo(() =>
    [...regionCounts.keys()].sort(),
    [regionCounts],
  )

  useEffect(() => {
    if (activeRegion && !allRegions.includes(activeRegion)) setActiveRegion(null)
  }, [allRegions, activeRegion])

  const allNodes = useMemo(
    () => [...deferredNodes.values()].filter(n => !n.meta?.hidden),
    [deferredNodes],
  )

  const alertCount = useMemo(
    () => allNodes.filter(n => nodeStatus(n) !== 'ok').length,
    [allNodes],
  )

  const list = useMemo(() => {
    let arr = [...nodes.values()].filter(n => !n.meta?.hidden)

    const q = query.trim().toLowerCase()
    if (q) {
      arr = arr.filter(n => {
        const hay = [
          n.uuid,
          n.source,
          n.meta?.name,
          n.meta?.region,
          n.static?.system?.system_host_name,
          n.static?.system?.system_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    }

    if (activeRegion) {
      arr = arr.filter(n => n.meta?.region?.trim().toUpperCase() === activeRegion)
    }

    if (alertOnly) {
      arr = arr.filter(n => nodeStatus(n) !== 'ok')
    }
    if (statusFilter) {
      arr = arr.filter(n => nodeStatus(n) === statusFilter)
    }

    return arr.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1
      const ao = a.meta?.order ?? 0
      const bo = b.meta?.order ?? 0
      if (ao !== bo) return ao - bo
      const an = a.meta?.name || a.uuid
      const bn = b.meta?.name || b.uuid
      return an.localeCompare(bn)
    })
  }, [nodes, query, activeRegion, alertOnly, statusFilter])

  if (configError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>加载 config.json 失败</AlertTitle>
          <AlertDescription>{String(configError.message || configError)}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!config) {
    return <LoadingScreen />
  }

  const logo = config.site_logo || DEFAULT_LOGO
  const empty = list.length === 0
  const hasErrors = errors.length > 0
  const showLoading = loading

  return (
    <>
      <Background />
      <Routes>
        <Route
          path="/node/:uuid"
          element={
            <NodeDetailRoute
              nodes={nodes}
              showSource={(config.site_tokens?.length ?? 0) > 1}
              fetchTcpHistory={fetchNodeTcpHistory}
              fetchIncidentHistory={fetchIncidentHistory}
              fetchNetworkBuckets={fetchNetworkBuckets}
              onlineViewers={null}
            />
          }
        />
        <Route
          path="/map"
          element={
            <MapRoute nodes={allNodes} onSelect={uuid => navigate('/node/' + uuid)} onClose={() => navigate('/')} />
          }
        />
        <Route
          path="*"
          element={
            <div className="min-h-screen flex flex-col">
              <Navbar
                siteName={config.site_name || '节点监控'}
                logo={logo}
                regions={allRegions}
                regionCounts={regionCounts}
                activeRegion={activeRegion}
                alertCount={alertCount}
                alertOnly={alertOnly}
                query={query}
                onlineViewers={visitorStats?.online_viewers ?? null}
                visitorStats={visitorStats}
                onRegionChange={r => setActiveRegion(r)}
                onAlertToggle={() => setAlertOnly(v => !v)}
                onQueryChange={setQuery}
                onHome={() => {
                  setActiveRegion(null)
                  setAlertOnly(false)
                  setStatusFilter(null)
                  setQuery('')
                  navigate('/')
                }}
              />

              <main className="flex-1 min-w-0 pt-11 pb-12">

                <>
                    {/* ── 粘性顶部区域：仅告警 ── */}
                    <div ref={topStickyRef} className="sticky top-11 z-30 backdrop-blur-sm">
                      {!showLoading && allNodes.length > 0 && (
                        <AlertBanner nodes={allNodes} onSelect={uuid => navigate('/node/' + uuid)} />
                      )}
                    </div>

                    {/* ── 非粘性汇总区域 ── */}
                    {!showLoading && allNodes.length > 0 && (
                      <div style={{ margin: '8px 12px 12px', border: '1px solid hsl(var(--border) / 0.55)', borderRadius: 6, overflow: 'hidden', background: 'hsl(var(--card) / 0.45)' }}>
                        {/* 状态计数 | 流量图 | 迷你地图 */}
                        <div style={{
                          borderBottom: '1px solid hsl(var(--border) / 0.35)',
                          display: 'grid',
                          gridTemplateColumns: isMobile ? '1fr' : 'auto 2fr 1fr',
                        }}>
                          <StatusCounts
                            nodes={allNodes}
                            statusFilter={statusFilter}
                            onStatusFilter={s => setStatusFilter(prev => prev === s ? null : s)}
                            isMobile={isMobile}
                          />
                          <div className="min-w-0 overflow-hidden">
                            <TrafficSparkline nodes={allNodes} fetchBuckets={fetchAggregateTrafficBuckets} />
                          </div>
                          <MiniWorldMap nodes={allNodes} onViewMap={() => navigate('/map')} hidden={isMobile} />
                        </div>
                        {/* 访问统计 */}
                        {visitorStats != null && (
                          <VisitorStatsCard stats={visitorStats} isMobile={isMobile} />
                        )}
                        {/* 排行榜 */}
                        <TopRanking nodes={allNodes} onSelect={uuid => navigate('/node/' + uuid)} />
                      </div>
                    )}

                    {/* 加载态 */}
                    <AnimatePresence>
                      {showLoading && !hasErrors && <LoadingScreen key="loading" />}
                    </AnimatePresence>

                    {!showLoading && allNodes.length > 0 && empty && (
                      <div
                        className="py-20 text-center text-sm"
                        style={{ color: 'hsl(var(--muted-foreground))' }}
                      >
                        没有符合条件的节点
                      </div>
                    )}

                    {/* 节点卡片网格 */}
                    {!showLoading && !empty && (
                      <NodeGrid nodes={list} onSelect={uuid => navigate('/node/' + uuid)} fetchUptimeHistory={fetchUptimeHistory} isMobile={isMobile} />
                    )}
                  </>

                {/* 错误提示 */}
                {hasErrors && (
                  <div className="px-3 py-2">
                    <Alert variant="warning">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>{errors.length} 个后端错误</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc pl-5 space-y-1 mt-2">
                          {errors.map((e, i) => (
                            <li key={i}>
                              <b>{e.source}</b>：
                              {e.error instanceof Error ? e.error.message : String(e.error)}
                            </li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </main>

              <Footer text={config.footer} nodes={allNodes} />
              <Toaster />
            </div>
          }
        />
      </Routes>
    </>
  )
}

function MapRoute({ nodes, onSelect, onClose }: {
  nodes: Node[]
  onSelect: (uuid: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40" style={{ background: 'hsl(var(--background))' }}>
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 12, left: 12, zIndex: 10,
          width: 36, height: 36, borderRadius: '50%',
          border: '1px solid hsl(var(--border))',
          background: 'hsl(var(--card))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'hsl(var(--foreground))',
        }}
        aria-label="返回"
      >
        ←
      </button>
      <WorldMap nodes={nodes} onSelect={onSelect} />
    </div>
  )
}

function NodeDetailRoute({ nodes, showSource, fetchTcpHistory, fetchIncidentHistory, fetchNetworkBuckets, onlineViewers }: {
  nodes: Map<string, Node>
  showSource: boolean
  fetchTcpHistory: (uuid: string, fromMs: number) => Promise<TcpPingRecord[]>
  fetchIncidentHistory: (uuid: string, days: number) => Promise<HistorySample[]>
  fetchNetworkBuckets: (uuid: string, from: number, to: number, buckets: number) => Promise<import('./api/methods').SummaryBucket[]>
  onlineViewers: number | null
}) {
  const { uuid } = useParams<{ uuid: string }>()
  const navigate = useNavigate()
  const node = uuid ? (nodes.get(uuid) ?? null) : null
  return (
    <NodeDetail
      node={node}
      onClose={() => navigate('/')}
      showSource={showSource}
      fetchTcpHistory={fetchTcpHistory}
      fetchIncidentHistory={fetchIncidentHistory}
      fetchNetworkBuckets={fetchNetworkBuckets}
      onlineViewers={onlineViewers}
    />
  )
}
