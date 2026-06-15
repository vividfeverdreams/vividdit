"use client"

import { useRouter } from "next/navigation"

const OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "visits", label: "Visits" },
  { value: "downloads", label: "Downloads" },
  { value: "archived", label: "Archived" },
] as const

export function SortSelect({ value }: { value: string }) {
  const router = useRouter()
  return (
    <select
      value={value}
      onChange={(e) => router.push(`/dashboard?sort=${e.target.value}`)}
      className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
      aria-label="Sort gates"
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
