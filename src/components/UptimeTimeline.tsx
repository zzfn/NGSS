import { useEffect, useRef, useState } from 'react'
import type { HistorySample, Node } from '../types'

// ── 颜色常量 ──────────────────────────────────────────────────────────────────
const C_ONLINE  = 'hsl(142 71% 45%)'
const C_OFFLINE = 'hsl(0 72% 55%)'

const BUCKETS = 80

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  nodes: Node[]
  fetchUptimeHistory: (uuid: string) => Promise<HistorySample[]>
}

// ── 行内联样式工具 ────────────────────────────────────────────────────────────
function uptimePct(slots: HistorySample[]): number | null {
  if (!slots.length) return null
  const online = slots.filter(s => s.online).length
  return (online / slots.length) * 100
}

function pctColor(pct: number): string {
  if (pct >= 99) return 'hsl(142 71% 45%)'
  if (pct >= 95) return 'hsl(45 90% 52%)'
  return 'hsl(0 72% 55%)'
}

// ── 单行节点时间线 ──────────────────────────────────────────────────────────
interface RowProps {
  name: string
  slots: HistorySample[] | null  // null = 加载中
}

function TimelineRow({ name, slots }: RowProps) {
  const pct = slots !== null ? uptimePct(slots) : null

  // 骨架或实际格子
  const cells: React.ReactNode[] = []
  if (slots === null) {
    // 骨架：80 个灰格
    for (let i = 0; i < BUCKETS; i++) {
      cells.push(
        <div
          key={i}
          style={{
            width: 0,               // flex 平均分配
            flexGrow: 1,
            height: 12,
            borderRadius: 1.5,
            background: 'hsl(var(--border))',
            opacity: 0.3,
            flexShrink: 0,
          }}
        />
      )
    }
  } else {
    // 实际数据，前面补空格子保持 80 列对齐
    const pad = Math.max(0, BUCKETS - slots.length)
    for (let i = 0; i < pad; i++) {
      cells.push(
        <div
          key={`pad-${i}`}
          style={{
            width: 0,
            flexGrow: 1,
            height: 12,
            borderRadius: 1.5,
            background: 'hsl(var(--border))',
            opacity: 0.15,
            flexShrink: 0,
          }}
        />
      )
    }
    for (const slot of slots) {
      cells.push(
        <div
          key={slot.t}
          title={new Date(slot.t).toLocaleString()}
          style={{
            width: 0,
            flexGrow: 1,
            height: 12,
            borderRadius: 1.5,
            background: slot.online ? C_ONLINE : C_OFFLINE,
            opacity: 0.85,
            flexShrink: 0,
            cursor: 'default',
          }}
        />
      )
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      {/* 节点名称 */}
      <div
        style={{
          width: 100,
          flexShrink: 0,
          fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
          fontSize: 10,
          color: 'hsl(var(--foreground))',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          opacity: 0.85,
        }}
        title={name}
      >
        {name}
      </div>

      {/* 格子条 */}
      <div style={{ flex: 1, display: 'flex', gap: 1.5, minWidth: 0, overflow: 'hidden' }}>
        {cells}
      </div>

      {/* 在线率百分比 */}
      <div
        style={{
          width: 38,
          flexShrink: 0,
          textAlign: 'right',
          fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
          fontSize: 10,
          color: pct !== null ? pctColor(pct) : 'hsl(var(--muted-foreground))',
        }}
      >
        {pct !== null ? `${pct.toFixed(1)}%` : '···'}
      </div>
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────────────────────────────
export function UptimeTimeline({ nodes, fetchUptimeHistory }: Props) {
  // uuid -> HistorySample[] | null（null = 加载中）
  const [dataMap, setDataMap] = useState<Map<string, HistorySample[] | null>>(new Map())
  // 已经发起过请求的 uuid 集合，防止重复 fetch
  const fetchedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const node of nodes) {
      const { uuid } = node
      if (fetchedRef.current.has(uuid)) continue
      fetchedRef.current.add(uuid)

      // 先将该 uuid 设置为加载状态
      setDataMap(prev => {
        if (prev.has(uuid)) return prev
        const next = new Map(prev)
        next.set(uuid, null)
        return next
      })

      // 发起请求，完成后更新数据
      fetchUptimeHistory(uuid).then(samples => {
        setDataMap(prev => {
          const next = new Map(prev)
          next.set(uuid, samples)
          return next
        })
      }).catch(() => {
        // 请求失败时置空数组，显示为全部空格子
        setDataMap(prev => {
          const next = new Map(prev)
          next.set(uuid, [])
          return next
        })
      })
    }
  }, [nodes, fetchUptimeHistory])

  // 节点列表为空时不渲染
  if (nodes.length === 0) return null

  return (
    <div
      style={{
        borderTop: '1px solid hsl(var(--border) / 0.35)',
        padding: '8px 12px 10px',
      }}
    >
      {/* Section header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
            fontSize: 9,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'hsl(var(--foreground))',
            opacity: 0.75,
          }}
        >
          在线率 · 24H
        </span>
        <span
          style={{
            fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
            fontSize: 9,
            letterSpacing: '0.12em',
            color: 'hsl(var(--muted-foreground))',
          }}
        >
          ← 24h 前 · 现在
        </span>
      </div>

      {/* 节点行列表 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          maxHeight: 220,
          overflowY: 'auto',
        }}
      >
        {nodes.map(node => {
          const name = node.meta?.name || node.uuid.slice(0, 8)
          const slots = dataMap.get(node.uuid) ?? null
          return (
            <TimelineRow
              key={node.uuid}
              name={name}
              slots={slots}
            />
          )
        })}
      </div>
    </div>
  )
}
