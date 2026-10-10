import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { call } from './ipc'

export interface AvatarPerson {
  accountId: string
  displayName: string
  avatarUrl?: string | null
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

/** The fill for a hue. At 30% lightness white initials hold 4.5:1 across all 360 hues. */
export function avatarFill(hue: number): string {
  return `hsl(${String(hue)} 45% 30%)`
}

/** A hue from the account id, so one person keeps one colour everywhere. */
export function avatarColor(accountId: string): string {
  let hash = 0
  for (const char of accountId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return avatarFill(hash % 360)
}

/**
 * The image main fetched, as a blob URL. A miss is final for the session: main caches it, and
 * the query does not retry. The blob URL lives as long as the page; images are small and few.
 */
export function useAvatarImage(url: string | null | undefined) {
  return useQuery({
    queryKey: ['avatar', url],
    enabled: url !== null && url !== undefined,
    queryFn: async () => {
      const { type, bytes } = await call('avatars:get', { url: url ?? '' })
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  })
}

/** A person's profile image, or their initials on a stable colour when there is none or it fails. */
export function Avatar({ person }: { person: AvatarPerson | null }) {
  const image = useAvatarImage(person?.avatarUrl)
  const [brokenImage, setBrokenImage] = useState<string>()
  if (person === null) {
    return <span aria-hidden className="size-5 shrink-0 rounded-full border border-line" />
  }
  if (image.data !== undefined && image.data !== brokenImage) {
    return (
      <img
        alt=""
        src={image.data}
        data-avatar="image"
        onError={() => {
          setBrokenImage(image.data)
        }}
        className="size-5 shrink-0 rounded-full object-cover"
      />
    )
  }
  return (
    <span
      aria-hidden
      data-avatar="initials"
      style={{ backgroundColor: avatarColor(person.accountId) }}
      className="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium text-white"
    >
      {initials(person.displayName)}
    </span>
  )
}

/** Assignee options with each person's avatar before the label. Unassigned has none. */
export function withAvatars<T extends { id: string }>(
  options: readonly T[],
  people: ReadonlyMap<string, AvatarPerson>,
): (T & { leading?: ReactNode })[] {
  return options.map((option) => {
    const person = people.get(option.id)
    return person === undefined ? option : { ...option, leading: <Avatar person={person} /> }
  })
}
