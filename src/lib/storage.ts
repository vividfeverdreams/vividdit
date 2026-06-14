import "server-only"

import { AwsClient } from "aws4fetch"

import { decryptSecret, encryptSecret } from "@/lib/crypto"
import { createAdminClient } from "@/lib/supabase/admin"

// BYO Cloudflare R2 storage for HQ files. R2 is S3-compatible; we sign
// requests with SigV4 (aws4fetch). Creds are encrypted at rest, service-role
// only. Creators with valid R2 get unlimited gates and their downloads run on
// their own (zero-egress) bandwidth.

export type R2Info = {
  accountId: string
  accessKeyId: string
  bucket: string
  publicBaseUrl: string | null
  status: "untested" | "valid" | "invalid"
  lastTestedAt: string | null
  lastError: string | null
}

type R2Creds = {
  accountId: string
  accessKeyId: string
  secret: string
  bucket: string
  publicBaseUrl: string | null
}

const UPLOAD_TTL = 3600
const DOWNLOAD_TTL = 300

function endpoint(creds: { accountId: string; bucket: string }, key: string) {
  return `https://${creds.accountId}.r2.cloudflarestorage.com/${creds.bucket}/${encodeURI(
    key
  )}`
}

function client(creds: R2Creds) {
  return new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secret,
    region: "auto",
    service: "s3",
  })
}

export async function getR2Info(creatorId: string): Promise<R2Info | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("creator_storage_keys")
    .select(
      "account_id, access_key_id, bucket, public_base_url, status, last_tested_at, last_error"
    )
    .eq("creator_id", creatorId)
    .eq("provider", "r2")
    .maybeSingle()
  if (!data) return null
  return {
    accountId: data.account_id,
    accessKeyId: data.access_key_id,
    bucket: data.bucket,
    publicBaseUrl: data.public_base_url,
    status: data.status,
    lastTestedAt: data.last_tested_at,
    lastError: data.last_error,
  }
}

export async function hasValidR2(creatorId: string): Promise<boolean> {
  const info = await getR2Info(creatorId)
  return info?.status === "valid"
}

async function getCreds(creatorId: string): Promise<R2Creds | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("creator_storage_keys")
    .select("account_id, access_key_id, encrypted_secret, bucket, public_base_url")
    .eq("creator_id", creatorId)
    .eq("provider", "r2")
    .maybeSingle()
  if (!data) return null
  return {
    accountId: data.account_id,
    accessKeyId: data.access_key_id,
    secret: decryptSecret(data.encrypted_secret),
    bucket: data.bucket,
    publicBaseUrl: data.public_base_url,
  }
}

export async function saveR2(
  creatorId: string,
  input: {
    accountId: string
    accessKeyId: string
    secret: string
    bucket: string
    publicBaseUrl: string | null
  }
) {
  const admin = createAdminClient()
  const { error } = await admin.from("creator_storage_keys").upsert(
    {
      creator_id: creatorId,
      provider: "r2",
      account_id: input.accountId,
      access_key_id: input.accessKeyId,
      encrypted_secret: encryptSecret(input.secret),
      bucket: input.bucket,
      public_base_url: input.publicBaseUrl,
      status: "untested",
      last_tested_at: null,
      last_error: null,
    },
    { onConflict: "creator_id,provider" }
  )
  if (error) throw new Error(error.message)
}

export async function removeR2(creatorId: string) {
  const admin = createAdminClient()
  await admin
    .from("creator_storage_keys")
    .delete()
    .eq("creator_id", creatorId)
    .eq("provider", "r2")
}

/** Validates R2 creds by listing the bucket (1 key). Persists the result. */
export async function testR2(creatorId: string): Promise<R2Info | null> {
  const creds = await getCreds(creatorId)
  if (!creds) return null

  let status: "valid" | "invalid" = "invalid"
  let lastError: string | null = null
  try {
    const url = `https://${creds.accountId}.r2.cloudflarestorage.com/${creds.bucket}?list-type=2&max-keys=1`
    const res = await client(creds).fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      status = "valid"
    } else if (res.status === 403) {
      lastError = "Access denied — check the access key, secret, and bucket."
    } else if (res.status === 404) {
      lastError = "Bucket not found — check the bucket name and account ID."
    } else {
      lastError = `R2 returned HTTP ${res.status}.`
    }
  } catch {
    lastError = "Couldn't reach R2 — check the account ID and try again."
  }

  const admin = createAdminClient()
  await admin
    .from("creator_storage_keys")
    .update({
      status,
      last_tested_at: new Date().toISOString(),
      last_error: lastError,
    })
    .eq("creator_id", creatorId)
    .eq("provider", "r2")

  return getR2Info(creatorId)
}

/** Presigned PUT URL for a direct browser → R2 upload. */
export async function presignR2Upload(
  creatorId: string,
  key: string,
  contentType: string
): Promise<string | null> {
  const creds = await getCreds(creatorId)
  if (!creds) return null
  const url = `${endpoint(creds, key)}?X-Amz-Expires=${UPLOAD_TTL}`
  const signed = await client(creds).sign(
    new Request(url, { method: "PUT", headers: { "content-type": contentType } }),
    { aws: { signQuery: true } }
  )
  return signed.url
}

/** Presigned GET URL for download delivery (forces attachment download). */
export async function presignR2Download(
  creds: R2Creds,
  key: string,
  filename: string
): Promise<string> {
  const disp = `attachment; filename="${filename.replace(/"/g, "")}"`
  const url = `${endpoint(creds, key)}?X-Amz-Expires=${DOWNLOAD_TTL}&response-content-disposition=${encodeURIComponent(
    disp
  )}`
  const signed = await client(creds).sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  })
  return signed.url
}

/** Used by the download pipeline: presign a GET for a creator's R2 object. */
export async function r2DownloadUrl(
  creatorId: string,
  key: string,
  filename: string
): Promise<string | null> {
  const creds = await getCreds(creatorId)
  if (!creds) return null
  return presignR2Download(creds, key, filename)
}
