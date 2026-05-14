import type { RpcClient } from './client'
import type { DynamicSummary, StaticData } from '../types'

// 订阅服务端动态摘要推送事件
export interface DynamicSummaryEvent extends DynamicSummary {
  // 后端推送格式与 DynamicSummary 完全一致（uuid + timestamp + 所有字段）
}

export const subscribeDynamicSummary = (
  c: RpcClient,
  handler: (event: DynamicSummaryEvent) => void,
): Promise<() => Promise<void>> =>
  c.subscribe<DynamicSummaryEvent>(
    'agent_subscribe_dynamic_summary',
    'agent_unsubscribe_dynamic_summary',
    handler,
  )

export const listAgentUuids = (c: RpcClient) =>
  c.call<{ uuids?: string[] }>('nodeget-server_list_all_agent_uuid', {}).then(r => r?.uuids || [])

export const activeConnections = (c: RpcClient) =>
  c.call<number>('nodeget-server_active_connections', {}).then(r => r ?? 0)

export const subscribeViewerCount = (
  c: RpcClient,
  handler: (count: number) => void,
): Promise<() => Promise<void>> =>
  c.subscribe<number>(
    'nodeget-server_subscribe_viewer_count',
    'nodeget-server_unsubscribe_viewer_count',
    handler,
  )

export const staticDataMulti = (c: RpcClient, uuids: string[], fields: string[]) =>
  c.call<StaticData[]>('agent_static_data_multi_last_query', { uuids, fields })

export const dynamicSummaryMulti = (c: RpcClient, uuids: string[], fields: string[]) =>
  c.call<DynamicSummary[]>('agent_dynamic_summary_multi_last_query', { uuids, fields })

export const querySummaryHistoryMulti = (
  c: RpcClient,
  uuids: string[],
  from: number,
  to: number,
  fields: string[],
) =>
  c.call<DynamicSummary[]>('agent_query_dynamic_summary_history_multi', {
    query: { uuids, from, to, fields },
  })

export const querySummaryHistory = (
  c: RpcClient,
  uuid: string,
  from: number,
  to: number,
  fields: string[],
  limit?: number,
) =>
  c.call<DynamicSummary[]>('agent_query_dynamic_summary', {
    query: {
      fields,
      condition: [
        { uuid },
        { timestamp_from_to: [from, to] },
        ...(limit != null ? [{ limit }] : []),
      ],
    },
  })

export interface SummaryBucket {
  t: number
  count: number
  [field: string]: number | null | undefined
}

export const querySummaryBuckets = (
  c: RpcClient,
  query: { uuid: string; from: number; to: number; buckets: number; fields: string[] },
) => c.call<SummaryBucket[]>('agent_query_dynamic_summary_buckets', { query })

export const querySummaryBucketsMulti = (
  c: RpcClient,
  query: { uuids: string[]; from: number; to: number; buckets: number; fields: string[] },
) => c.call<SummaryBucket[]>('agent_query_dynamic_summary_buckets_multi', { query })

export interface VisitorDailyPoint {
  date: string
  pv: number
  uv: number
}

export interface VisitorStats {
  today_rank: number
  today_pv: number
  today_uv: number
  all_time_pv: number
  all_time_uv: number
  yesterday_pv: number
  yesterday_uv: number
  online_viewers: number
  history?: VisitorDailyPoint[]
}

/** 订阅访客统计，连接时立即推送当前数据，之后每次有新访问都会收到更新 */
export const subscribeVisitorStats = (
  c: RpcClient,
  handler: (stats: VisitorStats) => void,
): Promise<() => Promise<void>> =>
  c.subscribe<VisitorStats>(
    'nodeget-server_subscribe_visitor_stats',
    'nodeget-server_unsubscribe_visitor_stats',
    handler,
  )

/** 记录一次访问（服务端 IP 提取 + 5分钟去重），fire-and-forget */
export function recordVisit(backendUrl: string): void {
  const httpUrl = backendUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
  fetch(`${httpUrl}/nodeget/record-visit`, { method: 'POST' }).catch(() => {})
}

export const kvGetMulti = (
  c: RpcClient,
  items: { namespace: string; key: string }[],
) => c.call<{ namespace: string; key: string; value: unknown }[]>('kv_get_multi_value', { namespace_key: items })

export interface TcpPingRow {
  uuid: string
  timestamp: number | null
  success: boolean | null
  task_event_result: { tcp_ping?: number } | null
  cron_source: string | null
}

export const queryTcpPingsLatest = (c: RpcClient) =>
  c.call<TcpPingRow[]>('task_query_latest_per_node', { task_type: 'tcp_ping' })

export const queryTcpPings = (c: RpcClient, from: number, to: number, limit?: number) =>
  c.call<TcpPingRow[]>('task_query', {
    task_data_query: {
      condition: [
        { type: 'tcp_ping' },
        { timestamp_from_to: [from, to] },
        ...(limit != null ? [{ limit }] : []),
      ],
    },
  })

export const queryNodeTcpPings = (c: RpcClient, uuid: string, from: number, to: number, limit?: number) =>
  c.call<TcpPingRow[]>('task_query', {
    task_data_query: {
      condition: [
        { type: 'tcp_ping' },
        { uuid },
        { timestamp_from_to: [from, to] },
        ...(limit != null ? [{ limit }] : []),
      ],
    },
  })
