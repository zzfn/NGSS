const THEMES = ['starship', 'leading'] as const

export function Background() {
  const base = import.meta.env.BASE_URL
  const picked = THEMES[Date.now() % THEMES.length]
  return (
    <div className="fixed inset-0 -z-10" aria-hidden>
      <video
        src={`${base}${picked}.mp4`}
        className="w-full h-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        poster={`${base}${picked}.webp`}
      />
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(to bottom, hsl(var(--background) / 0.3) 0%, hsl(var(--background) / 0.7) 100%)',
      }} />
    </div>
  )
}
