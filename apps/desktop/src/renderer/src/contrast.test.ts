import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { avatarColor, avatarFill } from './Avatar'

type Rgb = [number, number, number]
type Theme = 'light' | 'dark'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

/** The token's OKLCH colour for one theme, from its `light-dark(oklch(...), oklch(...))` pair. */
function token(name: string, theme: Theme): Rgb {
  const line = new RegExp(`--${name}:\\s*light-dark\\(([^;]+)\\);`).exec(css)?.[1]
  if (line === undefined) throw new Error(`styles.css has no light-dark token --${name}`)
  const [light, dark] = [...line.matchAll(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g)]
  const match = theme === 'light' ? light : dark
  if (match === undefined) throw new Error(`--${name} lacks an oklch ${theme} value`)
  return oklchToRgb(Number(match[1]), Number(match[2]), Number(match[3]))
}

/** OKLCH to 8-bit sRGB, as the browser paints it. */
function oklchToRgb(lightness: number, chroma: number, hue: number): Rgb {
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const [r, g, bl] = linear.map((c) => {
    const clamped = Math.min(1, Math.max(0, c))
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
    return Math.round(encoded * 255)
  })
  return [r ?? 0, g ?? 0, bl ?? 0]
}

/** `hsl(<h> <s>% <l>%)` to 8-bit sRGB. */
function hslToRgb(value: string): Rgb {
  const parts = /^hsl\((\d+) (\d+)% (\d+)%\)$/.exec(value)
  if (parts === null) throw new Error(`Not an hsl() colour: ${value}`)
  const [h, s, l] = [Number(parts[1]), Number(parts[2]) / 100, Number(parts[3]) / 100]
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [channel(0), channel(8), channel(4)]
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

/** WCAG 2.x contrast ratio. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

describe('avatar initials', () => {
  it('hold 4.5:1 white on the fill across all 360 hues', () => {
    const white: Rgb = [255, 255, 255]
    const worst = Math.min(
      ...Array.from({ length: 360 }, (_, hue) => contrast(white, hslToRgb(avatarFill(hue)))),
    )
    expect(worst).toBeGreaterThanOrEqual(4.5)
  })

  it('paint avatarColor with avatarFill, whatever hue an account id gives', () => {
    for (const id of ['u1', 'u2', '5b10ac8d82e05b22cc7d4ef5', '712020:abc-def', 'x']) {
      const hue = Number(/^hsl\((\d+) /.exec(avatarColor(id))?.[1])
      expect(avatarColor(id), id).toBe(avatarFill(hue))
    }
  })
})

/** Every fill a Tree row takes: rest, hover, the active row, the open row and both (#131). */
const ROW_SURFACES = [
  'canvas',
  'panel',
  'hover',
  'selected',
  'row-focus',
  'row-selected',
  'row-selected-focus',
]

describe.each<Theme>(['light', 'dark'])('%s theme tokens', (theme) => {
  it('keeps placeholders (muted) at 4.5:1 on every surface a field sits on', () => {
    for (const surface of ['canvas', 'panel', 'sidebar', 'hover', 'selected', 'row-focus']) {
      expect(
        contrast(token('muted', theme), token(surface, theme)),
        surface,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the Required text (--danger) at 4.5:1 on the tinted chip (--selected)', () => {
    expect(contrast(token('danger', theme), token('selected', theme))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the grey type icon (--type-rest) at 3:1 on every row background', () => {
    for (const surface of ROW_SURFACES) {
      expect(
        contrast(token('type-rest', theme), token(surface, theme)),
        surface,
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the status glyphs at 3:1 on every row background', () => {
    for (const glyph of ['status-new', 'status-doing', 'status-done']) {
      for (const surface of ROW_SURFACES) {
        expect(
          contrast(token(glyph, theme), token(surface, theme)),
          `${glyph} on ${surface}`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keeps the type colours shown on hover and on Bug at 3:1 on every row background', () => {
    for (const glyph of ['type-epic', 'type-story', 'type-bug', 'type-task']) {
      for (const surface of ROW_SURFACES) {
        expect(
          contrast(token(glyph, theme), token(surface, theme)),
          `${glyph} on ${surface}`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keeps the text on a Customer band (--band, hovered and focused) at 4.5:1', () => {
    for (const surface of ['band', 'band-hover', 'row-focus']) {
      for (const text of ['ink', 'muted']) {
        expect(
          contrast(token(text, theme), token(surface, theme)),
          `${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps the due date icon colours at 3:1 on every row background', () => {
    for (const glyph of ['danger', 'status-doing', 'muted']) {
      for (const surface of ROW_SURFACES) {
        expect(
          contrast(token(glyph, theme), token(surface, theme)),
          `${glyph} on ${surface}`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('keeps field borders at 3:1 on canvas and panel', () => {
    for (const surface of ['canvas', 'panel']) {
      expect(
        contrast(token('field-border', theme), token(surface, theme)),
        surface,
      ).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('Customer band', () => {
  it('reads lighter than the rows in dark, as Linear does, and darker than them in light', () => {
    expect(luminance(token('band', 'dark'))).toBeGreaterThan(luminance(token('canvas', 'dark')))
    expect(luminance(token('band', 'light'))).toBeLessThan(luminance(token('canvas', 'light')))
  })
})

describe('placeholder rule', () => {
  it('paints every placeholder in --muted at full opacity', () => {
    const rule = /::placeholder\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/color:\s*var\(--muted\)/)
    expect(rule).toMatch(/opacity:\s*1\b/)
  })
})
