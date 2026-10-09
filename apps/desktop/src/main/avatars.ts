import { JiraMgrError } from '@jira-mgr/core'
import type { Credentials } from '@jira-mgr/core/http'

import type { AvatarImage } from '../shared/ipc'

/** Avatars are 48x48 images; a megabyte is far above any real one. */
export const AVATAR_LIMIT_BYTES = 1_000_000
const TIMEOUT_MS = 10_000

/**
 * The image type named by the first bytes, or `null`. SVG is not on the list: it can carry
 * script, and nothing here sanitises it.
 */
export function imageType(bytes: Uint8Array): AvatarImage['type'] | null {
  const at = (offset: number, text: string) =>
    Array.from(text).every((c, i) => bytes[offset + i] === c.charCodeAt(0))
  if (bytes[0] === 0x89 && at(1, 'PNG\r\n') && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return 'image/png'
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif'
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp'
  return null
}

const refuse = (message: string) => new JiraMgrError('not_found', message)

/** Reads at most `limit` bytes of the body, cancelling the stream past it. */
async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > limit || response.body === null) throw refuse('The image is too large.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) {
      await reader.cancel()
      throw refuse('The image is too large.')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export interface AvatarFetcher {
  get(url: string): Promise<AvatarImage>
  /** Forgets every cached image and miss, on logout. */
  clear(): void
}

/**
 * Fetches profile images for the renderer. Https only. Jira credentials go to the Jira site's own
 * host and to no other. A redirect is never followed, so a host cannot bounce a request, and its
 * credentials, elsewhere. Each URL is fetched once per session, a miss included.
 */
export function createAvatarFetcher(deps: {
  credentials: () => Promise<Credentials>
  fetch?: typeof fetch
}): AvatarFetcher {
  const send = deps.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args))
  const cache = new Map<string, Promise<AvatarImage>>()

  async function load(url: string): Promise<AvatarImage> {
    if (!URL.canParse(url)) throw refuse('Not an image URL.')
    const target = new URL(url)
    if (target.protocol !== 'https:' || target.username !== '' || target.password !== '') {
      throw refuse('Only plain https image URLs load.')
    }
    const { siteUrl, email, token } = await deps.credentials()
    const headers: Record<string, string> = { Accept: 'image/*' }
    if (target.host === new URL(siteUrl).host) {
      headers.Authorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
    }
    let response: Response
    try {
      response = await send(target, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw refuse('The image could not be fetched.')
    }
    if (response.status !== 200) throw refuse(`The image host answered ${String(response.status)}.`)
    const bytes = await readCapped(response, AVATAR_LIMIT_BYTES)
    const type = imageType(bytes)
    if (type === null) throw refuse('The file is not a PNG, JPEG, GIF or WebP image.')
    return { type, bytes }
  }

  return {
    get(url) {
      let hit = cache.get(url)
      if (hit === undefined) {
        hit = load(url)
        cache.set(url, hit)
      }
      return hit
    },
    clear: () => {
      cache.clear()
    },
  }
}
