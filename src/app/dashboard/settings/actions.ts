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
    })
    .eq("id", user.id)

  if (error) {
    return { error: "Couldn't save your profile.", success: null }
  }
  revalidatePath("/dashboard/settings")
  return { error: null, success: "Profile updated." }
}
