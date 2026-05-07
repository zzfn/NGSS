import { useEffect, useMemo, useState, useDeferredValue } from 'react'
import { AnimatePresence } from 'motion/react'
import { AlertTriangle } from 'lucide-react'
import { LoadingScreen } from './components/LoadingScreen'
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert'
import { useConfig } from './hooks/useConfig'
import { useNodes } from './hooks/useNodes'
import { Background } from './components/Background'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { NodeCard } from './components/NodeCard'
import { WorldMap } from './components/WorldMap'
import { NodeDetail } from './components/NodeDetail'
import { TagFilter } from './components/TagFilter'
import { SidebarPanel } from './components/SidebarPanel'
import { cn } from './utils/cn'
import type { View } from './types'

const DEFAULT_LOGO = `${import.meta.env.BASE_URL}logo.png`

function initialView(): View {
  return 'cards'
}


function readHash() {
  return decodeURIComponent(window.location.hash.slice(1)) || null
}

export function App() {
  const { config, error: configError } = useConfig()
  const { nodes, errors, loading, fetchNodeTcpHistory, fetchCardHistory, fetchUptimeHistory } = useNodes(config)
  const deferredNodes = useDeferredValue(nodes)

  const [view, setView] = useState<View>(initialView)
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [activeRegion, setActiveRegion] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(readHash)
  const [mobileSidebar, setMobileSidebar] = useState(false)

  useEffect(() => {
    if (config?.site_name) document.title = config.site_name
  }, [config?.site_name])

  useEffect(() => {
    const onHash = () => setSelected(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const target = selected ? `#${encodeURIComponent(selected)}` : ''
    if (window.location.hash === target) return
    if (selected) {
      window.location.hash = encodeURIComponent(selected)
    } else {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [selected])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const n of deferredNodes.values()) {
      if (n.meta?.hidden) continue
      for (const t of n.meta?.tags ?? []) set.add(t)
    }
    return [...set].sort()
  }, [deferredNodes])

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
    if (activeTag && !allTags.includes(activeTag)) setActiveTag(null)
  }, [allTags, activeTag])

  useEffect(() => {
    if (activeRegion && !allRegions.includes(activeRegion)) setActiveRegion(null)
  }, [allRegions, activeRegion])

  const list = useMemo(() => {
    let arr = [...deferredNodes.values()].filter(n => !n.meta?.hidden)
    if (activeRegion) arr = arr.filter(n => n.meta?.region?.trim().toUpperCase() === activeRegion)
    if (activeTag) arr = arr.filter(n => n.meta?.tags?.includes(activeTag))

    const q = query.trim().toLowerCase()
    if (q) {
      arr = arr.filter(n => {
        const hay = [
          n.uuid,
          n.source,
          n.meta?.name,
          n.meta?.region,
          n.meta?.virtualization,
          n.static?.system?.system_host_name,
          n.static?.system?.system_name,
          ...(n.meta?.tags ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
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
  }, [deferredNodes, query, activeTag, activeRegion])

  const selectedNode = selected ? nodes.get(selected) || null : null


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
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        加载中…
      </div>
    )
  }

  const logo = config.site_logo || DEFAULT_LOGO
  const empty = list.length === 0
  const hasErrors = errors.length > 0
  const allNodes = [...deferredNodes.values()].filter(n => !n.meta?.hidden)

  return (
    <div className="min-h-screen flex flex-col">
      <Background />

      {/* 顶部导航栏 */}
      <Navbar
        siteName={config.site_name || '节点监控'}
        logo={logo}
        regions={allRegions}
        regionCounts={regionCounts}
        activeRegion={activeRegion}
        onRegionChange={setActiveRegion}
        onMenuOpen={() => setMobileSidebar(true)}
      />

      {/* 移动端侧边栏抽屉 */}
      <div
        className={cn('fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden', mobileSidebar ? 'opacity-100' : 'opacity-0 pointer-events-none')}
        onClick={() => setMobileSidebar(false)}
      />
      <aside className={cn(
        'fixed left-0 top-0 bottom-0 z-50 w-64 overflow-y-auto sidebar-warm transition-transform duration-200 lg:hidden',
        mobileSidebar ? 'translate-x-0' : '-translate-x-full',
      )}>
        <SidebarPanel nodes={allNodes} onViewMap={() => { setView('map'); setMobileSidebar(false) }} />
      </aside>

      {/* 主体：侧边栏 + 内容区 */}
      <div className="flex flex-1 pt-[60px]">
        {/* 左侧边栏（桌面端） */}
        <aside className="w-52 shrink-0 self-start sticky top-[60px] max-h-[calc(100vh-60px)] overflow-y-auto scrollbar-none sidebar-warm hidden lg:block">
          <SidebarPanel nodes={allNodes} onViewMap={() => setView('map')} />
        </aside>

        {/* 右侧主内容 */}
        <main className="flex-1 min-w-0 px-4 py-4 space-y-4">

          {/* 地图视图 */}
          {view === 'map' && (
            <div className="space-y-3 max-w-4xl mx-auto">
              <WorldMap nodes={list} onSelect={setSelected} />
            </div>
          )}

          {view !== 'map' && (<>
          {/* 筛选栏 */}
          <TagFilter tags={allTags} active={activeTag} onChange={setActiveTag} />

          {/* 加载状态 */}
          <AnimatePresence>
            {loading && !hasErrors && <LoadingScreen key="loading" />}
          </AnimatePresence>

          {!loading && empty && hasErrors && (
            <div className="py-20 text-center text-muted-foreground">暂无节点</div>
          )}

          {/* 卡片视图 */}
          {!loading && !empty && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {list.map(n => (
                <NodeCard key={n.uuid} node={n} />
              ))}
            </div>
          )}
          </>)}

          {/* 错误提示 */}
          {hasErrors && (
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
          )}
        </main>
      </div>

      <Footer text={config.footer} />

      <NodeDetail
        node={selectedNode}
        onClose={() => setSelected(null)}
        showSource={(config.site_tokens?.length ?? 0) > 1}
        fetchTcpHistory={fetchNodeTcpHistory}
        fetchUptimeHistory={fetchUptimeHistory}
      />
    </div>
  )
}
