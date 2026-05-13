import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

const MESSAGES = [
  'INITIALIZING SYSTEM',
  'ESTABLISHING CONNECTION',
  'FETCHING NODE DATA',
  'CALIBRATING SENSORS',
  'ONLINE',
]

const C = 'hsl(var(--foreground))'
const C_DIM = 'hsl(var(--foreground) / 0.15)'
const C_MID = 'hsl(var(--foreground) / 0.5)'

export function LoadingScreen() {
  const [msgIdx, setMsgIdx] = useState(0)
  const [displayed, setDisplayed] = useState('')

  useEffect(() => {
    const target = MESSAGES[msgIdx]
    let i = 0
    setDisplayed('')
    const t = setInterval(() => {
      i++
      setDisplayed(target.slice(0, i))
      if (i >= target.length) {
        clearInterval(t)
        if (msgIdx < MESSAGES.length - 1) {
          setTimeout(() => setMsgIdx(m => m + 1), 600)
        }
      }
    }, 38)
    return () => clearInterval(t)
  }, [msgIdx])

  return (
    <motion.div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center select-none"
      style={{ background: 'hsl(var(--background))' }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* 背景网格 */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `
          linear-gradient(hsl(var(--foreground) / 0.03) 1px, transparent 1px),
          linear-gradient(90deg, hsl(var(--foreground) / 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px',
      }} />

      {/* 扫描线 */}
      <motion.div
        className="absolute inset-x-0 pointer-events-none"
        style={{ height: 1, background: `linear-gradient(90deg, transparent, hsl(var(--foreground) / 0.2), transparent)` }}
        animate={{ top: ['10%', '90%', '10%'] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
      />

      {/* 主动画 */}
      <div style={{ position: 'relative', width: 140, height: 140 }}>
        {/* 最外层慢转环 */}
        <motion.div
          style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: `1px solid ${C_DIM}`,
            borderTopColor: C_MID,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
        />

        {/* 中层反转环 */}
        <motion.div
          style={{
            position: 'absolute', inset: 14, borderRadius: '50%',
            border: `1px solid ${C_DIM}`,
            borderBottomColor: C_MID,
            borderRightColor: 'hsl(var(--foreground) / 0.3)',
          }}
          animate={{ rotate: -360 }}
          transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
        />

        {/* 内层快转环 */}
        <motion.div
          style={{
            position: 'absolute', inset: 28, borderRadius: '50%',
            border: `1.5px solid ${C_DIM}`,
            borderTopColor: C,
            borderRightColor: C_MID,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
        />

        {/* 脉冲点 */}
        {[0, 120, 240].map((deg, i) => (
          <motion.div
            key={i}
            style={{
              position: 'absolute',
              width: 5, height: 5,
              borderRadius: '50%',
              background: C,
              top: '50%', left: '50%',
              transformOrigin: '0 0',
            }}
            animate={{ rotate: [deg, deg + 360] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          >
            <div style={{
              position: 'absolute',
              top: -64, left: -2.5,
              width: 5, height: 5,
              borderRadius: '50%',
              background: C,
            }} />
          </motion.div>
        ))}

        {/* 中心核 */}
        <motion.div
          style={{
            position: 'absolute', inset: 42,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${C} 0%, hsl(var(--foreground) / 0.4) 60%, transparent 100%)`,
          }}
          animate={{ scale: [1, 1.2, 1], opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* 进度点 */}
      <div className="flex gap-1.5 mt-8">
        {MESSAGES.map((_, i) => (
          <motion.div
            key={i}
            style={{
              width: i === msgIdx ? 16 : 4,
              height: 4,
              borderRadius: 2,
              background: i <= msgIdx ? C : C_DIM,
            }}
            animate={{ width: i === msgIdx ? 16 : 4 }}
            transition={{ duration: 0.3 }}
          />
        ))}
      </div>

      {/* 打字机文字 */}
      <div style={{
        marginTop: 12,
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 11,
        letterSpacing: '0.22em',
        color: C_MID,
        minWidth: 220,
        textAlign: 'center',
        minHeight: 20,
      }}>
        {displayed}
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.5, repeat: Infinity }}
          style={{ borderRight: `1.5px solid ${C_MID}`, marginLeft: 1 }}
        />
      </div>
    </motion.div>
  )
}
