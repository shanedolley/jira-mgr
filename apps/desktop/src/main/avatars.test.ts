import { describe, expect, it, vi } from 'vitest'

import { AVATAR_LIMIT_BYTES, createAvatarFetcher, imageType } from './avatars'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const credentials = () =>
  Promise.resolve({ siteUrl: 'https://site.example.test', email: 'a@b.co', token: 'secret' })

const image = (bytes: Uint8Array = PNG, init: ResponseInit = {}) =>
  new Response(bytes as unknown as BodyInit, init)

function setup(respond: (url: URL, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetcher = createAvatarFetcher({
    credentials,
    fetch: ((url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return Promise.resolve(respond(url, init))
    }) as unknown as typeof fetch,
  })
  return { fetcher, calls }
}

const CDN = 'https://cdn.example.test/a/48'

describe('imageType', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])],
    ['image/gif', new TextEncoder().encode('GIF89a..')],
    ['image/webp', new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')],
  ])('names %s by its first bytes', (type, bytes) => {
    expect(imageType(bytes)).toBe(type)
  })

  it('refuses SVG, HTML and empty files', () => {
    expect(
      imageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeNull()
    expect(imageType(new TextEncoder().encode('<html>'))).toBeNull()
    expect(imageType(new Uint8Array())).toBeNull()
  })
})

describe('createAvatarFetcher', () => {
  it('returns the bytes and their checked type, whatever the server calls them', async () => {
    const { fetcher } = setup(() => image(PNG, { headers: { 'content-type': 'text/html' } }))
    const result = await fetcher.get(CDN)
    expect(result.type).toBe('image/png')
    expect([...result.bytes]).toEqual([...PNG])
  })

  it('sends no credentials to a host other than the site', async () => {
    const { fetcher, calls } = setup(() => image())
    await fetcher.get(CDN)
    expect(calls[0]?.init.headers).not.toHaveProperty('Authorization')
  })

  it('sends credentials to the site host', async () => {
    const { fetcher, calls } = setup(() => image())
    await fetcher.get('https://site.example.test/secure/useravatar')
    expect(calls[0]?.init.headers).toHaveProperty('Authorization')
  })

  it.each([
    'http://cdn.example.test/a',
    'https://u:p@cdn.example.test/a',
    'file:///etc/passwd',
    'nope',
  ])('refuses %s without a request', async (url) => {
    const { fetcher, calls } = setup(() => image())
    await expect(fetcher.get(url)).rejects.toMatchObject({ code: 'not_found' })
    expect(calls).toHaveLength(0)
  })

  it('does not follow a redirect', async () => {
    const { fetcher, calls } = setup(
      () =>
        new Response(null, { status: 302, headers: { location: 'https://other.example.test/x' } }),
    )
    await expect(fetcher.get(CDN)).rejects.toMatchObject({ code: 'not_found' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init.redirect).toBe('manual')
  })

  it('refuses a body over the cap, declared or streamed', async () => {
    const big = new Uint8Array(AVATAR_LIMIT_BYTES + 1)
    big.set(PNG)
    const declared = setup(() => image(big, { headers: { 'content-length': String(big.length) } }))
    await expect(declared.fetcher.get(CDN)).rejects.toThrow('too large')
    const streamed = setup(() => image(big))
    await expect(streamed.fetcher.get(CDN)).rejects.toThrow('too large')
  })

  it('refuses bytes that are not a supported image', async () => {
    const { fetcher } = setup(() => image(new TextEncoder().encode('<svg onload=alert(1)/>')))
    await expect(fetcher.get(CDN)).rejects.toThrow('not a PNG')
  })

  it('fetches a URL once, a miss included, until cleared', async () => {
    const { fetcher, calls } = setup(vi.fn(() => new Response(null, { status: 404 })))
    await expect(fetcher.get(CDN)).rejects.toThrow()
    await expect(fetcher.get(CDN)).rejects.toThrow()
    expect(calls).toHaveLength(1)
    fetcher.clear()
    await expect(fetcher.get(CDN)).rejects.toThrow()
    expect(calls).toHaveLength(2)
  })
})
