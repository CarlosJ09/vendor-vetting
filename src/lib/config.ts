/**
 * Tunable constants for the deterministic validation layer.
 *
 * Everything here is a policy decision that lives in code, never in a prompt.
 * The model is never told what "expired" or "too different" means — it only
 * reports what a document says, and these constants decide what that implies.
 */

/**
 * How long a certification stays fresh, measured from its issue date, for the
 * document types that print no explicit expiry.
 *
 * ⚠️ ASSUMPTION, NOT A VERIFIED LEGAL FACT. The DGII and TSS certifications
 * carry a validity window that is asserted by the receiving institution rather
 * than printed on the document itself, and published figures for it vary. 30
 * days is used here as a documented, configurable placeholder so the freshness
 * rule is exercised end to end. It is NOT a claim about current DGCP policy.
 * See README "Assumptions".
 *
 * Registro Mercantil is absent from this map deliberately: it prints its own
 * `fecha_vencimiento`, so its freshness comes from the document, not from here.
 */
export const VALIDITY_WINDOW_DAYS = {
  certificacion_dgii: 30,
  certificacion_tss: 30,
} as const;

/**
 * A certification within this many days of expiry still passes, but is surfaced
 * as a warning — an onboarding packet that expires next week is a real problem
 * for the reviewer even though it is technically valid today.
 */
export const EXPIRY_WARNING_DAYS = 15;

/**
 * Extraction confidence below this routes the field to the review queue rather
 * than rejecting it. Low confidence means "the system does not know", which is
 * not the same as "the document is bad".
 */
export const CONFIDENCE_THRESHOLD = 0.75;

/**
 * Name-similarity floor for treating two differing names as a near-miss rather
 * than a mismatch. Near-misses become `warn`; they are never silently passed.
 */
export const NAME_NEAR_MATCH_THRESHOLD = 0.85;
