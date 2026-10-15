import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HOLD_OPACITY, StatusDot, statusShape, summaryFade } from './StatusDot'

const markup = (name: string, category: 'new' | 'indeterminate' | 'done') =>
  renderToStaticMarkup(createElement(StatusDot, { status: { id: '1', name, category } }))

describe('statusShape', () => {
  it('gives each category its own shape', () => {
    expect(statusShape({ name: 'To Do', category: 'new' })).toBe('ring')
    expect(statusShape({ name: 'In Progress', category: 'indeterminate' })).toBe('half')
    expect(statusShape({ name: 'Done', category: 'done' })).toBe('check')
  })

  it('draws an unknown category as the To Do ring', () => {
    expect(statusShape({ name: 'Backlog', category: 'undefined' })).toBe('ring')
  })

  it('draws Hold as its own shape, whatever the case', () => {
    expect(statusShape({ name: 'Hold', category: 'new' })).toBe('hold')
    expect(statusShape({ name: ' hold ', category: 'new' })).toBe('hold')
  })

  it('draws On Hold as Hold, whatever the case or the space', () => {
    expect(statusShape({ name: 'On Hold', category: 'new' })).toBe('hold')
    expect(statusShape({ name: ' on hold ', category: 'new' })).toBe('hold')
    expect(statusShape({ name: 'ON  HOLD', category: 'new' })).toBe('hold')
  })

  it('leaves a name that only contains Hold alone', () => {
    expect(statusShape({ name: 'Holding', category: 'new' })).toBe('ring')
    expect(statusShape({ name: 'Hold on', category: 'new' })).toBe('ring')
    expect(statusShape({ name: 'Onhold', category: 'new' })).toBe('ring')
    expect(statusShape({ name: 'On Hold Review', category: 'new' })).toBe('ring')
  })
})

describe('StatusDot', () => {
  it('draws Hold as the To Do ring, dashed, at 30% opacity', () => {
    const svg = markup('Hold', 'new')
    expect(svg).toContain('opacity="0.3"')
    expect(svg).toContain('stroke="var(--status-new)"')
    expect(svg).toContain('stroke-dasharray="2.6 1.72"')
    expect(svg).toContain('data-shape="hold"')
    expect(svg).toContain('aria-label="Hold"')
    expect(svg).not.toContain('--danger')
  })

  it('leaves To Do solid at full opacity', () => {
    const svg = markup('To Do', 'new')
    expect(svg).not.toContain('opacity')
    expect(svg).not.toContain('stroke-dasharray')
  })
})

describe('summaryFade', () => {
  it('fades the summary of a Hold issue to the ring opacity, whatever the case', () => {
    expect(summaryFade({ name: 'Hold' })).toEqual({ opacity: HOLD_OPACITY })
    expect(summaryFade({ name: ' HOLD ' })).toEqual({ opacity: 0.3 })
    expect(summaryFade({ name: 'On Hold' })).toEqual({ opacity: 0.3 })
  })

  it('leaves every other status at full opacity', () => {
    expect(summaryFade({ name: 'To Do' })).toBeUndefined()
    expect(summaryFade({ name: 'Holding' })).toBeUndefined()
    expect(summaryFade({ name: 'Hold on' })).toBeUndefined()
  })
})
