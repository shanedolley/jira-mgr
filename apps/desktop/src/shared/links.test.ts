import { describe, expect, it } from 'vitest'

import { externalUrl } from './links'

describe('externalUrl', () => {
  it('opens http, https and mailto links and refuses every other scheme', () => {
    expect(externalUrl('https://example.test/a?b=1')).toBe('https://example.test/a?b=1')
    expect(externalUrl('http://example.test')).toBe('http://example.test/')
    expect(externalUrl('mailto:a@example.test')).toBe('mailto:a@example.test')
    for (const raw of [
      'ftp://example.test',
      'javascript:alert(1)',
      'vbscript:x',
      'blob:https://x/1',
      'about:blank',
      'example.test',
      '',
    ]) {
      expect(externalUrl(raw), raw).toBeNull()
    }
  })

  it('refuses " javascript:", "JAVASCRIPT:", "file:", "data:" and a backslash https', () => {
    for (const raw of [
      ' javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'java\tscript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<b>x</b>',
      'https:\\\\evil.test',
      'https://evil.test\\@good.test',
      ' https://example.test',
      'https://example.test ',
      '\u0000https://example.test',
    ]) {
      expect(externalUrl(raw), JSON.stringify(raw)).toBeNull()
    }
  })

  it('keeps only subject, body, cc and bcc on a mailto link', () => {
    expect(
      externalUrl('mailto:a@example.test?subject=Hi&attach=/etc/passwd&BCC=b@example.test&x=1'),
    ).toBe('mailto:a@example.test?subject=Hi&bcc=b%40example.test')
    expect(externalUrl('mailto:a@example.test?attach=x')).toBe('mailto:a@example.test')
  })

  it('opens the parsed href, not the raw string', () => {
    expect(externalUrl('HTTPS://EXAMPLE.test:443/a b')).toBe('https://example.test/a%20b')
    expect(externalUrl('https://example.test/é')).toBe('https://example.test/%C3%A9')
  })
})
