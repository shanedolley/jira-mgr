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
 * The name to upload an image under. A name holding a slash, a control character or a bidi
 * override is refused with `validation_failed`, and the extension is rewritten to match `type`.
 */
export function uploadFilename(raw: string, type: ImageType): string {
  const name = raw.trim()
  if (name === '' || name === '.' || name === '..' || isUnsafeName(name)) {
    throw new JiraMgrError(
      'validation_failed',
      'The image name is empty or holds a slash, a control character or a text-direction override. Rename the file.',
    )
  }
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  const allowed = EXTENSIONS[type]
  if (allowed.includes(extension)) return name
  const stem = dot > 0 && /^[a-z0-9]{1,5}$/i.test(extension) ? name.slice(0, dot) : name
  return `${stem}.${allowed[0] ?? 'img'}`
}
