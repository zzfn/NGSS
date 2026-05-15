import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Flag } from './Flag'
import { IncidentTimeline } from './IncidentTimeline'
import { bytes, pct, relativeAge, uptime } from '../utils/format'
import { deriveUsage, displayName, osLabel, virtLabel } from '../utils/derive'
import { ispColor, shortCron } from '../utils/tcpping'
import type { HistorySample, Node, TcpPingRecord } from '../types'
import type { SummaryBucket } from '../api/methods'

// ─── 图表颜色常量 ───────────────────────────────────────────────────────────────
const C_CPU  = 'hsl(199 89% 52%)'
const C_MEM  = 'hsl(283 70% 62%)'
const C_DISK = 'hsl(30 85% 52%)'
const C_IN   = 'hsl(142 71% 45%)'
const C_OUT  = 'hsl(217 91% 60%)'

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 6,
  fontSize: 11,
  color: 'hsl(var(--popover-foreground))',
}

// ─── 时间范围选项 ────────────────────────────────────────────────────────────────
type Range = '1h' | '6h' | '24h' | '7d' | '30d'
const RANGE_MS: Record<Range, number> = {
  '1h':  1  * 3600 * 1000,
  '6h':  6  * 3600 * 1000,
  '24h': 24 * 3600 * 1000,
  '7d':  7  * 86400 * 1000,
  '30d': 30 * 86400 * 1000,
}

// 宕机事件时间线使用天为单位，短范围最少展示 7 天
const RANGE_TO_DAYS: Record<Range, number> = {
  '1h': 7, '6h': 7, '24h': 7, '7d': 7, '30d': 30,
}

// ─── Props ───────────────────────────────────────────────────────────────────────
interface Props {
  node: Node | null
  onClose: () => void
  showSource?: boolean
  fetchTcpHistory?: (uuid: string, fromMs: number) => Promise<TcpPingRecord[]>
  fetchIncidentHistory?: (uuid: string, days: number) => Promise<HistorySample[]>
  fetchNetworkBuckets?: (uuid: string, from: number, to: number, buckets: number) => Promise<SummaryBucket[]>
  inline?: boolean
  onlineViewers?: number | null
}

// ─── 状态指示器逻辑 ──────────────────────────────────────────────────────────────
type PillType = 'ok' | 'warn' | 'alert' | 'offline'

function derivePillType(online: boolean, cpu?: number, mem?: number): PillType {
  if (!online) return 'offline'
  if ((cpu != null && cpu >= 90) || (mem != null && mem >= 90)) return 'alert'
  if ((cpu != null && cpu >= 70) || (mem != null && mem >= 75)) return 'warn'
  return 'ok'
}

const PILL_COLORS: Record<PillType, string> = {
  ok:      'hsl(var(--nx-online))',
  warn:    'hsl(45 90% 55%)',
  alert:   'hsl(0 72% 60%)',
  offline: 'hsl(var(--nx-offline))',
}

// ─── 历史数据工具函数 ─────────────────────────────────────────────────────────────
function mergeHistory(a: HistorySample[], b: HistorySample[]): HistorySample[] {
  const map = new Map<number, HistorySample>()
  for (const s of [...a, ...b]) map.set(s.t, s)
  return [...map.values()].sort((x, y) => x.t - y.t)
}

function filterByRange(data: HistorySample[], range: Range): HistorySample[] {
  const cutoff = Date.now() - RANGE_MS[range]
  return data.filter(s => s.t >= cutoff)
}

// ─── TCP Ping 辅助函数 ────────────────────────────────────────────────────────────
function buildLatencyData(pings: TcpPingRecord[], cronNames: string[]) {
  const BUCKET = 30_000
  const snap = (t: number) => Math.round(t / BUCKET) * BUCKET
  const acc = new Map<number, Map<string, number[]>>()
  for (const p of pings) {
    if (p.latency == null) continue
    const t = snap(p.t)
    const m = acc.get(t) ?? new Map<string, number[]>()
    if (!acc.has(t)) acc.set(t, m)
    const arr = m.get(p.cron) ?? []
    arr.push(p.latency)
    m.set(p.cron, arr)
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, m]) => ({
      t,
      ...Object.fromEntries(
        cronNames.map(c => {
          const vals = m.get(c)
          return [c, vals?.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null]
        })
      ),
    }))
}

function ispStats(pings: TcpPingRecord[], cron: string) {
  const records = pings.filter(p => p.cron === cron)
  const vals = records.filter(p => p.latency != null).map(p => p.latency as number)
  const lossRate = records.length > 0 ? ((records.length - vals.length) / records.length) * 100 : 0
  const avg = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  const jitter =
    vals.length >= 2
      ? vals.slice(1).reduce((s, v, i) => s + Math.abs(v - vals[i]!), 0) / (vals.length - 1)
      : null
  return { avg, jitter, lossRate }
}

// 从每个 ISP 的 ping 记录中提取 sparkline 数据点（桶内中位数）
function pingSparkline(pings: TcpPingRecord[], cron: string): number[] {
  const BUCKET = 30_000
  const snap = (t: number) => Math.round(t / BUCKET) * BUCKET
  const acc = new Map<number, number[]>()
  for (const p of pings.filter(r => r.cron === cron && r.latency != null)) {
    const t = snap(p.t)
    const arr = acc.get(t) ?? []
    arr.push(p.latency as number)
    acc.set(t, arr)
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, vals]) => {
      const sorted = [...vals].sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]!
    })
}

// ─── 最近活动事件推导 ─────────────────────────────────────────────────────────────
interface ActivityEvent {
  type: 'ok' | 'info' | 'warn' | 'alert'
  ts: number
  msg: string
}

function deriveEvents(
  node: Node,
  uptimeHistory: HistorySample[],
  cpu?: number,
): ActivityEvent[] {
  const events: ActivityEvent[] = []
  const d = node.dynamic

  // 上次开机
  if (d?.boot_time) {
    events.push({ type: 'info', ts: d.boot_time * 1000, msg: '系统启动 / 重启' })
  }

  // 当前 CPU 告警
  if (cpu != null && cpu >= 90) {
    events.push({ type: 'alert', ts: d?.timestamp ?? Date.now(), msg: `CPU 超过阈值 (${pct(cpu)})` })
  } else if (cpu != null && cpu >= 70) {
    events.push({ type: 'warn', ts: d?.timestamp ?? Date.now(), msg: `CPU 较高 (${pct(cpu)})` })
  }

  // 从 uptimeHistory 检测状态转换：连续检测 online 字段的翻转
  if (uptimeHistory.length >= 2) {
    for (let i = 1; i < uptimeHistory.length; i++) {
      const prev = uptimeHistory[i - 1]!
      const curr = uptimeHistory[i]!
      if (prev.online && !curr.online) {
        // 在线 → 离线
        events.push({ type: 'alert', ts: curr.t, msg: '节点下线' })
      } else if (!prev.online && curr.online) {
        // 离线 → 恢复
        events.push({ type: 'ok', ts: curr.t, msg: '节点恢复在线' })
      }
    }
  }

  // 从 uptimeHistory 检测 CPU 阈值穿越（仅 >90% 的尖峰）
  for (let i = 1; i < uptimeHistory.length; i++) {
    const prev = uptimeHistory[i - 1]!
    const curr = uptimeHistory[i]!
    if ((prev.cpu ?? 0) < 90 && (curr.cpu ?? 0) >= 90) {
      events.push({ type: 'alert', ts: curr.t, msg: `CPU 突破 90% (${curr.cpu?.toFixed(0)}%)` })
    } else if ((prev.cpu ?? 0) >= 90 && (curr.cpu ?? 0) < 90) {
      events.push({ type: 'ok', ts: curr.t, msg: `CPU 恢复正常 (${curr.cpu?.toFixed(0)}%)` })
    }
  }

  return events.sort((a, b) => b.ts - a.ts).slice(0, 10)
}

const EVENT_DOT_COLOR: Record<ActivityEvent['type'], string> = {
  ok:    'hsl(var(--nx-online))',
  info:  'hsl(217 91% 60%)',
  warn:  'hsl(45 90% 55%)',
  alert: 'hsl(0 72% 60%)',
}

// ─── EWMA 平滑 ───────────────────────────────────────────────────────────────
const EWMA_ALPHA = 0.25

function smoothHistory(data: HistorySample[]): HistorySample[] {
  let lCpu: number | null = null, lMem: number | null = null, lDisk: number | null = null
  let lIn = 0, lOut = 0
  return data.map(s => {
    const a = EWMA_ALPHA
    const cpu  = s.cpu  != null ? (lCpu  != null ? a * s.cpu  + (1 - a) * lCpu  : s.cpu)  : null
    const mem  = s.mem  != null ? (lMem  != null ? a * s.mem  + (1 - a) * lMem  : s.mem)  : null
    const disk = s.disk != null ? (lDisk != null ? a * s.disk + (1 - a) * lDisk : s.disk) : null
    const netIn  = a * s.netIn  + (1 - a) * lIn
    const netOut = a * s.netOut + (1 - a) * lOut
    if (cpu  != null) lCpu  = cpu
    if (mem  != null) lMem  = mem
    if (disk != null) lDisk = disk
    lIn = netIn; lOut = netOut
    return { ...s, cpu, mem, disk, netIn, netOut }
  })
}

function smoothLatency(
  data: { t: number; [k: string]: number | null }[],
  cronNames: string[],
): typeof data {
  const last: Record<string, number | null> = Object.fromEntries(cronNames.map(c => [c, null]))
  return data.map(pt => {
    const out: { t: number; [k: string]: number | null } = { t: pt.t }
    for (const c of cronNames) {
      const raw = pt[c] as number | null
      if (raw == null) { out[c] = null; continue }
      const prev = last[c]
      const v = prev != null ? EWMA_ALPHA * raw + (1 - EWMA_ALPHA) * prev : raw
      out[c] = v
      last[c] = v
    }
    return out
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════════════════════
export function NodeDetail({
  node,
  onClose,
  showSource,
  fetchTcpHistory,
  fetchIncidentHistory,
  fetchNetworkBuckets,
  inline = false,
  onlineViewers,
}: Props) {
  const [detailPings, setDetailPings] = useState<TcpPingRecord[] | null>(null)
  const [loadingPings, setLoadingPings] = useState(false)
  const [incidentData, setIncidentData] = useState<HistorySample[] | null>(null)
  const [networkBuckets, setNetworkBuckets] = useState<SummaryBucket[]>([])
  const [range, setRange] = useState<Range>('6h')
  const [smooth, setSmooth] = useState(true)

  // 加载详细 TCP ping 历史（随时间范围切换重新拉取）
  useEffect(() => {
    if (!node || !fetchTcpHistory) { setDetailPings(null); setLoadingPings(false); return }
    setDetailPings(null)
    setLoadingPings(true)
    fetchTcpHistory(node.uuid, Date.now() - RANGE_MS[range])
      .then(r => { setDetailPings(r); setLoadingPings(false) })
      .catch(() => setLoadingPings(false))
  }, [node?.uuid, range, fetchTcpHistory])

  // 加载宕机历史（随时间范围切换重新拉取，结果同时用于在线率和事件时间线）
  useEffect(() => {
    if (!node || !fetchIncidentHistory) { setIncidentData(null); return }
    setIncidentData(null)
    fetchIncidentHistory(node.uuid, RANGE_TO_DAYS[range])
      .then(data => setIncidentData(data))
      .catch(() => setIncidentData([]))
  }, [node?.uuid, range, fetchIncidentHistory])

  // 加载网络历史（随时间范围切换重新拉取）
  useEffect(() => {
    if (!node || !fetchNetworkBuckets) { setNetworkBuckets([]); return }
    const now = Date.now()
    fetchNetworkBuckets(node.uuid, now - RANGE_MS[range], now, 60)
      .then(data => setNetworkBuckets(data ?? []))
      .catch(() => setNetworkBuckets([]))
  }, [node?.uuid, range, fetchNetworkBuckets])

  // ESC 关闭 & body overflow 控制
  useEffect(() => {
    if (!node || inline) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [node, onClose, inline])

  // ── 派生数据 ──────────────────────────────────────────────────────────────
  const u = useMemo(() => node ? deriveUsage(node) : null, [node])
  const d = node?.dynamic ?? null
  const s = node?.static?.system
  const cpu = node?.static?.cpu
  const tags = node?.meta?.tags ?? []
  const virt = node ? virtLabel(node) : ''

  // 从宕机历史截取最近 24h 作为在线率条的数据源
  const uptimeHistory = useMemo(() => {
    if (!incidentData) return []
    const cutoff = Date.now() - 24 * 3600_000
    return incidentData.filter(s => s.t >= cutoff)
  }, [incidentData])

  const allHistory = useMemo(() => {
    if (!node) return []
    return mergeHistory(uptimeHistory, node.history)
  }, [node, uptimeHistory])

  const filteredHistory = useMemo(() => {
    const raw = filterByRange(allHistory, range)
    return smooth ? smoothHistory(raw) : raw
  }, [allHistory, range, smooth])

  const pings = useMemo(() => detailPings ?? node?.tcpPings ?? [], [detailPings, node])
  const cronNames = useMemo(() => [...new Set(pings.map(p => p.cron))].sort(), [pings])

  const filteredPings = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS[range]
    return pings.filter(p => p.t >= cutoff)
  }, [pings, range])

  const latencyData = useMemo(() => {
    const raw = buildLatencyData(filteredPings, cronNames)
    return smooth ? smoothLatency(raw, cronNames) : raw
  }, [filteredPings, cronNames, smooth])

  const stats = useMemo(
    () => Object.fromEntries(cronNames.map(c => [c, ispStats(filteredPings, c)])),
    [filteredPings, cronNames],
  )

  // 在线率统计（最多取 48 槽）
  const uptimeSlots = useMemo(() => uptimeHistory.slice(-48), [uptimeHistory])
  const uptimePct = useMemo(() => {
    if (uptimeSlots.length === 0) return null
    const online = uptimeSlots.filter(s => s.online).length
    return Math.round((online / uptimeSlots.length) * 1000) / 10
  }, [uptimeSlots])

  // StatusPill
  const pillType = useMemo(
    () => node ? derivePillType(node.online, u?.cpu, u?.mem) : 'offline',
    [node, u],
  )
  const pillLabel = useMemo(() => {
    if (pillType === 'offline') return 'OFFLINE'
    if (pillType === 'alert') return `ALERT · CPU ${pct(u?.cpu)}`
    if (pillType === 'warn') return 'WARN'
    return 'ONLINE'
  }, [pillType, u])

  // 平均 ping
  const avgPing = useMemo(() => {
    const allVals = pings.filter(p => p.latency != null).map(p => p.latency as number)
    if (allVals.length === 0) return null
    return allVals.reduce((s, v) => s + v, 0) / allVals.length
  }, [pings])

  const pingLoss = useMemo(() => {
    if (pings.length === 0) return null
    const lost = pings.filter(p => p.latency == null).length
    return (lost / pings.length) * 100
  }, [pings])

  // 网络历史（server buckets → HistorySample，range 变化时重新拉取）
  const networkHistory = useMemo(
    () => networkBuckets
      .filter(b => b.count > 0)
      .map(b => ({
        t: b.t,
        online: true as const,
        cpu: null,
        mem: null,
        disk: null,
        netIn:  (b.receive_speed  as number | null) ?? 0,
        netOut: (b.transmit_speed as number | null) ?? 0,
      })),
    [networkBuckets],
  )

  // 网络峰值（优先用 server buckets，回退到实时历史）
  const netPeak = useMemo(() => {
    const src = networkHistory.length > 0 ? networkHistory : allHistory
    if (src.length === 0) return null
    const maxIn  = Math.max(...src.map(h => h.netIn ?? 0))
    const maxOut = Math.max(...src.map(h => h.netOut ?? 0))
    return { in: maxIn, out: maxOut }
  }, [networkHistory, allHistory])

  // swap 百分比
  const swapPct = d?.total_swap && d.used_swap != null
    ? (d.used_swap / d.total_swap) * 100 : null

  // 选定范围内磁盘变化量
  const diskDelta = useMemo(() => {
    const vals = filteredHistory.map(s => s.disk).filter((v): v is number => v != null)
    if (vals.length < 2) return null
    return vals[vals.length - 1]! - vals[0]!
  }, [filteredHistory])

  // 最近活动
  const events = useMemo(
    () => node ? deriveEvents(node, uptimeHistory, u?.cpu) : [],
    [node, uptimeHistory, u],
  )

  // 磁盘预警颜色
  const diskColor = (u?.disk ?? 0) > 80 ? 'hsl(45 90% 55%)' : undefined

  if (!node || !u) return null

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={
        inline
          ? 'h-full overflow-y-auto'
          : 'fixed inset-0 z-50 overflow-y-auto'
      }
      style={{ background: 'hsl(var(--background))' }}
    >
      {/* ── 顶部导航栏 ────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-10 backdrop-blur border-b"
        style={{
          background: 'hsl(var(--background) / 0.85)',
          borderColor: 'hsl(var(--border))',
        }}
      >
        <div className={inline ? 'px-3 py-2' : 'max-w-7xl mx-auto px-4 sm:px-6 py-2'}>
          <div className="flex items-center gap-3 min-w-0">
            {/* 返回按钮 */}
            <button
              onClick={onClose}
              aria-label="返回"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: '1px solid hsl(var(--border))',
                background: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'hsl(var(--foreground))',
                flexShrink: 0,
              }}
            >
              ←
            </button>

            {/* Flag + 节点名 */}
            <Flag code={node.meta?.region} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="font-bold text-lg leading-tight truncate"
                  style={{ color: 'hsl(var(--foreground))' }}
                >
                  {displayName(node)}
                </span>
                {showSource && (
                  <span
                    className="text-xs hidden sm:inline"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    · {node.source}
                  </span>
                )}
                {node.meta?.region && (
                  <span
                    className="text-xs"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    · {node.meta.region}
                  </span>
                )}
                {virt && (
                  <span
                    className="text-xs"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    · {virt}
                  </span>
                )}
              </div>
            </div>

            {/* 在线人数 */}
            {onlineViewers != null && onlineViewers > 0 && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono shrink-0" style={{ color: 'hsl(142 71% 45%)' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(142 71% 45%)', boxShadow: '0 0 5px hsl(142 71% 45%)', animation: 'live-pulse-wl 1.4s ease-in-out infinite', display: 'inline-block' }} />
                <span style={{ fontWeight: 700 }}>{onlineViewers}</span>
                <span style={{ opacity: 0.75 }}>人围观</span>
              </span>
            )}

            {/* 时间范围 + Status Pill + 时间戳 */}
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {/* 图表控制：平滑 + 时间范围 */}
              <div className="hidden sm:flex items-center gap-1">
                <SmoothToggle smooth={smooth} onSmooth={setSmooth} />
                <span style={{ width: 1, height: 12, background: 'hsl(var(--border))', display: 'inline-block', margin: '0 4px' }} />
                {(['1h', '6h', '24h', '7d', '30d'] as Range[]).map(r => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      background: range === r ? 'hsl(var(--primary))' : 'transparent',
                      color: range === r ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
                      border: `1px solid ${range === r ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                      transition: 'background 0.15s, color 0.15s',
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <StatusPill type={pillType} label={pillLabel} />
              <span
                className="text-xs font-mono hidden sm:block"
                style={{ color: 'hsl(var(--muted-foreground))' }}
              >
                {relativeAge(d?.timestamp)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 主体内容 ─────────────────────────────────────────────────────── */}
      <div className={inline ? 'px-3 py-4 space-y-4' : 'max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5'}>

        {/* ── Stats Strip 7列 ──────────────────────────────────────────── */}
        <div
          className="grid gap-px"
          style={{
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            background: 'hsl(var(--border))',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <StatCell
            label="CPU"
            value={pct(u.cpu)}
            sub={
              d?.load_one != null
                ? `LA ${d.load_one.toFixed(1)}`
                : undefined
            }
            valueColor={
              (u.cpu ?? 0) >= 90 ? 'hsl(0 72% 60%)' :
              (u.cpu ?? 0) >= 70 ? 'hsl(45 90% 55%)' : undefined
            }
          />
          <StatCell
            label="内存"
            value={pct(u.mem)}
            sub={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : undefined}
            valueColor={
              (u.mem ?? 0) >= 90 ? 'hsl(0 72% 60%)' :
              (u.mem ?? 0) >= 75 ? 'hsl(45 90% 55%)' : undefined
            }
          />
          <StatCell
            label="磁盘"
            value={pct(u.disk)}
            sub={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : undefined}
            valueColor={diskColor}
          />
          <StatCell
            label="网络"
            value={`↓ ${bytes(u.netIn ?? 0)}/s`}
            sub={`↑ ${bytes(u.netOut ?? 0)}/s`}
            valueColor={
              (u.netIn ?? 0) >= 3e6 ? 'hsl(0 72% 60%)' :
              (u.netIn ?? 0) >= 1e6  ? 'hsl(45 90% 55%)' : undefined
            }
            subColor={
              (u.netOut ?? 0) >= 3e6 ? 'hsl(0 72% 60%)' :
              (u.netOut ?? 0) >= 1e6  ? 'hsl(45 90% 55%)' : undefined
            }
          />
          <StatCell
            label="运行时长"
            value={uptime(d?.uptime) ?? '—'}
            sub={
              d?.boot_time
                ? `自 ${new Date(d.boot_time * 1000).toLocaleDateString()}`
                : undefined
            }
          />
          <StatCell
            label="平均延迟"
            value={avgPing != null ? `${avgPing.toFixed(0)} ms` : '—'}
            sub={pingLoss != null ? `丢包 ${pingLoss.toFixed(1)}%` : undefined}
            valueColor={
              avgPing == null ? undefined :
              avgPing >= 200 ? 'hsl(0 72% 60%)' :
              avgPing >= 100 ? 'hsl(45 90% 55%)' : undefined
            }
            subColor={
              pingLoss == null ? undefined :
              pingLoss >= 5 ? 'hsl(0 72% 60%)' :
              pingLoss >= 1 ? 'hsl(45 90% 55%)' : undefined
            }
          />
          <StatCell
            label="更新时间"
            value={relativeAge(d?.timestamp)}
            sub={node.online ? 'healthy' : 'offline'}
            valueColor={!node.online ? 'hsl(var(--nx-offline))' : undefined}
          />
        </div>

        {/* ── 主区域：左侧图表 + 右侧面板 ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
          {/* 左列：图表区 */}
          <div className="space-y-4">
            {/* 资源趋势图 */}
            <Panel
              title="资源趋势"
            >
              <div className="space-y-2">
                <ResourceMini data={filteredHistory} dataKey="cpu"  label="CPU"  color={C_CPU}  currentVal={u.cpu} />
                <ResourceMini data={filteredHistory} dataKey="mem"  label="内存"  color={C_MEM}  currentVal={u.mem} />
                <ResourceMini data={filteredHistory} dataKey="disk" label="磁盘"  color={C_DISK} currentVal={u.disk} />
              </div>
            </Panel>

            {/* 网络吞吐量图（镜像式） */}
            <Panel title="网络吞吐量">
              <NetworkChart data={networkHistory.length >= 2 ? networkHistory : filteredHistory} peak={netPeak} />
            </Panel>

            {/* TCP Ping 三网延迟 */}
            {cronNames.length > 0 && (
              <Panel
                title={loadingPings ? 'TCP Ping 延迟  加载中…' : 'TCP Ping · 三网延迟'}
              >
                {/* ISP 统计卡片 */}
                <div
                  className="grid gap-2 mb-3"
                  style={{ gridTemplateColumns: `repeat(${Math.min(cronNames.length, 3)}, 1fr)` }}
                >
                  {cronNames.map((cron, i) => {
                    const { avg, jitter, lossRate } = stats[cron]!
                    return (
                      <div
                        key={cron}
                        className="rounded p-2.5 space-y-1"
                        style={{
                          background: 'hsl(var(--card))',
                          border: `1px solid ${ispColor(cron, i)}44`,
                        }}
                      >
                        <div
                          className="flex items-center gap-1.5 font-semibold text-xs"
                          style={{ color: ispColor(cron, i) }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: ispColor(cron, i),
                              display: 'inline-block',
                              flexShrink: 0,
                            }}
                          />
                          {shortCron(cron)}
                        </div>
                        <div
                          className="text-xl font-bold font-mono tabular-nums"
                          style={{ color: 'hsl(var(--foreground))' }}
                        >
                          {avg != null ? `${avg.toFixed(0)} ms` : '—'}
                        </div>
                        <div className="text-[10px] space-y-0.5" style={{ color: 'hsl(var(--muted-foreground))' }}>
                          <div>抖动 {jitter != null ? `${jitter.toFixed(1)} ms` : '—'}</div>
                          <div style={{ color: lossRate > 0 ? 'hsl(0 72% 60%)' : undefined }}>
                            丢包 {lossRate.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* 延迟折线图 */}
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={latencyData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
                      <XAxis
                        dataKey="t"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        scale="time"
                        tickFormatter={t => new Date(t as number).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={60}
                      />
                      <YAxis
                        unit=" ms"
                        width={48}
                        tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                        tickLine={false}
                        axisLine={false}
                        domain={['auto', 'auto']}
                        padding={{ top: 12, bottom: 12 }}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelFormatter={t => new Date(t as number).toLocaleTimeString()}
                        formatter={(v: unknown, name: string) =>
                          v == null
                            ? ['超时', shortCron(name)]
                            : [`${(v as number).toFixed(1)} ms`, shortCron(name)]
                        }
                      />
                      {cronNames.map((cron, i) => (
                        <Line
                          key={cron}
                          type="monotone"
                          dataKey={cron}
                          name={cron}
                          stroke={ispColor(cron, i)}
                          strokeWidth={1.5}
                          strokeDasharray={undefined}
                          dot={false}
                          connectNulls
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            )}
            {/* 宕机事件时间线 */}
            {fetchIncidentHistory && (
              <Panel title="宕机事件时间线">
                <IncidentTimeline
                  online={node.online}
                  days={RANGE_TO_DAYS[range]}
                  data={incidentData}
                />
              </Panel>
            )}
          </div>

          {/* 右列：信息面板 */}
          <div className="space-y-4">
            {/* 系统信息 */}
            <Panel title="系统信息">
              <KV k="主机名" v={s?.system_host_name} />
              <KV k="区域" v={node.meta?.region} />
              <KV k="来源" v={showSource ? node.source : undefined} />
              <KV k="操作系统" v={osLabel(node)} />
              <KV k="内核" v={s?.system_kernel || s?.system_kernel_version} />
              <KV k="架构" v={s?.cpu_arch || s?.arch} />
              <KV
                k="硬件"
                v={
                  cpu?.physical_cores != null
                    ? `${cpu.physical_cores} vCPU · ${bytes(d?.total_memory ?? 0)}`
                    : cpu?.per_core?.length
                      ? `${cpu.per_core.length} 核 · ${bytes(d?.total_memory ?? 0)}`
                      : d?.total_memory
                        ? bytes(d.total_memory)
                        : null
                }
              />
              <KV k="虚拟化" v={virt || undefined} />
              {tags.length > 0 && (
                <div
                  className="flex justify-between gap-3 text-xs py-1 flex-wrap"
                  style={{ borderTop: '1px solid hsl(var(--border) / 0.25)' }}
                >
                  <span
                    className="uppercase tracking-[0.15em] text-[10px] font-semibold"
                    style={{ color: 'hsl(var(--muted-foreground))' }}
                  >
                    标签
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {tags.map(t => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{
                          background: 'hsl(var(--muted))',
                          color: 'hsl(var(--foreground))',
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            {/* 网络与负载 */}
            <Panel title="网络与负载">
              <KV k="累计接收" v={d?.total_received != null ? bytes(d.total_received) : undefined} />
              <KV k="累计发送" v={d?.total_transmitted != null ? bytes(d.total_transmitted) : undefined} />
              <KV k="磁盘读" v={d?.read_speed != null ? `${bytes(d.read_speed)}/s` : undefined} />
              <KV k="磁盘写" v={d?.write_speed != null ? `${bytes(d.write_speed)}/s` : undefined} />
              <KV k="进程数" v={d?.process_count != null ? String(d.process_count) : undefined} />
              <KV
                k="TCP / UDP"
                v={
                  d?.tcp_connections != null || d?.udp_connections != null
                    ? `${d?.tcp_connections ?? '—'} / ${d?.udp_connections ?? '—'}`
                    : null
                }
              />
              <KV k="运行时长" v={uptime(d?.uptime) ?? undefined} />
              <KV k="数据更新" v={relativeAge(d?.timestamp)} />
            </Panel>

            {/* 在线状态日历 */}
            <Panel
              title="在线状态 · 24h"
              action={
                uptimePct !== null ? (
                  <span
                    className="text-xs font-mono font-bold tabular-nums"
                    style={{
                      color:
                        uptimePct === 100 ? 'hsl(var(--nx-online))' :
                        uptimePct < 80  ? 'hsl(var(--nx-offline))' :
                        'hsl(45 90% 55%)',
                    }}
                  >
                    {uptimePct.toFixed(1)}%
                  </span>
                ) : undefined
              }
            >
              <UptimeCalendar slots={uptimeSlots} online={node.online} />
            </Panel>

          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// 子组件
// ═══════════════════════════════════════════════════════════════════════════════

// ── Panel 容器 ───────────────────────────────────────────────────────────────
function Panel({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: 'hsl(var(--card) / 0.6)',
        border: '1px solid hsl(var(--border) / 0.6)',
      }}
    >
      <div
        className="flex items-center justify-between mb-3 pb-2"
        style={{ borderBottom: '1px solid hsl(var(--border) / 0.4)' }}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-[0.22em]"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  )
}

// ── Stats Strip 单格 ─────────────────────────────────────────────────────────
function StatCell({
  label,
  value,
  sub,
  valueColor,
  subColor,
}: {
  label: string
  value: string
  sub?: string
  valueColor?: string
  subColor?: string
}) {
  return (
    <div
      className="px-3 py-3 flex flex-col gap-1"
      style={{ background: 'hsl(var(--card) / 0.6)' }}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-[0.18em]"
        style={{ color: 'hsl(var(--muted-foreground))' }}
      >
        {label}
      </span>
      <span
        className="font-bold font-mono tabular-nums text-sm leading-none"
        style={{ color: valueColor ?? 'hsl(var(--foreground))' }}
      >
        {value}
      </span>
      {sub && (
        <span
          className="text-[10px] font-mono tabular-nums truncate"
          style={{ color: subColor ?? 'hsl(var(--muted-foreground))' }}
        >
          {sub}
        </span>
      )}
    </div>
  )
}

// ── StatusPill ───────────────────────────────────────────────────────────────
function StatusPill({ type, label }: { type: PillType; label: string }) {
  const color = PILL_COLORS[type]
  const pulse = type !== 'ok'
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.15em]"
      style={{
        background: `${color}22`,
        border: `1px solid ${color}55`,
        color,
      }}
    >
      <span
        className={pulse ? 'animate-pulse' : ''}
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {label}
    </div>
  )
}

// ── 平滑按钮 ─────────────────────────────────────────────────────────────────
function SmoothToggle({ smooth, onSmooth }: { smooth: boolean; onSmooth: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onSmooth(!smooth)}
      style={{
        fontSize: 10, padding: '1px 7px', borderRadius: 4, cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s',
        background: smooth ? 'hsl(var(--primary))' : 'transparent',
        color: smooth ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
        border: `1px solid ${smooth ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
      }}
    >
      平滑
    </button>
  )
}

// ── 图表控制栏（时间范围 + 平滑） ────────────────────────────────────────────
function ChartControls({
  range, onRange, smooth, onSmooth,
}: {
  range: Range; onRange: (r: Range) => void
  smooth: boolean; onSmooth: (v: boolean) => void
}) {
  const btnBase: React.CSSProperties = {
    fontSize: 10, padding: '1px 7px', borderRadius: 4, cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  }
  return (
    <div className="flex items-center gap-1.5">
      {/* 平滑 */}
      <button
        onClick={() => onSmooth(!smooth)}
        style={{
          ...btnBase,
          background: smooth ? 'hsl(var(--primary))' : 'transparent',
          color: smooth ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
          border: `1px solid ${smooth ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
        }}
      >
        平滑
      </button>
      {/* 分隔 */}
      <span style={{ width: 1, height: 12, background: 'hsl(var(--border))', display: 'inline-block' }} />
      {/* 时间范围 */}
      {(['1h', '6h', '24h', '7d', '30d'] as Range[]).map(r => (
        <button
          key={r}
          onClick={() => onRange(r)}
          style={{
            ...btnBase,
            background: range === r ? 'hsl(var(--primary))' : 'transparent',
            color: range === r ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
            border: `1px solid ${range === r ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
          }}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

// ── KV 行 ────────────────────────────────────────────────────────────────────
function KV({ k, v }: { k: string; v: ReactNode }) {
  if (v == null || v === '') return null
  return (
    <div
      className="flex justify-between gap-3 text-xs py-1"
      style={{ borderBottom: '1px solid hsl(var(--border) / 0.25)' }}
    >
      <span
        className="uppercase tracking-[0.15em] text-[10px] font-semibold shrink-0"
        style={{ color: 'hsl(var(--muted-foreground))' }}
      >
        {k}
      </span>
      <span className="font-mono text-right truncate tabular-nums" style={{ color: 'hsl(var(--foreground))' }}>
        {v}
      </span>
    </div>
  )
}

// ── 图例项 ────────────────────────────────────────────────────────────────────
function LegendItem({ color, label, dash }: { color: string; label: string; dash?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <svg width={20} height={2} style={{ flexShrink: 0 }}>
        <line
          x1={0} y1={1} x2={20} y2={1}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={dash}
        />
      </svg>
      <span className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground))' }}>{label}</span>
    </div>
  )
}

// ── 网络吞吐量图 ──────────────────────────────────────────────────────────────
function NetworkChart({
  data,
  peak,
}: {
  data: HistorySample[]
  peak: { in: number; out: number } | null
}) {
  const chartData = useMemo(
    () => data
      .filter(s => s.netIn > 0 || s.netOut > 0)
      .map(s => ({
        t: s.t,
        netIn:  s.netIn  / 1e6,
        netOut: s.netOut / 1e6,
      })),
    [data],
  )

  return (
    <div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
            <defs>
              <linearGradient id="grad-in" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C_IN}  stopOpacity={0.3} />
                <stop offset="100%" stopColor={C_IN}  stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad-out" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C_OUT} stopOpacity={0.2} />
                <stop offset="100%" stopColor={C_OUT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              scale="time"
              tickFormatter={t => new Date(t as number).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              minTickGap={60}
            />
            <YAxis
              tickFormatter={v => {
                const n = v as number
                if (n === 0) return '0'
                if (n >= 1) return `${n.toFixed(n >= 10 ? 0 : 1)} MB/s`
                if (n >= 0.001) return `${(n * 1024).toFixed(0)} KB/s`
                return `${(n * 1e6).toFixed(0)} B/s`
              }}
              width={64}
              tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              domain={(['auto', 'auto'] as const)}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={t => new Date(t as number).toLocaleTimeString()}
              formatter={(v: unknown, name: string) => {
                const n = v as number
                const label = name === 'netIn' ? '↓ 下行' : '↑ 上行'
                return [n >= 1 ? `${n.toFixed(2)} MB/s` : `${(n * 1024).toFixed(0)} KB/s`, label]
              }}
            />
            <Area type="monotone" dataKey="netIn"  stroke={C_IN}  strokeWidth={1.5} fill="url(#grad-in)"  dot={false} connectNulls isAnimationActive={false} />
            <Area type="monotone" dataKey="netOut" stroke={C_OUT} strokeWidth={1.5} fill="url(#grad-out)" dot={false} connectNulls isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 mt-2 px-1">
        <LegendItem color={C_IN} label="↓ 下行" />
        <LegendItem color={C_OUT} label="↑ 上行" />
        {peak && (
          <span className="text-[10px] ml-auto" style={{ color: 'hsl(var(--muted-foreground))' }}>
            峰值 ↓{(peak.in / 1e6).toFixed(1)} ↑{(peak.out / 1e6).toFixed(1)} MB/s
          </span>
        )}
      </div>
    </div>
  )
}

// ── 在线状态日历格 ────────────────────────────────────────────────────────────
function UptimeCalendar({ slots, online }: { slots: HistorySample[]; online: boolean }) {
  const display = slots.length > 0 ? slots : []

  function cellColor(slot: HistorySample): string {
    return slot.online ? 'hsl(var(--nx-online))' : 'hsl(var(--nx-offline))'
  }

  if (display.length === 0) {
    // 用当前节点在线状态渲染单个占位符
    return (
      <div>
        <div
          className="w-full rounded"
          style={{
            height: 8,
            background: online ? 'hsl(var(--nx-online))' : 'hsl(var(--nx-offline))',
            opacity: 0.5,
          }}
        />
        <div
          className="flex justify-between text-[10px] mt-1"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          <span>24h 前</span>
          <span>现在</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${display.length}, minmax(0, 1fr))` }}
      >
        {display.map((slot, i) => (
          <div
            key={i}
            title={new Date(slot.t).toLocaleString()}
            style={{
              aspectRatio: '1',
              borderRadius: 2,
              background: cellColor(slot),
              opacity: 0.85,
            }}
          />
        ))}
      </div>
      <div
        className="flex justify-between text-[10px] mt-1"
        style={{ color: 'hsl(var(--muted-foreground))' }}
      >
        <span>24h 前</span>
        <span>现在</span>
      </div>
    </div>
  )
}

// ── Mini SVG Sparkline ───────────────────────────────────────────────────────
function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) {
    return <div style={{ height: 18, borderBottom: `1px solid ${color}44` }} />
  }

  const W = 200
  const H = 18
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W
    const y = H - ((v - min) / range) * (H - 2) - 1
    return `${x},${y}`
  })

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ display: 'block' }}
    >
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ── 资源行：左侧大数字 + 右侧迷你面积图 ──────────────────────────────────────
function ResourceRow({
  data,
  dataKey,
  label,
  color,
  currentVal,
  sub,
  isLast = false,
}: {
  data: HistorySample[]
  dataKey: 'cpu' | 'mem' | 'disk'
  label: string
  color: string
  currentVal?: number
  sub: string
  isLast?: boolean
}) {
  const isAlert = (currentVal ?? 0) >= 90
  const isWarn  = !isAlert && (currentVal ?? 0) >= 70
  const valueColor = isAlert ? 'hsl(0 72% 60%)' : isWarn ? 'hsl(45 90% 55%)' : color
  const chartData = data.filter(s => s[dataKey] != null)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '148px 1fr',
        gap: 12,
        borderBottom: isLast ? 'none' : '1px dashed hsl(var(--border) / 0.5)',
        paddingBottom: isLast ? 0 : 14,
        marginBottom: isLast ? 0 : 14,
        alignItems: 'center',
      }}
    >
      {/* 左：彩色竖线 + 标签 + 大百分比 + sub */}
      <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 10 }}>
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'hsl(var(--muted-foreground))',
            marginBottom: 2,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 30,
            fontWeight: 800,
            lineHeight: 1,
            color: valueColor,
            fontFamily: 'ui-monospace, monospace',
            marginBottom: 4,
          }}
        >
          {currentVal != null ? currentVal.toFixed(0) : '—'}
          <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.7 }}>%</span>
        </div>
        <div
          style={{
            fontSize: 10,
            fontFamily: 'ui-monospace, monospace',
            color: 'hsl(var(--muted-foreground))',
            lineHeight: 1.4,
          }}
        >
          {sub || ' '}
        </div>
      </div>

      {/* 右：面积图 + X轴时间 + 90% 阈值线 */}
      <div style={{ height: 76 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 16 }}>
            <defs>
              <linearGradient id={`rg-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={t => new Date(t as number).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              minTickGap={60}
              tickCount={3}
            />
            <YAxis
              hide
              domain={[0, 100]}
              padding={{ top: 4, bottom: 4 }}
            />
            {dataKey !== 'disk' && (
              <ReferenceLine y={90} stroke={color} strokeDasharray="2 3" strokeOpacity={0.4} />
            )}
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={t => new Date(t as number).toLocaleTimeString()}
              formatter={(v: unknown) => [`${(v as number).toFixed(1)}%`, label]}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#rg-${dataKey})`}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── 资源迷你图（CPU / 内存 / 磁盘各自独立） ──────────────────────────────────
function ResourceMini({
  data,
  dataKey,
  label,
  color,
  currentVal,
}: {
  data: HistorySample[]
  dataKey: 'cpu' | 'mem' | 'disk'
  label: string
  color: string
  currentVal?: number
}) {
  const isAlert = (currentVal ?? 0) >= 90
  const isWarn  = !isAlert && (currentVal ?? 0) >= 70
  const valueColor = isAlert ? 'hsl(0 72% 60%)' : isWarn ? 'hsl(45 90% 55%)' : color
  const chartData = data.filter(s => s[dataKey] != null)

  return (
    <div
      className="rounded px-3 py-2"
      style={{
        background: 'hsl(var(--card))',
        border: `1px solid ${isAlert ? 'hsl(0 72% 60% / 0.4)' : isWarn ? 'hsl(45 90% 55% / 0.35)' : 'hsl(var(--border))'}`,
        display: 'grid',
        gridTemplateColumns: '80px 1fr',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {/* 左：标签 + 百分比 */}
      <div>
        <div
          className="text-[10px] font-bold uppercase tracking-[0.15em] mb-0.5"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          {label}
        </div>
        <div
          className="text-base font-bold font-mono tabular-nums leading-none"
          style={{ color: valueColor }}
        >
          {pct(currentVal)}
        </div>
      </div>
      {/* 右：图表 */}
      <div style={{ height: 48 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide type="number" domain={['dataMin', 'dataMax']} scale="time" />
            <YAxis hide domain={[0, 100]} padding={{ top: 4, bottom: 4 }} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={t => new Date(t as number).toLocaleTimeString()}
              formatter={(v: unknown) => [`${(v as number).toFixed(1)}%`, label]}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#grad-${dataKey})`}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
