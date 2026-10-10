import { afterEach, describe, expect, it, vi } from 'vitest'

import { AVATAR_LIMIT_BYTES, createAvatarFetcher } from './avatars'
import { imageType } from './images'

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

afterEach(() => {
  vi.restoreAllMocks()
})

const CDN = 'https://avatars.example.atl-paas.net/a/48'

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
    'http://avatars.example.atl-paas.net/a',
    'https://u:p@avatars.example.atl-paas.net/a',
    'file:///etc/passwd',
    'nope',
  ])('refuses %s without a request', async (url) => {
    const { fetcher, calls } = setup(() => image())
    await expect(fetcher.get(url)).rejects.toMatchObject({ code: 'not_found' })
    expect(calls).toHaveLength(0)
  })

  it.each([
    'https://localhost/a.png',
    'https://127.0.0.1/a.png',
    'https://0x7f.1/a.png',
    'https://[::1]/a.png',
    'https://192.168.1.10/a.png',
    'https://169.254.169.254/latest/meta-data',
    'https://evil.com/a.png',
    'https://evilatl-paas.net/a.png',
    'https://secure.gravatar.com.evil.com/a.png',
    'https://evil.com/.atl-paas.net',
    'https://atl-paas.net.evil.com/a.png',
    'https://avatars.example.atl-paas.net:8443/a.png',
  ])('refuses %s with no request', async (url) => {
    const { fetcher, calls } = setup(() => image())
    await expect(fetcher.get(url)).rejects.toThrow('does not serve profile images')
    expect(calls).toHaveLength(0)
  })

  it('loads from Gravatar', async () => {
    const { fetcher } = setup(() => image())
    await expect(fetcher.get('https://secure.gravatar.com/avatar/abc?d=x')).resolves.toBeDefined()
  })

  it('maps a failure while reading the body to not_found', async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.error(new Error('reset'))
      },
    })
    const { fetcher } = setup(() => new Response(body))
    await expect(fetcher.get(CDN)).rejects.toMatchObject({
      code: 'not_found',
      message: 'The image could not be fetched.',
    })
  })

  it('gives the request a timeout, and a request that hangs ends as not_found', async () => {
    const hang = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(hang.signal)
    const fetcher = createAvatarFetcher({
      credentials,
      fetch: ((_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const fail = () => {
            reject(new Error('timed out'))
          }
          if (init.signal?.aborted === true) fail()
          init.signal?.addEventListener('abort', fail)
        })) as unknown as typeof fetch,
    })
    const result = fetcher.get(CDN)
    hang.abort()
    await expect(result).rejects.toMatchObject({ code: 'not_found' })
    expect(timeout).toHaveBeenCalledWith(10_000)
  })

  it('reads no credentials for a CDN host, and never caches a refused URL', async () => {
    const read = vi.fn(credentials)
    const calls: string[] = []
    const fetcher = createAvatarFetcher({
      credentials: read,
      fetch: ((url: URL) => {
        calls.push(String(url))
        return Promise.resolve(image())
      }) as unknown as typeof fetch,
    })
    await fetcher.get(CDN)
    expect(read).not.toHaveBeenCalled()
    await expect(fetcher.get('https://evil.example.test/a')).rejects.toThrow('does not serve')
    await expect(fetcher.get('https://evil.example.test/a')).rejects.toThrow('does not serve')
    expect(read).toHaveBeenCalledTimes(2)
    expect(calls).toEqual([CDN])
  })

  it('remembers the 200 most recent URLs and drops the oldest', async () => {
    const { fetcher, calls } = setup(() => image())
    const url = (n: number) => `https://avatars.example.atl-paas.net/${String(n)}/48`
    for (let n = 0; n < 201; n++) await fetcher.get(url(n))
    expect(calls).toHaveLength(201)
    await fetcher.get(url(200))
    expect(calls).toHaveLength(201)
    await fetcher.get(url(1))
    expect(calls).toHaveLength(201)
    await fetcher.get(url(0))
    expect(calls).toHaveLength(202)
  })

  it('names a missing body, not a large one', async () => {
    const { fetcher } = setup(() => new Response(null, { status: 200 }))
    await expect(fetcher.get(CDN)).rejects.toThrow('no body')
  })

  it('refuses a redirect from an atl-paas.net host, even one that carries an image', async () => {
    const { fetcher, calls } = setup(
      () =>
        new Response(PNG, {
          status: 302,
          headers: { location: 'https://other.example.test/x' },
        }),
    )
    await expect(fetcher.get(CDN)).rejects.toThrow('answered 302')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init.redirect).toBe('manual')
  })

  it('refuses a redirect from an atl-paas.net host to a Gravatar proxy', async () => {
    const { fetcher, calls } = setup(
      () =>
        new Response(null, {
          status: 302,
          headers: {
            location:
              'https://i0.wp.com/avatar-management--avatars.us-west-2.prod.public.atl-paas.net/initials/AB-1.png',
          },
        }),
    )
    await expect(fetcher.get(CDN)).rejects.toThrow('answered 302')
    expect(calls).toHaveLength(1)
  })

  describe('Gravatar redirect', () => {
    const GRAVATAR = 'https://secure.gravatar.com/avatar/abc?d=x'
    const WP =
      'https://i0.wp.com/avatar-management--avatars.us-west-2.prod.public.atl-paas.net/initials/AB-1.png?ssl=1'
    const redirect = (location?: string, status = 302) =>
      new Response(null, { status, headers: location === undefined ? {} : { location } })

    it.each(['i0', 'i1', 'i2'])('loads the image Gravatar redirects to on %s.wp.com', async (n) => {
      const to = WP.replace('i0', n)
      const { fetcher, calls } = setup((url) =>
        url.host === 'secure.gravatar.com' ? redirect(to) : image(),
      )
      await expect(fetcher.get(GRAVATAR)).resolves.toMatchObject({ type: 'image/png' })
      expect(calls.map((c) => c.url)).toEqual([GRAVATAR, to])
    })

    it('refuses a relative Location, which stays on Gravatar', async () => {
      const { fetcher, calls } = setup(() => redirect('/x'))
      await expect(fetcher.get(GRAVATAR)).rejects.toThrow('answered 302')
      expect(calls).toHaveLength(1)
    })

    it('shares one timeout signal across both requests', async () => {
      const timeout = vi.spyOn(AbortSignal, 'timeout')
      const { fetcher, calls } = setup((url) =>
        url.host === 'secure.gravatar.com' ? redirect(WP) : image(),
      )
      await fetcher.get(GRAVATAR)
      expect(timeout).toHaveBeenCalledTimes(1)
      expect(calls[1]?.init.signal).toBe(calls[0]?.init.signal)
    })

    it('sends no Authorization on either request', async () => {
      const { fetcher, calls } = setup((url) =>
        url.host === 'secure.gravatar.com' ? redirect(WP) : image(),
      )
      await fetcher.get(GRAVATAR)
      expect(calls).toHaveLength(2)
      for (const call of calls) {
        expect(call.init.headers).not.toHaveProperty('Authorization')
        expect(call.init.redirect).toBe('manual')
      }
    })

    it.each([
      'https://evil.example.test/a.png',
      'https://i3.wp.com/a.png',
      'https://i0.wp.com.evil.test/a.png',
      'http://i0.wp.com/a.png',
      'https://u:p@i0.wp.com/a.png',
      'https://i0.wp.com:8443/a.png',
      'https://i0.wp.com/evil.example.test/a.png',
      'https://i0.wp.com/evilatl-paas.net/a.png',
      'https://i0.wp.com/atl-paas.net/a.png',
      'https://i0.wp.com/evil.test%2Fx.atl-paas.net/a.png',
      'https://i0.wp.com/x.atl-paas.net.evil.test/a.png',
      'https://i0.wp.com/',
      'https://avatars.example.atl-paas.net/a.png',
      'https://secure.gravatar.com/a.png',
      'https://localhost/a.png',
    ])('refuses a redirect to %s without a second request', async (to) => {
      const { fetcher, calls } = setup(() => redirect(to))
      await expect(fetcher.get(GRAVATAR)).rejects.toThrow('answered 302')
      expect(calls).toHaveLength(1)
    })

    it('refuses a redirect with no Location', async () => {
      const { fetcher, calls } = setup(() => redirect())
      await expect(fetcher.get(GRAVATAR)).rejects.toThrow('answered 302')
      expect(calls).toHaveLength(1)
    })

    it('refuses a second redirect', async () => {
      const { fetcher, calls } = setup((url) =>
        url.host === 'secure.gravatar.com' ? redirect(WP) : redirect('https://i1.wp.com/a.png'),
      )
      await expect(fetcher.get(GRAVATAR)).rejects.toThrow('answered 302')
      expect(calls).toHaveLength(2)
    })

    it('refuses a redirect from the site host and sends no second request', async () => {
      const { fetcher, calls } = setup(() => redirect(WP))
      await expect(fetcher.get('https://site.example.test/secure/useravatar')).rejects.toThrow(
        'answered 302',
      )
      expect(calls).toHaveLength(1)
      expect(calls[0]?.init.headers).toHaveProperty('Authorization')
    })

    it('applies the size cap and the image check after the redirect', async () => {
      const big = new Uint8Array(AVATAR_LIMIT_BYTES + 1)
      big.set(PNG)
      const oversize = setup((url) =>
        url.host === 'secure.gravatar.com' ? redirect(WP) : image(big),
      )
      await expect(oversize.fetcher.get(GRAVATAR)).rejects.toThrow('too large')
      const html = setup((url) =>
        url.host === 'secure.gravatar.com'
          ? redirect(WP)
          : image(new TextEncoder().encode('<html>')),
      )
      await expect(html.fetcher.get(GRAVATAR)).rejects.toThrow('not a PNG')
    })

    it('caches a refused redirect as a miss', async () => {
      const { fetcher, calls } = setup(() => redirect('https://evil.example.test/a'))
      await expect(fetcher.get(GRAVATAR)).rejects.toThrow()
      await expect(fetcher.get(GRAVATAR)).rejects.toThrow()
      expect(calls).toHaveLength(1)
    })
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
