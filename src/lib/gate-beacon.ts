import { getVisitorId } from "@/lib/visitor-id"

// Client side of /api/events. sendBeacon survives the fan leaving for
// Instagram or SoundCloud mid-request; fetch keepalive is the fallback.

const PARAMS = ["utm_source", "utm_medium", "utm_campaign", "src", "source", "ref"]

// One view per gate per page load, even when an effect runs twice.
const viewed = new Set<string>()

export function sendGateEvent(event: {
  gateId: string
  type: "view" | "open"
  step?: string
  statusToken?: string | null
}) {
  if (typeof window === "undefined") return
  if (event.type === "view") {
    if (viewed.has(event.gateId)) return
    viewed.add(event.gateId)
  }
  try {
    const search = new URLSearchParams(window.location.search)
    const params: Record<string, string> = {}
    for (const key of PARAMS) {
      const value = search.get(key)
      if (value) params[key] = value
    }
    const payload = JSON.stringify({
      ...event,
      visitorId: getVisitorId(),
      referrer: document.referrer || null,
      params,
    })
    const blob = new Blob([payload], { type: "text/plain" })
    if (!navigator.sendBeacon?.("/api/events", blob)) {
      void fetch("/api/events", { method: "POST", body: payload, keepalive: true })
    }
  } catch {
    // Analytics must never get in the fan's way.
  }
}
