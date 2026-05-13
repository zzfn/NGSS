import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackendPool } from '../api/pool'
import { dynamicSummaryMulti, kvGetMulti, listAgentUuids, queryNodeTcpPings, queryTcpPings, queryTcpPingsLatest, querySummaryBuckets, querySummaryHistory, querySummaryHistoryMulti, staticDataMulti, subscribeDynamicSummary, subscribeViewerCount } from '../api/methods'
import type { DynamicSummaryEvent } from '../api/methods'
import { isOnline } from '../utils/status'
import type { DynamicSummary, HistorySample, Node, NodeMeta, SiteConfig, TcpPingRecord } from '../types'

type Agent = Pick<Node, 'uuid' | 'source' | 'meta' | 'static'>

interface BackendError {
  source: string
  error: unknown
}

const STATIC_FIELDS = ['cpu', 'system']
const DYNAMIC_FIELDS = [
  'cpu_usage',
  'used_memory',
  'total_memory',
  'available_memory',
  'used_swap',
  'total_swap',
  'total_space',
  'available_space',
  'read_speed',
  'write_speed',
  'receive_speed',
  'transmit_speed',
  'total_received',
  'total_transmitted',
  'load_one',
  'load_five',
  'load_fifteen',
  'uptime',
  'boot_time',
  'process_count',
  'tcp_connections',
  'udp_connections',
]
const META_KEYS = [
  'metadata_name',
  'metadata_region',
  'metadata_tags',
  'metadata_hidden',
  'metadata_virtualization',
  'metadata_latitude',
  'metadata_longitude',
  'metadata_order',
]
const DYN_INTERVAL_MS = 2000
const HISTORY_LIMIT = 120
// WebSocket 推送批处理窗口：同 uuid 在该窗口内的多次推送合并为一次 React 更新
const DYNAMIC_FLUSH_MS = 200
const TCP_PING_INTERVAL_MS = 30_000
const TCP_PING_WINDOW_MS = 3 * 3600_000  // 每次查最近 3 小时
const TCP_PING_MAX = 2000                 // 每节点最多保留 2000 条（20s/条 × 3运营商 × 3h ≈ 1620）
const UPTIME_BUCKETS = 80

function emptyMeta(): NodeMeta {
  return { name: '', region: '', tags: [], hidden: false, virtualization: '', lat: null, lng: null, order: 0 }
}

function blankAgent(uuid: string, source: string): Agent {
  return { uuid, source, meta: emptyMeta(), static: {} }
}

function parseMeta(raw: Record<string, unknown>): NodeMeta {
  const lat = Number(raw.metadata_latitude)
  const lng = Number(raw.metadata_longitude)
  const order = Number(raw.metadata_order)
  return {
    name: raw.metadata_name ? String(raw.metadata_name) : '',
    region: raw.metadata_region ? String(raw.metadata_region) : '',
    tags: Array.isArray(raw.metadata_tags) ? raw.metadata_tags.filter(Boolean) : [],
    hidden: Boolean(raw.metadata_hidden),
    virtualization: raw.metadata_virtualization ? String(raw.metadata_virtualization) : '',
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    order: Number.isFinite(order) ? order : 0,
  }
}

function sampleFrom(row: DynamicSummary): HistorySample {
  const memTotal = row.total_memory || 0
  const diskTotal = row.total_space || 0
  return {
    t: row.timestamp,
    online: true,
    cpu: row.cpu_usage ?? null,
    mem: memTotal && row.used_memory != null ? (row.used_memory / memTotal) * 100 : null,
    disk:
      diskTotal && row.available_space != null
        ? ((diskTotal - row.available_space) / diskTotal) * 100
        : null,
    netIn: row.receive_speed ?? 0,
    netOut: row.transmit_speed ?? 0,
  }
}

export function useNodes(config: SiteConfig | null) {
  const [agents, setAgents] = useState<Map<string, Agent>>(new Map())
  const agentsRef = useRef<Map<string, Agent>>(new Map())
  // live 只在 nodes useMemo 中读取，不需要触发完整的状态更新路径，用 ref 存数据 + 版本号触发重渲染
  const liveRef = useRef<Map<string, DynamicSummary>>(new Map())
  const [liveVer, setLiveVer] = useState(0)
  const [history, setHistory] = useState<Map<string, HistorySample[]>>(new Map())
  const [tcpPingMap, setTcpPingMap] = useState<Map<string, TcpPingRecord[]>>(new Map())
  const [errors, setErrors] = useState<BackendError[]>([])
  const [loading, setLoading] = useState(true)
  const [onlineViewers, setOnlineViewers] = useState<number | null>(null)
  const poolRef = useRef<BackendPool | null>(null)
  // 每个 entry（后端 URL）单独记录上次成功拉取的最大 timestamp，用于增量轮询游标
  const lastTcpPingTsRef = useRef<Map<string, number>>(new Map())
  const historyFetchedRef = useRef<Set<string>>(new Set())
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!config?.site_tokens?.length) {
      setLoading(false)
      return
    }
    setLoading(true)
    const pool = new BackendPool(config.site_tokens)
    poolRef.current = pool
    const sourceUuids = new Map<string, string[]>()

    const bootstrap = async () => {
      const errs: BackendError[] = []
      const okList: { source: string; rows: string[] }[] = []
      await Promise.allSettled(
        pool.entries.map(async entry => {
          try {
            const rows = (await listAgentUuids(entry.client)) ?? []
            okList.push({ source: entry.name, rows })
          } catch (e) {
            errs.push({ source: entry.name, error: e })
          }
        }),
      )
      setErrors(prev => [...prev, ...errs])

      const seed = new Map<string, Agent>()
      for (const { source, rows } of okList) {
        sourceUuids.set(source, rows)
        for (const uuid of rows) seed.set(uuid, blankAgent(uuid, source))
      }
      agentsRef.current = seed
      setAgents(seed)

      // meta/static/tcpping/history 不在关键路径上，后台并行加载
      const backgroundLoad = async () => {
        await Promise.all(
          pool.entries.map(async entry => {
            const uuids = sourceUuids.get(entry.name) || []
            if (!uuids.length) return

            // 用通配符替代 N × 8 平铺：请求体降 8 倍，后端权限检查次数同步降低
            // 后端会展开返回每个匹配的 key（与逐 key 查询的响应格式一致）
            const kvItems = uuids.map(u => ({ namespace: u, key: 'metadata_*' }))
            const [meta, stat] = await Promise.allSettled([
              kvGetMulti(entry.client, kvItems),
              staticDataMulti(entry.client, uuids, STATIC_FIELDS),
            ])

            setAgents(prev => {
              const next = new Map(prev)
              agentsRef.current = next

              if (meta.status === 'fulfilled' && meta.value) {
                const grouped = new Map<string, Record<string, unknown>>()
                for (const row of meta.value) {
                  if (!row || row.value == null) continue
                  let bucket = grouped.get(row.namespace)
                  if (!bucket) grouped.set(row.namespace, (bucket = {}))
                  bucket[row.key] = row.value
                }
                for (const uuid of uuids) {
                  const cur = next.get(uuid) ?? blankAgent(uuid, entry.name)
                  next.set(uuid, { ...cur, meta: parseMeta(grouped.get(uuid) ?? {}) })
                }
              }

              if (stat.status === 'fulfilled' && stat.value) {
                for (const row of stat.value) {
                  if (!row.uuid) continue
                  const cur = next.get(row.uuid) ?? blankAgent(row.uuid, entry.name)
                  next.set(row.uuid, { ...cur, static: row })
                }
              }
              return next
            })
          }),
        )

        bootstrapTcpPing().catch(() => {})

        // 预加载历史波形：窗口对齐 HISTORY_LIMIT × DYN_INTERVAL_MS，避免拉了大量数据后被 slice 丢弃
        const now = Date.now()
        const from = now - HISTORY_LIMIT * DYN_INTERVAL_MS
        await Promise.allSettled(
          pool.entries.map(async entry => {
            const uuids = sourceUuids.get(entry.name) || []
            if (!uuids.length) return
            try {
              const rows = await querySummaryHistoryMulti(entry.client, uuids, from, now, DYNAMIC_FIELDS)
              if (!rows?.length) return
              const byUuid = new Map<string, typeof rows>()
              for (const row of rows) {
                if (!row.uuid) continue
                const arr = byUuid.get(row.uuid) ?? []
                arr.push(row)
                byUuid.set(row.uuid, arr)
              }
              setHistory(prev => {
                const next = new Map(prev)
                for (const [uuid, newRows] of byUuid) {
                  const existing = prev.get(uuid) || []
                  const merged = [...newRows.map(sampleFrom), ...existing]
                  const seen = new Set<number>()
                  const deduped = merged.filter(s => { if (seen.has(s.t)) return false; seen.add(s.t); return true })
                  deduped.sort((a, b) => a.t - b.t)
                  next.set(uuid, deduped.slice(-HISTORY_LIMIT))
                }
                return next
              })
            } catch {}
          }),
        )
      }

      // 关键路径：只等动态快照（决定在线状态），meta/history/tcpping 后台并行
      backgroundLoad().catch(() => {})
      await tickDynamicOnce()
      // 与 setLoading 一起批处理：此时 liveRef 已有数据，确保首帧不出现离线闪烁
      setLiveVer(v => v + 1)
      setLoading(false)
    }

    // 一次性快照：bootstrap 时获取初始数据，不轮询
    const tickDynamicOnce = async () => {
      const updates: DynamicSummary[] = []
      await Promise.allSettled(
        pool.entries.map(async entry => {
          const uuids = sourceUuids.get(entry.name) || []
          if (!uuids.length) return
          try {
            const rows = await dynamicSummaryMulti(entry.client, uuids, DYNAMIC_FIELDS)
            for (const row of rows || []) updates.push(row)
          } catch {}
        }),
      )
      if (!updates.length) return

      // 直接 mutate ref，无需克隆整个 Map
      for (const row of updates) liveRef.current.set(row.uuid, row)

      // 仅更新 history，liveVer 由 bootstrap 末尾统一紧急触发（防止 startTransition 延迟导致首帧离线闪烁）
      startTransition(() => {
        setHistory(prev => {
          let next: Map<string, HistorySample[]> | null = null
          for (const row of updates) {
            const arr = prev.get(row.uuid) || []
            const sample = sampleFrom(row)
            if (arr.length && arr[arr.length - 1].t === sample.t) continue
            if (!next) next = new Map(prev)
            const newArr = arr.length >= HISTORY_LIMIT ? arr.slice(1) : arr.slice()
            newArr.push(sample)
            next.set(row.uuid, newArr)
          }
          return next ?? prev
        })
      })
    }

    // WebSocket 推送批处理：避免高频 setLiveVer 触发 nodes useMemo 全量重算
    // 用 Map 自动按 uuid 去重，窗口内多次推送只保留最新一条（动态数据是状态而非事件流，旧值可丢弃）
    let pendingEvents = new Map<string, DynamicSummaryEvent>()
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flushPendingEvents = () => {
      flushTimer = null
      if (!pendingEvents.size) return
      const batch = pendingEvents
      pendingEvents = new Map()

      for (const [uuid, ev] of batch) liveRef.current.set(uuid, ev)

      startTransition(() => {
        setLiveVer(v => v + 1)
        setHistory(prev => {
          let next: Map<string, HistorySample[]> | null = null
          for (const [uuid, ev] of batch) {
            const arr = prev.get(uuid) || []
            const sample = sampleFrom(ev)
            // 时间戳相同说明数据未更新，跳过
            if (arr.length && arr[arr.length - 1].t === sample.t) continue
            if (!next) next = new Map(prev)
            const newArr = arr.length >= HISTORY_LIMIT ? arr.slice(1) : arr.slice()
            newArr.push(sample)
            next.set(uuid, newArr)
          }
          return next ?? prev
        })
      })
    }

    const handleDynamicEvent = (event: DynamicSummaryEvent) => {
      pendingEvents.set(event.uuid, event)
      if (flushTimer == null) {
        flushTimer = setTimeout(flushPendingEvents, DYNAMIC_FLUSH_MS)
      }
    }

    // 将按 uuid 分组的 records 写入 tcpPingMap
    const applyTcpPingByUuid = (byUuid: Map<string, TcpPingRecord[]>, isBootstrap: boolean) => {
      if (!byUuid.size) return
      setTcpPingMap(prev => {
        const next = new Map(prev)
        for (const [uuid, newRecords] of byUuid) {
          if (isBootstrap) {
            // 快照：直接覆盖（此时 Map 为空，无需合并）
            newRecords.sort((a, b) => a.t - b.t)
            next.set(uuid, newRecords)
          } else {
            // 增量：append 新数据，去重后保留最近 TCP_PING_MAX 条
            const existing = prev.get(uuid) ?? []
            const seen = new Set(existing.map(r => `${r.t}-${r.cron}`))
            const fresh = newRecords.filter(r => !seen.has(`${r.t}-${r.cron}`))
            if (!fresh.length) continue
            const merged = [...existing, ...fresh]
            merged.sort((a, b) => a.t - b.t)
            next.set(uuid, merged.slice(-TCP_PING_MAX))
          }
        }
        return next
      })
    }

    // 启动快照：每个 (uuid, cron_source) 只取最新一条，初始化卡片延迟显示
    const bootstrapTcpPing = async () => {
      const results = await Promise.allSettled(
        pool.entries.map(async entry => {
          const rows = await queryTcpPingsLatest(entry.client)
          if (!rows?.length) return
          const byUuid = new Map<string, TcpPingRecord[]>()
          let maxTs = 0
          for (const r of rows) {
            if (!r.uuid || r.timestamp == null) continue
            const record: TcpPingRecord = { t: r.timestamp, cron: r.cron_source ?? '未知', latency: r.task_event_result?.tcp_ping ?? null }
            const arr = byUuid.get(r.uuid) ?? []
            arr.push(record)
            byUuid.set(r.uuid, arr)
            if (r.timestamp > maxTs) maxTs = r.timestamp
          }
          if (maxTs > 0) lastTcpPingTsRef.current.set(entry.name, maxTs)
          applyTcpPingByUuid(byUuid, true)
        }),
      )
      for (const r of results) {
        if (r.status === 'rejected') console.warn('[tcpping bootstrap]', r.reason)
      }
    }

    // 增量轮询：只查上次游标之后的新数据，大幅减少传输量
    const tickTcpPing = async () => {
      const now = Date.now()
      const results = await Promise.allSettled(
        pool.entries.map(async entry => {
          const lastTs = lastTcpPingTsRef.current.get(entry.name)
          // 没有游标说明 bootstrap 失败，fallback 到短窗口补偿
          const from = lastTs != null ? lastTs + 1 : now - TCP_PING_WINDOW_MS
          const rows = await queryTcpPings(entry.client, from, now)
          if (!rows?.length) return
          const byUuid = new Map<string, TcpPingRecord[]>()
          let maxTs = lastTs ?? 0
          for (const r of rows) {
            if (!r.uuid || r.timestamp == null) continue
            const record: TcpPingRecord = { t: r.timestamp, cron: r.cron_source ?? '未知', latency: r.task_event_result?.tcp_ping ?? null }
            const arr = byUuid.get(r.uuid) ?? []
            arr.push(record)
            byUuid.set(r.uuid, arr)
            if (r.timestamp > maxTs) maxTs = r.timestamp
          }
          if (maxTs > (lastTs ?? 0)) lastTcpPingTsRef.current.set(entry.name, maxTs)
          applyTcpPingByUuid(byUuid, false)
        }),
      )
      for (const r of results) {
        if (r.status === 'rejected') console.warn('[tcpping]', r.reason)
      }
    }

    const ac = new AbortController()
    // 收集所有 WebSocket 订阅的取消函数，cleanup 时统一调用
    const unsubscribeFns: Array<() => Promise<void>> = []

    bootstrap()
      .then(async () => {
        // bootstrap 完成后对每个后端建立 WebSocket 订阅
        if (ac.signal.aborted) return
        const results = await Promise.allSettled(
          pool.entries.map(entry =>
            subscribeDynamicSummary(entry.client, handleDynamicEvent),
          ),
        )
        for (const r of results) {
          if (r.status === 'fulfilled') {
            unsubscribeFns.push(r.value)
          } else {
            console.warn('[useNodes] subscribeDynamicSummary 失败:', r.reason)
          }
        }
      })
      .catch((e: unknown) => {
        setErrors(prev => [...prev, { source: '*', error: e }])
        setLoading(false)
      })

    ;(async () => {
      while (!ac.signal.aborted) {
        await new Promise(r => setTimeout(r, TCP_PING_INTERVAL_MS))
        if (!ac.signal.aborted) await tickTcpPing()
      }
    })()

    const clockTimer = setInterval(() => setTick(t => t + 1), 5000)

    subscribeViewerCount(pool.entries[0].client, count => {
      setOnlineViewers(count)
    })
      .then(unsub => unsubscribeFns.push(unsub))
      .catch(e => console.warn('[useNodes] subscribeViewerCount 失败:', e))

    return () => {
      ac.abort()
      clearInterval(clockTimer)
      // 卸载时丢弃未 flush 的推送（pendingEvents 随闭包 GC）
      if (flushTimer != null) clearTimeout(flushTimer)
      // 取消所有 WebSocket 动态摘要订阅
      for (const unsub of unsubscribeFns) {
        unsub().catch(e => console.warn('[useNodes] unsubscribe 失败:', e))
      }
      poolRef.current = null
      lastTcpPingTsRef.current.clear()
      pool.close()
    }
  }, [config])

  const fetchNodeTcpHistory = useCallback(async (uuid: string): Promise<TcpPingRecord[]> => {
    const pool = poolRef.current
    if (!pool) return []
    const now = Date.now()
    const from = now - 6 * 3600_000
    const results: TcpPingRecord[] = []
    await Promise.allSettled(
      pool.entries.map(async entry => {
        try {
          const rows = await queryNodeTcpPings(entry.client, uuid, from, now)
          for (const r of rows || []) {
            if (!r.uuid || r.timestamp == null) continue
            results.push({ t: r.timestamp, cron: r.cron_source ?? '未知', latency: r.task_event_result?.tcp_ping ?? null })
          }
        } catch {}
      }),
    )
    return results.sort((a, b) => a.t - b.t)
  }, [])

  const nodes = useMemo(() => {
    const now = Date.now()
    const out = new Map<string, Node>()
    for (const [uuid, a] of agents) {
      const dyn = liveRef.current.get(uuid) || null
      out.set(uuid, {
        ...a,
        dynamic: dyn,
        history: history.get(uuid) || [],
        tcpPings: tcpPingMap.get(uuid) || [],
        online: isOnline(dyn?.timestamp, now),
      })
    }
    return out
  }, [agents, liveVer, history, tcpPingMap, tick])

  const fetchCardHistory = useCallback((uuid: string, visible: boolean) => {
    if (!visible) return
    if (historyFetchedRef.current.has(uuid)) return
    const pool = poolRef.current
    if (!pool) return
    historyFetchedRef.current.add(uuid)
    const now = Date.now()
    const from = now - HISTORY_LIMIT * DYN_INTERVAL_MS
    Promise.allSettled(
      pool.entries.map(async entry => {
        try {
          const rows = await querySummaryHistory(entry.client, uuid, from, now, DYNAMIC_FIELDS, HISTORY_LIMIT)
          if (!rows?.length) return
          startTransition(() => {
            setHistory(prev => {
              const existing = prev.get(uuid) || []
              // 合并：后端历史 + 已有实时数据，去重，按时间排序，取最近 HISTORY_LIMIT 条
              const merged = [...rows.map(sampleFrom), ...existing]
              const seen = new Set<number>()
              const deduped = merged.filter(s => {
                if (seen.has(s.t)) return false
                seen.add(s.t)
                return true
              })
              deduped.sort((a, b) => a.t - b.t)
              const next = new Map(prev)
              next.set(uuid, deduped.slice(-HISTORY_LIMIT))
              return next
            })
          })
        } catch {}
      }),
    )
  }, [])

  const fetchUptimeHistory = useCallback(async (uuid: string): Promise<HistorySample[]> => {
    const pool = poolRef.current
    if (!pool) return []
    const entry = pool.entries[0]
    if (!entry) return []
    const now = Date.now()
    const from = now - 24 * 3600_000
    try {
      const rows = await querySummaryBuckets(entry.client, { uuid, from, to: now, buckets: UPTIME_BUCKETS, fields: [] }) ?? []
      // 从第一个有数据的桶开始，之前的让 UptimeBars 用灰色 pad 填充
      // 区分"节点未部署（无数据）"和"节点离线（曾在线过）"
      const firstOnline = rows.findIndex(r => r.count > 0)
      const start = firstOnline >= 0 ? firstOnline : rows.length
      return rows.slice(start).map(r => ({
        t: r.t,
        online: r.count > 0,
        cpu: null,
        mem: null,
        disk: null,
        netIn: 0,
        netOut: 0,
      }))
    } catch {
      return []
    }
  }, [])

  const fetchIncidentHistory = useCallback(async (uuid: string, days: number): Promise<HistorySample[]> => {
    const pool = poolRef.current
    if (!pool) return []
    const entry = pool.entries[0]
    if (!entry) return []
    const now = Date.now()
    const from = now - days * 86_400_000
    const buckets = days * 24  // 每天 24 个桶（小时粒度）
    try {
      const rows = await querySummaryBuckets(entry.client, { uuid, from, to: now, buckets, fields: [] }) ?? []
      // 同 fetchUptimeHistory：从第一个有数据的桶开始，之前视为「未部署」
      const firstOnline = rows.findIndex(r => r.count > 0)
      const start = firstOnline >= 0 ? firstOnline : rows.length
      return rows.slice(start).map(r => ({
        t: r.t,
        online: r.count > 0,
        cpu: null,
        mem: null,
        disk: null,
        netIn: 0,
        netOut: 0,
      }))
    } catch {
      return []
    }
  }, [])

  return { nodes, errors, loading, onlineViewers, fetchNodeTcpHistory, fetchCardHistory, fetchUptimeHistory, fetchIncidentHistory }
}
