// Draws koke's app icon and favicon from the pixel art below (#20) and writes every size the PWA
// and the browser ask for. Run with `npm run icon` after changing the art or the palette.
//
// Each size is a whole-number enlargement of the grid with the leftover margin filled by the
// background, so pixels stay sharp and nothing is resampled.

import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'

// The app icon: moss heaped on a rectangular tray seen from a little above. Moss is the heatmap's
// shade steps 1–4; r = rim, T = tray, t = feet, . = background.
const ICON = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '.........333333.........',
  '......333232333433......',
  '.....33323323333343.....',
  '...rr33334234323344rr...',
  '...r3223334423434334r...',
  '..rr3344343434443344rr..',
  '..r344243443433434444r..',
  '.rrrrrrrrrrrrrrrrrrrrrr.',
  '.TTTTTTTTTTTTTTTTTTTTTT.',
  '.TTTTTTTTTTTTTTTTTTTTTT.',
  '..TTTTTTTTTTTTTTTTTTTT..',
  '...TTTTTTTTTTTTTTTTTT...',
  '....tt............tt....',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]

// The favicon: the same idea seen from the front, simple enough to read at 16 px.
const FAVICON = [
  '................',
  '................',
  '................',
  '......3343......',
  '....34342433....',
  '...3424134433...',
  '..343143424143..',
  '.34214342431423.',
  '.rrrrrrrrrrrrrr.',
  '.TTTTTTTTTTTTTT.',
  '..TTTTTTTTTTTT..',
  '..tt........tt..',
  '................',
  '................',
  '................',
  '................',
]

type RGB = [number, number, number]

function oklch(L: number, C: number, h: number): RGB {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return linear.map((c) => {
    const v = Math.min(1, Math.max(0, c))
    return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255)
  }) as RGB
}
const over = (fg: RGB, bg: RGB, alpha: number): RGB => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as RGB

// Background, chart-1 and the heatmap's 20/47/73/100% steps come from src/app/index.css (light theme).
// The moss keeps these colours on the dark ground too: the dark theme's own light steps are close
// to the ground and read as holes at icon sizes.
const lightGround = oklch(0.985, 0.006, 110)
const darkGround = oklch(0.19, 0.012, 150)
const chart = oklch(0.5, 0.13, 145)
const moss = {
  '1': over(chart, lightGround, 0.2),
  '2': over(chart, lightGround, 0.47),
  '3': over(chart, lightGround, 0.73),
  '4': chart,
}
type Palette = Record<string, RGB>
const LIGHT: Palette = {
  '.': lightGround,
  ...moss,
  r: oklch(0.56, 0.07, 50),
  T: oklch(0.44, 0.06, 48),
  t: oklch(0.33, 0.045, 45),
}
const DARK: Palette = {
  '.': darkGround,
  ...moss,
  r: oklch(0.6, 0.07, 50),
  T: oklch(0.48, 0.065, 48),
  t: oklch(0.36, 0.05, 45),
}

const hex = (c: RGB) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

// `scale` pixels per cell, centred on a `size` square of background.
function render(art: string[], palette: Palette, size: number, scale: number): Buffer {
  const n = art.length
  const pad = Math.floor((size - n * scale) / 2)
  const rgb = Buffer.alloc(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor((x - pad) / scale)
      const cy = Math.floor((y - pad) / scale)
      const cell = art[cy]?.[cx] ?? '.'
      const c = palette[cell]
      if (!c) throw new Error(`no colour for "${cell}"`)
      rgb.set(c, (y * size + x) * 3)
    }
  }
  return png(size, rgb)
}

// An opaque 8-bit RGB PNG: iOS fills transparent parts of a home-screen icon with black.
function png(size: number, rgb: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// The favicon as pixel rects. It follows the browser's colour scheme, which a PNG cannot.
function svg(art: string[]): string {
  const keys = Object.keys(LIGHT)
  const cls = (k: string) => `c${keys.indexOf(k)}`
  const rules = (p: Palette) => keys.map((k) => `.${cls(k)}{fill:${hex(p[k])}}`).join('')
  const rects: string[] = [`<rect class="${cls('.')}" width="${art.length}" height="${art.length}"/>`]
  art.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      let end = x
      while (end < row.length && row[end] === row[x]) end++
      if (row[x] !== '.') rects.push(`<rect class="${cls(row[x])}" x="${x}" y="${y}" width="${end - x}" height="1"/>`)
      x = end
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${art.length} ${art.length}" shape-rendering="crispEdges">
<style>${rules(LIGHT)}@media (prefers-color-scheme:dark){${rules(DARK)}}</style>
${rects.join('\n')}
</svg>
`
}

mkdirSync('assets/app-icon', { recursive: true })
const out: [string, Buffer | string][] = [
  // 1x sources, for looking at and editing the art in an image editor.
  ['assets/app-icon/icon.png', render(ICON, LIGHT, 24, 1)],
  ['assets/app-icon/favicon.png', render(FAVICON, LIGHT, 16, 1)],
  ['public/icon-180.png', render(ICON, LIGHT, 180, 7)],
  ['public/icon-192.png', render(ICON, LIGHT, 192, 8)],
  ['public/icon-512.png', render(ICON, LIGHT, 512, 21)],
  // Maskable: the art stays inside the central circle (80% of the width) that any mask keeps.
  ['public/icon-maskable-512.png', render(ICON, LIGHT, 512, 14)],
  ['public/favicon-32.png', render(FAVICON, LIGHT, 32, 2)],
  ['public/favicon.svg', svg(FAVICON)],
]
for (const [path, data] of out) writeFileSync(path, data)
console.log(out.map(([p]) => p).join('\n'))
