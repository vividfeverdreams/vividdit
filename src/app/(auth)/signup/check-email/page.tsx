import { AuthCard } from "@/components/auth-card"

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email } = await searchParams

  return (
    <AuthCard
      title="Check your email"
      description={
        email
          ? `We sent a confirmation link to ${email}.`
          : "We sent you a confirmation link."
      }
    >
      <p className="text-sm text-muted-foreground">
        Click the link in the email to activate your account. You can close
        this tab.
      </p>
    </AuthCard>
  )
}
