export const PICKED_THEME = 'none'

export function Background() {
  return (
    <div className="fixed inset-0 -z-10" aria-hidden>
      {/* 扫描线纹理 */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)',
        }}
      />
    </div>
  )
}
