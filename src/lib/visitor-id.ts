// A random id the fan's browser keeps so a gate counts each visitor once a
// day. It identifies a browser, not a person, and carries no personal data.

const VISITOR_ID = /^[A-Za-z0-9_-]{8,64}$/
const STORAGE_KEY = "vividdit:visitor"

export function isVisitorId(value: unknown): value is string {
  return typeof value === "string" && VISITOR_ID.test(value)
}

/** Client only. Falls back to a per-page id when storage is blocked. */
export function getVisitorId(): string {
  let id: string | null = null
  try {
    id = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private mode or blocked storage.
  }
  if (isVisitorId(id)) return id
  id = crypto.randomUUID().replace(/-/g, "")
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Counted per page load instead; still better than counting bots.
  }
  return id
}
