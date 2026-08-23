// Rescue links reuse the existing approved-submission capability path, but
// carry explicit sentinels so they can be found, rotated, revoked, and kept
// out of fan conversion analytics.
export const VAULT_RESCUE_PROOF_CODE = "VIVIDDIT-VAULT-RESCUE"
export const VAULT_RESCUE_USER_AGENT = "vividdit:vault-rescue-link"
