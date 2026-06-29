import Link from "next/link"

import { getVaultDownloads } from "@/lib/downloads"

export const metadata = { title: "Your vault downloads" }

export default async function VaultDownloadPage({
  params,
}: {
  params: Promise<{ statusToken: string }>
}) {
  const { statusToken } = await params

  const files = /^[0-9a-f-]{36}$/i.test(statusToken)
    ? await getVaultDownloads(statusToken)
    : null

  if (!files) {
    return (
      <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">Download not available</h1>
        <p className="text-sm text-muted-foreground">
          This link is invalid or the unlock hasn&apos;t been approved yet.
        </p>
        <Link href="/" className="text-sm underline">
          Back to Vividdit
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Your downloads 🎉</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {files.length === 0
          ? "Nothing here yet — check back when new tracks are added."
          : `Tap any track to download. ${files.length} file${files.length > 1 ? "s" : ""} available.`}
      </p>

      <ul className="mt-6 space-y-2">
        {files.map((f, i) => (
          <li key={i}>
            <a
              href={f.url}
              className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
            >
              <span className="text-lg">⬇️</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {f.filename}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-xs text-muted-foreground">
        Links expire after a few minutes — just reload this page to refresh them.
      </p>
    </main>
  )
}
