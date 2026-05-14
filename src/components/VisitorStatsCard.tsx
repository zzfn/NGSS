import { useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { VisitorStats } from '../api/methods'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'

interface Props {
  stats: VisitorStats
}

const UV_COLOR = 'hsl(199 89% 55%)'
const PV_COLOR = 'hsl(38 92% 55%)'

function TodayStatItem({ rank, uv, pv }: { rank: number; uv: number; pv: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '12px 20px',
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'hsl(var(--foreground))',
          opacity: 0.5,
        }}
      >
        今日
      </span>
      {/* 主信息：你是第几位 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', opacity: 0.7 }}>第</span>
        <span
          style={{
            fontSize: 22,
            fontWeight: 700,
            fontFamily: 'ui-monospace, monospace',
            color: 'hsl(var(--foreground))',
            lineHeight: 1,
          }}
        >
          {rank.toLocaleString()}
        </span>
        <span style={{ fontSize: 11, color: 'hsl(var(--muted-foreground))', opacity: 0.7, whiteSpace: 'nowrap' }}>位访客</span>
      </div>
      {/* 次信息：UV / PV 细节 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'hsl(var(--muted-foreground))', opacity: 0.6 }}>
        <span style={{ color: UV_COLOR, opacity: 1 }}>{uv}</span>
        <span>人</span>
        <span style={{ opacity: 0.4 }}>/</span>
        <span style={{ color: PV_COLOR, opacity: 1 }}>{pv}</span>
        <span>次</span>
      </div>
    </div>
  )
}

function StatItem({ label, uv, pv }: { label: string; uv: number; pv: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '12px 20px',
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'hsl(var(--foreground))',
          opacity: 0.5,
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              fontFamily: 'ui-monospace, monospace',
              color: UV_COLOR,
              lineHeight: 1,
            }}
          >
            {uv.toLocaleString()}
          </span>
          <span style={{ fontSize: 12, color: UV_COLOR, opacity: 0.8 }}>人</span>
        </span>
        <span style={{ color: 'hsl(var(--muted-foreground))', opacity: 0.3, fontSize: 14 }}>/</span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <span
            style={{
              fontSize: 22,
              fontWeight: 700,
              fontFamily: 'ui-monospace, monospace',
              color: PV_COLOR,
              lineHeight: 1,
            }}
          >
            {pv.toLocaleString()}
          </span>
          <span style={{ fontSize: 12, color: PV_COLOR, opacity: 0.8 }}>次</span>
        </span>
      </div>
    </div>
  )
}

function TrendChart({ data, large }: { data: VisitorStats['history']; large?: boolean }) {
  if (data.length === 0) return null

  const formatted = data.map(d => ({
    ...d,
    label: d.date.slice(5), // "2026-05-14" → "05-14"
  }))

  return (
    <div style={{ padding: large ? '4px 0' : '8px 12px 4px' }}>
      <ResponsiveContainer width="100%" height={large ? 240 : 80}>
        <AreaChart data={formatted}>
          <defs>
            <linearGradient id="uvGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={UV_COLOR} stopOpacity={0.25} />
              <stop offset="95%" stopColor={UV_COLOR} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="pvGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={PV_COLOR} stopOpacity={0.25} />
              <stop offset="95%" stopColor={PV_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fontSize: large ? 11 : 9, fill: 'hsl(var(--muted-foreground))', opacity: 0.6 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: large ? 11 : 9, fill: 'hsl(var(--muted-foreground))', opacity: 0.6 }}
            axisLine={false}
            tickLine={false}
            width={large ? 36 : 28}
            allowDecimals={false}
            tickCount={large ? 5 : 4}
          />
          <Tooltip
            cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeOpacity: 0.2 }}
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              fontSize: 11,
              padding: '6px 10px',
            }}
            labelStyle={{ color: 'hsl(var(--foreground))', marginBottom: 4 }}
            formatter={(value: number, name: string) => [
              value.toLocaleString(),
              name === 'uv' ? '人（独立访客）' : '次（浏览次数）',
            ]}
          />
          <Area
            type="monotone"
            dataKey="uv"
            name="uv"
            stroke={UV_COLOR}
            strokeWidth={1.5}
            fill="url(#uvGrad)"
            dot={false}
            activeDot={{ r: 3, fill: UV_COLOR }}
          />
          <Area
            type="monotone"
            dataKey="pv"
            name="pv"
            stroke={PV_COLOR}
            strokeWidth={1.5}
            fill="url(#pvGrad)"
            dot={false}
            activeDot={{ r: 3, fill: PV_COLOR }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function VisitorStatsCard({ stats }: Props) {
  const [open, setOpen] = useState(false)
  const dividerColor = 'hsl(var(--border) / 0.35)'
  const hasHistory = (stats.history?.length ?? 0) > 1

  return (
    <>
      <div
        style={{
          borderTop: `1px solid ${dividerColor}`,
          borderBottom: `1px solid ${dividerColor}`,
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            padding: '6px 14px',
            borderBottom: `1px solid ${dividerColor}`,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontFamily: 'ui-monospace, monospace',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'hsl(var(--foreground))',
            }}
          >
            访问统计
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, overflow: 'hidden', whiteSpace: 'nowrap' }}>
            <span style={{ color: UV_COLOR }}>人</span>
            <span style={{ color: 'hsl(var(--muted-foreground))' }}>独立访客</span>
            <span style={{ color: 'hsl(var(--muted-foreground))', opacity: 0.4 }}>·</span>
            <span style={{ color: PV_COLOR }}>次</span>
            <span style={{ color: 'hsl(var(--muted-foreground))', overflow: 'hidden', textOverflow: 'ellipsis' }}>浏览次数（5分钟去重）</span>
          </span>
          {hasHistory && (
            <button
              onClick={() => setOpen(true)}
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                color: 'hsl(var(--muted-foreground))',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 4,
                opacity: 0.7,
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
            >
              查看趋势 →
            </button>
          )}
        </div>

        {/* 今日 / 昨日 / 累计 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <TodayStatItem rank={stats.today_rank} uv={stats.today_uv} pv={stats.today_pv} />
          <div style={{ borderLeft: `1px solid ${dividerColor}`, borderRight: `1px solid ${dividerColor}` }}>
            <StatItem label="昨日" uv={stats.yesterday_uv} pv={stats.yesterday_pv} />
          </div>
          <StatItem label="累计" uv={stats.all_time_uv} pv={stats.all_time_pv} />
        </div>
      </div>

      {/* 趋势弹窗 */}
      {hasHistory && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle style={{ fontSize: 14, fontWeight: 600 }}>访问趋势</DialogTitle>
            </DialogHeader>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 11, color: 'hsl(var(--muted-foreground))' }}>
              <span><span style={{ color: UV_COLOR }}>■</span> 独立访客（人）</span>
              <span><span style={{ color: PV_COLOR }}>■</span> 浏览次数（次）</span>
            </div>
            <TrendChart data={stats.history} large />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
