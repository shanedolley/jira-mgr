import { JiraMgrError } from '@jira-mgr/core'

import type { ImageType } from '../shared/ipc'

const startsWith = (bytes: Uint8Array, signature: number[], at = 0) =>
  signature.every((byte, i) => bytes[at + i] === byte)

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0))

/** The image type the bytes begin as, by magic number, or `null` for anything else. */
export function imageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp'
  return null
}

const EXTENSIONS: Record<ImageType, string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
}

/** A slash, a control character, or a bidirectional override: each makes a name read differently than it is. */
function isUnsafeName(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (
      code < 0x20 ||
      code === 0x7f ||
      code === 0x2f ||
      code === 0x5c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true
    }
  }
  return false
}

/**
 * A name safe to upload or save under, trimmed. A name holding a slash, a control character or a
 * bidi override is refused with `validation_failed`. `what` words the message: "image", "file".
 */
export function safeFilename(raw: string, what = 'file'): string {
  const name = raw.trim()
  if (name === '' || name === '.' || name === '..' || isUnsafeName(name)) {
    throw new JiraMgrError(
      'validation_failed',
      `The ${what} name is empty or holds a slash, a control character or a text-direction override. Rename the file.`,
    )
  }
  return name
}

/**
 * The name to offer when saving an attachment: its last path segment, with each unsafe character
 * made an underscore. A name that comes out empty becomes `attachment`.
 */
export function savedFilename(raw: string): string {
  const base = raw.split(/[\\/]/).at(-1) ?? ''
  const name = Array.from(base, (char) => (isUnsafeName(char) ? '_' : char))
    .join('')
    .trim()
  return name === '' || name === '.' || name === '..' ? 'attachment' : capBytes(name)
}

/** The longest file name macOS takes, in UTF-8 bytes. */
const MAX_NAME_BYTES = 255

/** `name` cut to 255 UTF-8 bytes at a character boundary, keeping a short extension whole. */
function capBytes(name: string): string {
  const size = (text: string) => new TextEncoder().encode(text).length
  if (size(name) <= MAX_NAME_BYTES) return name
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 && size(name.slice(dot)) <= 16 ? name.slice(dot) : ''
  const kept = Array.from(extension === '' ? name : name.slice(0, dot))
  while (size(kept.join('')) + size(extension) > MAX_NAME_BYTES) kept.pop()
  return kept.join('') + extension
}

/** The name to upload an image under: a safe name whose extension is rewritten to match `type`. */
export function uploadFilename(raw: string, type: ImageType): string {
  const name = safeFilename(raw, 'image')
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const allowed = EXTENSIONS[type]
  if (allowed.includes(extension)) return name
  const stem = dot > 0 && /^[a-z0-9]{1,5}$/i.test(extension) ? name.slice(0, dot) : name
  return `${stem}.${allowed[0] ?? 'img'}`
}
