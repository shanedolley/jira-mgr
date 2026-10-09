import { JiraMgrError } from '@jira-mgr/core'
import { describe, expect, it } from 'vitest'

import { imageType, savedFilename, uploadFilename } from './images'

const bytes = (...values: number[]) => new Uint8Array(values)
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0))

describe('imageType', () => {
  it('names PNG, JPEG, GIF and WebP by magic bytes and nothing else', () => {
    expect(imageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png')
    expect(imageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(imageType(bytes(...ascii('GIF89a'), 1))).toBe('image/gif')
    expect(imageType(bytes(...ascii('GIF87a'), 1))).toBe('image/gif')
    expect(imageType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 ')))).toBe('image/webp')
    expect(imageType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVEfmt ')))).toBeNull()
    expect(imageType(bytes(...ascii('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBeNull()
    expect(imageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull()
    expect(imageType(new Uint8Array())).toBeNull()
  })
})

describe('uploadFilename', () => {
  const refused = (name: string) => {
    try {
      uploadFilename(name, 'image/png')
    } catch (error) {
      expect(error).toBeInstanceOf(JiraMgrError)
      return (error as JiraMgrError).code
    }
    return undefined
  }

  it('refuses filenames with a slash, a control character or a bidi override', () => {
    for (const name of [
      'a/b.png',
      'a\\b.png',
      '../x.png',
      'a\u0000.png',
      'a\nb.png',
      'gnp.‮fdp',
      '',
      '  ',
      '..',
    ]) {
      expect(refused(name), JSON.stringify(name)).toBe('validation_failed')
    }
  })

  it('rewrites the extension to match the type', () => {
    expect(uploadFilename('shot.png', 'image/png')).toBe('shot.png')
    expect(uploadFilename('Shot.PNG', 'image/png')).toBe('Shot.PNG')
    expect(uploadFilename('shot.jpeg', 'image/jpeg')).toBe('shot.jpeg')
    expect(uploadFilename('shot.png', 'image/jpeg')).toBe('shot.jpg')
    expect(uploadFilename('shot.html', 'image/gif')).toBe('shot.gif')
    expect(uploadFilename('shot', 'image/webp')).toBe('shot.webp')
    expect(uploadFilename('my.shot v2', 'image/png')).toBe('my.shot v2.png')
    expect(uploadFilename('.png', 'image/png')).toBe('.png.png')
  })
})

describe('savedFilename', () => {
  const size = (text: string) => new TextEncoder().encode(text).length

  it('offers the last path segment, with unsafe characters made underscores', () => {
    expect(savedFilename('report.xlsx')).toBe('report.xlsx')
    expect(savedFilename('../../etc/x\u202Eexe')).toBe('x_exe')
    expect(savedFilename('a\\b.txt')).toBe('b.txt')
    expect(savedFilename('..')).toBe('attachment')
    expect(savedFilename('   ')).toBe('attachment')
  })

  it('cuts a name over 255 UTF-8 bytes at a character, keeping the extension', () => {
    const long = `${'é'.repeat(200)}.xlsx`
    const name = savedFilename(long)
    expect(size(name)).toBeLessThanOrEqual(255)
    expect(name.endsWith('.xlsx')).toBe(true)
    expect(name.startsWith('é')).toBe(true)
    // A name with no usable extension is cut at its end.
    const bare = savedFilename('日'.repeat(100))
    expect(size(bare)).toBeLessThanOrEqual(255)
    expect(bare).toBe('日'.repeat(85))
  })

  it('leaves a name of exactly 255 bytes alone', () => {
    const name = `${'a'.repeat(250)}.xlsx`
    expect(savedFilename(name)).toBe(name)
  })
})
