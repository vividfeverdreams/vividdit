"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  removeOpenAiKey,
  saveOpenAiKey,
  setVerificationModel,
  testOpenAiKey,
  VERIFICATION_MODELS,
  type VerificationModel,
} from "@/lib/ai-keys"
import {
  removeResendKey,
  saveResendKey,
  testResendKey,
} from "@/lib/email-keys"
import { removeR2, saveR2, testR2 } from "@/lib/storage"
import { createClient } from "@/lib/supabase/server"

export type SettingsFormState = {
  error: string | null
  success: string | null
}

const openAiKeySchema = z
  .string()
  .trim()
  .min(20, "That doesn't look like an OpenAI API key")
  .max(300, "That doesn't look like an OpenAI API key")
  .startsWith("sk-", "OpenAI API keys start with sk-")

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function saveKeyAction(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  const parsed = openAiKeySchema.safeParse(formData.get("apiKey"))
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, success: null }
  }

  await saveOpenAiKey(user.id, parsed.data)
  revalidatePath("/dashboard/settings")
  return { error: null, success: "Key saved. Run a test to validate it." }
}

export async function testKeyAction(
  _prev: SettingsFormState,
  _formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  const info = await testOpenAiKey(user.id)
  revalidatePath("/dashboard/settings")
  if (!info) return { error: "No key saved yet.", success: null }
  if (info.keyStatus === "valid") {
    return { error: null, success: "Key is valid and ready for verification." }
  }
  return { error: info.lastError ?? "Key test failed.", success: null }
}

export async function removeKeyAction(
  _prev: SettingsFormState,
  _formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  await removeOpenAiKey(user.id)
  revalidatePath("/dashboard/settings")
  return { error: null, success: "Key removed." }
}

export async function setModelAction(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  const model = formData.get("model")
  if (
    typeof model !== "string" ||
    !VERIFICATION_MODELS.includes(model as VerificationModel)
  ) {
    return { error: "Unknown model.", success: null }
  }

  await setVerificationModel(user.id, model as VerificationModel)
  revalidatePath("/dashboard/settings")
  return {
    error: null,
    success: `Verification model set to ${model}. Re-test your key to confirm access.`,
  }
}

const resendKeySchema = z.object({
  resendKey: z
    .string()
    .trim()
    .min(10, "That doesn't look like a Resend API key")
    .max(200, "That doesn't look like a Resend API key")
    .startsWith("re_", "Resend API keys start with re_"),
  fromEmail: z
    .string()
    .trim()
    .min(3, "Enter a sender address")
    .max(200)
    .refine((v) => /<[^@\s]+@[^@\s]+>$|^[^@\s]+@[^@\s]+$/.test(v), {
      message: "Use name@domain.com or Name <name@domain.com>",
    }),
})

export async function saveResendKeyAction(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  const parsed = resendKeySchema.safeParse({
    resendKey: formData.get("resendKey"),
    fromEmail: formData.get("fromEmail"),
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, success: null }
  }

  await saveResendKey(user.id, parsed.data.resendKey, parsed.data.fromEmail)
  revalidatePath("/dashboard/settings")
  return { error: null, success: "Resend key saved. Run a test to validate it." }
}

export async function testResendKeyAction(
  _prev: SettingsFormState,
  _formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  const info = await testResendKey(user.id)
  revalidatePath("/dashboard/settings")
  if (!info) return { error: "No Resend key saved yet.", success: null }
  if (info.keyStatus === "valid") {
    return {
      error: null,
      success: info.lastError ?? "Resend key is valid — fans will get emailed.",
    }
  }
  return { error: info.lastError ?? "Resend key test failed.", success: null }
}

export async function removeResendKeyAction(
  _prev: SettingsFormState,
  _formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  await removeResendKey(user.id)
  revalidatePath("/dashboard/settings")
  return { error: null, success: "Resend key removed." }
}

const r2Schema = z.object({
  accountId: z.string().trim().min(1, "Enter your Cloudflare account ID").max(100),
  accessKeyId: z.string().trim().min(1, "Enter the R2 access key ID").max(200),
  secret: z.string().trim().min(1, "Enter the R2 secret access key").max(400),
  bucket: z.string().trim().min(1, "Enter the bucket name").max(100),
  publicBaseUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v.replace(/\/$/, "") : null)),
})

export async function saveR2Action(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  const parsed = r2Schema.safeParse({
    accountId: formData.get("accountId"),
    accessKeyId: formData.get("accessKeyId"),
    secret: formData.get("secret"),
    bucket: formData.get("bucket"),
    publicBaseUrl: formData.get("publicBaseUrl") || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, success: null }
  }

  await saveR2(user.id, {
    accountId: parsed.data.accountId,
    accessKeyId: parsed.data.accessKeyId,
    secret: parsed.data.secret,
    bucket: parsed.data.bucket,
    publicBaseUrl: parsed.data.publicBaseUrl ?? null,
  })
  revalidatePath("/dashboard/settings")
  return { error: null, success: "R2 saved. Run a test to validate it." }
}

export async function testR2Action(
  _prev: SettingsFormState,
  _formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  const info = await testR2(user.id)
  revalidatePath("/dashboard/settings")
  if (!info) return { error: "No R2 storage saved yet.", success: null }
  if (info.status === "valid") {
    return {
      error: null,
      success: "R2 is connected — you now have unlimited gates.",
    }
  }
  return { error: info.lastError ?? "R2 test failed.", success: null }
}

export async function removeR2Action(
  _prev: SettingsFormState,
  _formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  await removeR2(user.id)
  revalidatePath("/dashboard/settings")
  return { error: null, success: "R2 storage removed." }
}

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((v) => v || null)
  .refine((v) => !v || /^https?:\/\//.test(v), "Enter a valid URL")

const profileSchema = z.object({
  artistName: z.string().trim().min(1, "Enter your artist name").max(100),
  soundcloudProfileUrl: z
    .url("Enter a valid URL")
    .refine(
      (u) => {
        try {
          const host = new URL(u).hostname
          return host === "soundcloud.com" || host.endsWith(".soundcloud.com")
        } catch {
          return false
        }
      },
      { message: "Must be a soundcloud.com profile URL" }
    ),
  instagramUrl: optionalUrl,
  spotifyUrl: optionalUrl,
})

export async function updateProfileAction(
  _prev: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const user = await requireUser()
  if (!user) return { error: "Not signed in.", success: null }

  const parsed = profileSchema.safeParse({
    artistName: formData.get("artistName"),
    soundcloudProfileUrl: formData.get("soundcloudProfileUrl"),
    instagramUrl: formData.get("instagramUrl") || undefined,
    spotifyUrl: formData.get("spotifyUrl") || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message, success: null }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("profiles")
    .update({
      artist_name: parsed.data.artistName,
      soundcloud_profile_url: parsed.data.soundcloudProfileUrl,
      instagram_url: parsed.data.instagramUrl,
      spotify_url: parsed.data.spotifyUrl,
    })
    .eq("id", user.id)

  if (error) {
    return { error: "Couldn't save your profile.", success: null }
  }
  revalidatePath("/dashboard/settings")
  return { error: null, success: "Profile updated." }
}
