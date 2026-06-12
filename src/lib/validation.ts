import { z } from "zod"

// Mirrors the DB check constraints on profiles.artist_slug / gates.slug.
export const slugRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const signupSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
})

export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
})

export const onboardingSchema = z.object({
  artistName: z
    .string()
    .trim()
    .min(1, "Enter your artist name")
    .max(100, "Artist name is too long"),
  artistSlug: z
    .string()
    .trim()
    .min(3, "Slug must be at least 3 characters")
    .max(60, "Slug must be at most 60 characters")
    .regex(slugRegex, "Lowercase letters, numbers, and single hyphens only"),
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

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}
