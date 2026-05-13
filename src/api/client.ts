import { Client } from 'rpc-websockets'

const CONNECT_TIMEOUT_MS = 8000

let seq = 0
const nextRequestId = () =>
  `${++seq}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (data: any) => void

/** rpc-websockets Client 含 subscribe/unsubscribe 的完整接口（类型声明在 bundler 模式下解析有限，用接口补全） */
interface RpcWebSocketClient {
  call(method: string, params?: Record<string, unknown> | unknown[], timeout?: number): Promise<unknown>
  on(event: string, handler: AnyHandler): void
  once(event: string, handler: AnyHandler): void
  off(event: string, handler: AnyHandler): void
  close(code?: number, data?: string): void
}

/**
 * 表示一个已建立的 jsonrpsee subscription，重连后需要用这些信息重新建立
 */
interface SubscriptionState {
  subscribeMethod: string
  unsubscribeMethod: string
  /** 用户传入的原始 handler */
  userHandler: AnyHandler
  /** rpc-websockets 上注册的包装 handler（处理 {subscription, result} 解包 + sub_id 过滤）*/
  wrappedHandler: AnyHandler
  /** 当前 subscription id（重连后会更新）*/
  subId: unknown
}

export class RpcClient {
  private token: string
  private client: RpcWebSocketClient
  opened: Promise<void>
  /** 活跃的 subscription 状态列表，重连时遍历重新建立 */
  private subs: SubscriptionState[] = []
  private firstOpen = true

  constructor(url: string, token: string) {
    this.token = token
    this.client = new Client(
      url,
      {
        autoconnect: true,
        reconnect: true,
        reconnect_interval: 2000,
        max_reconnects: Number.POSITIVE_INFINITY,
      },
      nextRequestId,
    ) as unknown as RpcWebSocketClient

    this.opened = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.client.off('open', onOpen)
        this.client.off('error', onError)
      }
      const onOpen = () => {
        cleanup()
        resolve()
      }
      const onError = (e: Error) => {
        cleanup()
        reject(new Error(`无法连接 ${url}: ${e?.message || 'WebSocket error'}`))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`连接 ${url} 超时`))
      }, CONNECT_TIMEOUT_MS)
      this.client.once('open', onOpen)
      this.client.once('error', onError)
    })

    // 监听重连 open 事件，自动恢复所有 jsonrpsee subscription
    this.client.on('open', () => {
      if (this.firstOpen) {
        this.firstOpen = false
        return
      }
      for (const sub of this.subs) {
        // 重新调用订阅 RPC 拿新的 sub_id，并替换旧 id
        this.client
          .call(sub.subscribeMethod, { token: this.token })
          .then(newId => {
            sub.subId = newId
          })
          .catch(e => console.warn(`[RpcClient] 重连后 re-subscribe "${sub.subscribeMethod}" 失败:`, e))
      }
    })
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeout = 10000) {
    await this.opened
    return this.client.call(method, { token: this.token, ...params }, timeout) as Promise<T>
  }

  /**
   * 订阅 jsonrpsee 服务端推送事件。
   *
   * 协议说明：
   * - 客户端调用 `subscribeMethod` RPC，服务端返回 sub_id
   * - 服务端后续推送的 notification 形如：
   *   `{ jsonrpc, method: "<subscribeMethod>", params: { subscription: <sub_id>, result: <T> } }`
   *   （rpc-websockets 会基于 `method` 字段 emit 事件，所以可以用 `on(subscribeMethod, ...)` 接收）
   * - 取消订阅时调用 `unsubscribeMethod` RPC，并传入 sub_id
   *
   * @param subscribeMethod jsonrpsee 订阅 RPC 完整方法名（含命名空间前缀，如 `agent_subscribe_dynamic_summary`）
   * @param unsubscribeMethod jsonrpsee 取消订阅 RPC 完整方法名
   * @param handler 事件回调，参数为推送的 item 对象
   * @returns 取消订阅函数
   */
  async subscribe<T>(
    subscribeMethod: string,
    unsubscribeMethod: string,
    handler: (data: T) => void,
  ): Promise<() => Promise<void>> {
    await this.opened

    const state: SubscriptionState = {
      subscribeMethod,
      unsubscribeMethod,
      userHandler: handler as AnyHandler,
      // 包装：从 jsonrpsee notification params 中解出 `result` 字段，再按 sub_id 过滤
      wrappedHandler: (params: unknown) => {
        if (!params || typeof params !== 'object') return
        const p = params as { subscription?: unknown; result?: T }
        // 同一连接上可能有多个相同 method 的订阅，按 sub_id 过滤
        if (p.subscription !== state.subId) return
        if (p.result !== undefined) handler(p.result)
      },
      subId: undefined,
    }

    // 注册 notification 监听（事件名 = 订阅 RPC 方法名）
    this.client.on(subscribeMethod, state.wrappedHandler)

    // 调用 jsonrpsee 订阅 RPC，拿到 sub_id
    const subId = await this.client.call(subscribeMethod, { token: this.token })
    state.subId = subId

    this.subs.push(state)

    // 返回取消订阅函数
    return async () => {
      this.client.off(subscribeMethod, state.wrappedHandler)
      const idx = this.subs.indexOf(state)
      if (idx !== -1) this.subs.splice(idx, 1)
      try {
        // jsonrpsee unsubscribe 参数形式为 { subscription: <sub_id> }
        // 参考 NodeGet-board/src/composables/useLogs.ts 中已验证的协议
        await this.client.call(unsubscribeMethod, { subscription: state.subId })
      } catch (e) {
        console.warn(`[RpcClient] unsubscribe "${unsubscribeMethod}" 失败:`, e)
      }
    }
  }

  close() {
    this.client.close()
  }
}
