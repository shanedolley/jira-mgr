import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { StatusDot, statusShape } from './StatusDot'

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

  it('leaves a name that only contains Hold alone', () => {
    expect(statusShape({ name: 'Holding', category: 'new' })).toBe('ring')
  })
})

describe('StatusDot', () => {
  it('draws Hold as the To Do ring at half opacity', () => {
    const svg = markup('Hold', 'new')
    expect(svg).toContain('opacity="0.5"')
    expect(svg).toContain('stroke="var(--status-new)"')
    expect(svg).toContain('data-shape="hold"')
    expect(svg).toContain('aria-label="Hold"')
    expect(svg).not.toContain('stroke-dasharray')
    expect(svg).not.toContain('--danger')
  })

  it('leaves To Do at full opacity', () => {
    expect(markup('To Do', 'new')).not.toContain('opacity')
  })
})
