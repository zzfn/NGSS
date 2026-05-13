import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HistorySample } from '../types'

type Days = 7 | 14 | 30 | 90

interface Incident {
  start: number       // 第一个离线桶的时间戳
  end: number | null  // 恢复后第一个在线桶的时间戳，null = 仍在进行
  buckets: number     // 离线桶数量
}

interface DayBar {
  day: number
  onlinePct: number   // 0-100；-1 = 无数据（节点未部署）
}

interface Props {
  uuid: string
  online: boolean
  fetchIncidentHistory: (uuid: string, days: number) => Promise<HistorySample[]>
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function detectIncidents(samples: HistorySample[]): Incident[] {
  const incidents: Incident[] = []
  let incidentStart: number | null = null
  let offlineCount = 0

  for (const s of samples) {
    if (!s.online) {
      if (incidentStart === null) {
        incidentStart = s.t
        offlineCount = 1
      } else {
        offlineCount++
      }
    } else {
      if (incidentStart !== null) {
        incidents.push({ start: incidentStart, end: s.t, buckets: offlineCount })
        incidentStart = null
        offlineCount = 0
      }
    }
  }
  if (incidentStart !== null) {
    incidents.push({ start: incidentStart, end: null, buckets: offlineCount })
  }

  return incidents.reverse()
}

function groupByDay(samples: HistorySample[]): DayBar[] {
  const DAY_MS = 86_400_000
  const dayMap = new Map<number, { online: number; total: number }>()
  for (const s of samples) {
    const day = Math.floor(s.t / DAY_MS) * DAY_MS
    const cur = dayMap.get(day) ?? { online: 0, total: 0 }
    cur.total++
    if (s.online) cur.online++
    dayMap.set(day, cur)
  }
  return [...dayMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, { online, total }]) => ({
      day,
      onlinePct: total > 0 ? (online / total) * 100 : -1,
    }))
}

function barColor(pct: number): string {
  if (pct < 0) return 'hsl(var(--border) / 0.3)'
  if (pct >= 99) return 'hsl(142 71% 45%)'
  if (pct >= 95) return 'hsl(45 90% 52%)'
  if (pct >= 80) return 'hsl(30 85% 52%)'
  return 'hsl(0 72% 55%)'
}

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return '<1m'
}

function fmtDatetime(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtDayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export function IncidentTimeline({ uuid, online, fetchIncidentHistory }: Props) {
  const [days, setDays] = useState<Days>(30)
  const [data, setData] = useState<HistorySample[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [hoveredDay, setHoveredDay] = useState<DayBar | null>(null)

  useEffect(() => {
    setData(null)
    setLoading(true)
    fetchIncidentHistory(uuid, days)
      .then(samples => { setData(samples); setLoading(false) })
      .catch(() => { setData([]); setLoading(false) })
  }, [uuid, days, fetchIncidentHistory])

  const dayBars = useMemo(() => data ? groupByDay(data) : [], [data])
  const incidents = useMemo(() => data ? detectIncidents(data) : [], [data])

  const overallPct = useMemo(() => {
    if (!data || data.length === 0) return null
    const onlineCount = data.filter(s => s.online).length
    return (onlineCount / data.length) * 100
  }, [data])

  // 时间范围按钮
  const RangeBtn = useCallback(({ d }: { d: Days }) => (
    <button
      onClick={() => setDays(d)}
      style={{
        fontSize: 10,
        padding: '1px 7px',
        borderRadius: 4,
        cursor: 'pointer',
        background: days === d ? 'hsl(var(--primary))' : 'transparent',
        color: days === d ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))',
        border: `1px solid ${days === d ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
        transition: 'background 0.15s',
      }}
    >
      {d}d
    </button>
  ), [days])

  return (
    <div className="space-y-3">
      {/* 标题行：时间范围 + 总可用率 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <RangeBtn d={7} />
          <RangeBtn d={14} />
          <RangeBtn d={30} />
          <RangeBtn d={90} />
        </div>
        {overallPct != null && (
          <span
            className="text-xs font-mono font-bold tabular-nums"
            style={{
              color: overallPct >= 99 ? 'hsl(142 71% 45%)' :
                overallPct >= 95 ? 'hsl(45 90% 52%)' :
                'hsl(0 72% 55%)',
            }}
          >
            {overallPct.toFixed(2)}% 可用率
          </span>
        )}
      </div>

      {/* 日期柱状图 */}
      <div>
        {loading ? (
          <div
            style={{
              height: 32,
              borderRadius: 4,
              background: 'hsl(var(--border) / 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
              加载中…
            </span>
          </div>
        ) : dayBars.length === 0 ? (
          <div
            style={{
              height: 32,
              borderRadius: 4,
              background: 'hsl(var(--border) / 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="text-[10px]" style={{ color: 'hsl(var(--muted-foreground))' }}>
              暂无历史数据
            </span>
          </div>
        ) : (
          <div
            style={{ display: 'flex', gap: 2, height: 32 }}
            onMouseLeave={() => setHoveredDay(null)}
          >
            {dayBars.map(bar => (
              <div
                key={bar.day}
                title={`${fmtDayLabel(bar.day)}${bar.onlinePct >= 0 ? ' · ' + bar.onlinePct.toFixed(1) + '%' : ' · 无数据'}`}
                style={{
                  flex: 1,
                  borderRadius: 3,
                  background: barColor(bar.onlinePct),
                  opacity: hoveredDay?.day === bar.day ? 1 : 0.8,
                  cursor: 'default',
                  transition: 'opacity 0.1s',
                  outline: hoveredDay?.day === bar.day
                    ? '1.5px solid hsl(var(--foreground) / 0.4)'
                    : 'none',
                }}
                onMouseEnter={() => setHoveredDay(bar)}
              />
            ))}
          </div>
        )}

        {/* 时间标签行 + hover 信息 */}
        <div
          className="flex justify-between text-[10px] mt-1"
          style={{ color: 'hsl(var(--muted-foreground))' }}
        >
          <span>{days}天前</span>
          {hoveredDay ? (
            <span style={{ color: 'hsl(var(--foreground))', fontFamily: 'ui-monospace, monospace' }}>
              {fmtDayLabel(hoveredDay.day)}
              {hoveredDay.onlinePct >= 0
                ? ` · ${hoveredDay.onlinePct.toFixed(1)}%`
                : ' · 无数据'}
            </span>
          ) : (
            <span>现在</span>
          )}
        </div>
      </div>

      {/* 图例 */}
      <div className="flex items-center gap-3">
        {[
          { color: 'hsl(142 71% 45%)', label: '正常 ≥99%' },
          { color: 'hsl(45 90% 52%)', label: '降级 ≥95%' },
          { color: 'hsl(30 85% 52%)', label: '受损 ≥80%' },
          { color: 'hsl(0 72% 55%)', label: '故障 <80%' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <span
              style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block', flexShrink: 0 }}
            />
            <span className="text-[9px]" style={{ color: 'hsl(var(--muted-foreground))' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* 宕机事件列表 */}
      {!loading && data !== null && (
        <div>
          <div
            className="text-[9px] font-bold uppercase tracking-[0.18em] mb-2"
            style={{ color: 'hsl(var(--muted-foreground))', opacity: 0.65 }}
          >
            {incidents.length > 0 ? `宕机事件 · ${incidents.length} 起` : '宕机事件'}
          </div>

          {incidents.length === 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 6,
                background: 'hsl(142 71% 45% / 0.08)',
                border: '1px solid hsl(142 71% 45% / 0.25)',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'hsl(142 71% 45%)',
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span className="text-xs" style={{ color: 'hsl(142 71% 45%)' }}>
                过去 {days} 天运行正常，无宕机记录
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              {incidents.map((inc, i) => {
                const duration = inc.end != null
                  ? inc.end - inc.start
                  : Date.now() - inc.start
                const ongoing = inc.end === null

                return (
                  <div
                    key={i}
                    style={{
                      borderRadius: 6,
                      padding: '10px 12px',
                      background: 'hsl(var(--card))',
                      border: `1px solid ${ongoing ? 'hsl(0 72% 55% / 0.45)' : 'hsl(var(--border) / 0.5)'}`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      {/* 左：状态点 + 时间 */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: ongoing ? 'hsl(0 72% 55%)' : 'hsl(45 90% 52%)',
                            display: 'inline-block',
                            flexShrink: 0,
                            boxShadow: ongoing ? '0 0 6px hsl(0 72% 55%)' : 'none',
                          }}
                        />
                        <span
                          className="text-xs font-mono truncate"
                          style={{ color: 'hsl(var(--foreground))' }}
                        >
                          {fmtDatetime(inc.start)}
                        </span>
                        {ongoing && (
                          <span
                            className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{
                              background: 'hsl(0 72% 55% / 0.15)',
                              color: 'hsl(0 72% 55%)',
                              border: '1px solid hsl(0 72% 55% / 0.3)',
                              flexShrink: 0,
                            }}
                          >
                            进行中
                          </span>
                        )}
                      </div>

                      {/* 右：时长 */}
                      <span
                        className="text-[10px] font-mono font-semibold tabular-nums shrink-0"
                        style={{ color: ongoing ? 'hsl(0 72% 55%)' : 'hsl(var(--muted-foreground))' }}
                      >
                        {fmtDuration(duration)}
                      </span>
                    </div>

                    {/* 恢复时间 */}
                    {inc.end !== null && (
                      <div
                        className="flex items-center gap-2 mt-1.5"
                        style={{ paddingLeft: 15 }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: 'hsl(142 71% 45%)',
                            display: 'inline-block',
                            flexShrink: 0,
                          }}
                        />
                        <span
                          className="text-[10px] font-mono"
                          style={{ color: 'hsl(var(--muted-foreground))' }}
                        >
                          恢复于 {fmtDatetime(inc.end)}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 当前节点实时状态 */}
      <div
        className="flex items-center gap-2 text-[10px]"
        style={{ color: 'hsl(var(--muted-foreground))', opacity: 0.6 }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: online ? 'hsl(142 71% 45%)' : 'hsl(0 72% 55%)',
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        当前状态：{online ? '在线' : '离线'}
        <span style={{ opacity: 0.5 }}>· 数据粒度 1h/桶</span>
      </div>
    </div>
  )
}
