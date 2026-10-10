import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

type Rgb = [number, number, number]
type Theme = 'light' | 'dark'

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8')
const css = read('./styles.css')

/** The token's colour for one theme, from its `light-dark(oklch(...), oklch(...))` pair. */
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

describe.each<Theme>(['light', 'dark'])('%s row state fills', (theme) => {
  const against = (name: string, other: string) => contrast(token(name, theme), token(other, theme))

  it('rises from hover to focus to selected to selected and focused, each step distinct', () => {
    const steps = ['canvas', 'hover', 'row-focus', 'row-selected', 'row-selected-focus']
    const ratios = steps.map((name) => against(name, 'canvas'))
    for (let i = 1; i < steps.length; i++) {
      expect(ratios[i], steps[i]).toBeGreaterThan(ratios[i - 1] ?? 0)
    }
    // Focus and selected differ by more than rounding, with no help from hue.
    expect(against('row-selected', 'row-focus')).toBeGreaterThanOrEqual(1.05)
    expect(against('row-selected-focus', 'row-selected')).toBeGreaterThanOrEqual(1.05)
  })

  it('keeps the ink and secondary text at 4.5:1 on every row fill', () => {
    for (const fill of ['row-focus', 'row-selected', 'row-selected-focus']) {
      expect(against('ink', fill), `ink on ${fill}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(against('muted', 'row-focus'), 'muted on row-focus').toBeGreaterThanOrEqual(4.5)
    for (const fill of ['row-selected', 'row-selected-focus']) {
      expect(against('row-muted', fill), `row-muted on ${fill}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('measures the selected fill against the row background', () => {
    // UX12/A5 reports this ratio. It stays under 3:1 until Shane picks a stronger cue.
    const ratio = against('row-selected', 'canvas')
    expect(ratio).toBeGreaterThan(against('hover', 'canvas'))
    console.info(
      `${theme}: selected/canvas ${ratio.toFixed(2)}, focus/canvas ${against('row-focus', 'canvas').toFixed(2)}, ` +
        `focus/selected ${against('row-selected', 'row-focus').toFixed(2)}, ` +
        `selected+focus/canvas ${against('row-selected-focus', 'canvas').toFixed(2)}`,
    )
  })
})

describe('no coloured edge marks a row or a sidebar item', () => {
  const edge = /\b(ring|border-[lrtb]|border-accent|outline-accent)\b|shadow-\[inset|--accent/

  it.each(['./TreeRow.tsx', './Sidebar.tsx', './ViewsList.tsx'])('keeps %s free of one', (file) => {
    const marks = read(file)
      .split('\n')
      .filter((line) => /aria-current|aria-selected|is-current|tree-row/.test(line))
      .filter((line) => edge.test(line))
    expect(marks).toEqual([])
  })

  it('draws the state rules in styles.css with a fill and a weight only', () => {
    const rules = [...css.matchAll(/([^{}]*(?:tree-row|is-current)[^{}]*)\{([^}]*)\}/g)]
    expect(rules.length).toBeGreaterThan(0)
    for (const [, selector, body] of rules) {
      expect(body, selector).not.toMatch(/border|outline|box-shadow|--accent/)
    }
  })

  it('leaves the Tree container without a ring', () => {
    expect(read('./IssueTree.tsx')).toMatch(/focus-visible:outline-none/)
    expect(read('./IssueTree.tsx')).not.toMatch(
      /\bring\b|border-accent|outline-accent|shadow-\[inset/,
    )
  })
})
