import { useEffect, useState } from 'react'

/** The value after `delay` ms of holding still, so a search runs once the user pauses typing. */
export function useDebounced<T>(value: T, delay = 200): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value)
    }, delay)
    return () => {
      clearTimeout(timer)
    }
  }, [value, delay])
  return settled
}
