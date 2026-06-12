"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

export function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? "Copied!" : "Copy URL"}
    </Button>
  )
}
