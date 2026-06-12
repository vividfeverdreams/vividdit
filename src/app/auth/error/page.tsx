import Link from "next/link"

import { AuthCard } from "@/components/auth-card"
import { Button } from "@/components/ui/button"

export default function AuthErrorPage() {
  return (
    <AuthCard
      title="Link expired or invalid"
      description="That confirmation link didn't work. It may have expired or already been used."
    >
      <div className="space-y-3">
        <Button
          render={<Link href="/login" />}
          nativeButton={false}
          className="w-full"
        >
          Try logging in
        </Button>
        <Button
          render={<Link href="/signup" />}
          nativeButton={false}
          variant="outline"
          className="w-full"
        >
          Sign up again
        </Button>
      </div>
    </AuthCard>
  )
}
