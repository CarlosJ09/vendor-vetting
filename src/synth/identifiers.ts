/**
 * Synthetic identifier generation.
 *
 * Valid numbers are built by computing the real check digit, so the pipeline's
 * validators are exercised against genuinely well-formed input. Invalid ones are
 * built by corrupting only the check digit, leaving length and character class
 * intact — otherwise the format guard would reject them first and the check-digit
 * path would never run.
 *
 * These numbers are structurally valid but not issued to anyone. They are drawn
 * from the same numeric space as real identifiers because that is the point of a
 * realistic fixture; none of them is looked up against any real registry.
 */

import { calcCedulaCheckDigit } from "@/lib/identifiers/cedula";
import { calcRncCheckDigit } from "@/lib/identifiers/rnc";

import type { Rng } from "./random";

/**
 * Leading digits seen on company RNCs. Included so the generated corpus looks
 * plausible to a human reviewing the sample PDFs, not because the pipeline
 * depends on the prefix in any way.
 */
const RNC_PREFIXES = ["101", "102", "130", "131"] as const;

/** Number of municipal codes used as the cedula prefix. */
const CEDULA_MUNICIPALITY_MAX = 110;

function digits(rng: Rng, count: number): string {
  let out = "";
  for (let i = 0; i < count; i++) out += rng.int(0, 9);
  return out;
}

/** Replace the final digit with a different one, keeping the shape intact. */
function corruptCheckDigit(rng: Rng, number: string): string {
  const actual = Number(number[number.length - 1]);
  const offset = rng.int(1, 9);
  const replacement = (actual + offset) % 10;
  return number.slice(0, -1) + replacement;
}

/** A 9-digit RNC with a correct check digit. */
export function generateRnc(rng: Rng): string {
  const body = rng.pick(RNC_PREFIXES) + digits(rng, 5);
  return body + calcRncCheckDigit(body);
}

/** A 9-digit RNC whose check digit is wrong. */
export function generateInvalidRnc(rng: Rng): string {
  return corruptCheckDigit(rng, generateRnc(rng));
}

/** An 11-digit cedula with a correct check digit. */
export function generateCedula(rng: Rng): string {
  const municipality = String(rng.int(1, CEDULA_MUNICIPALITY_MAX)).padStart(3, "0");
  const body = municipality + digits(rng, 7);
  return body + calcCedulaCheckDigit(body);
}

/** An 11-digit cedula whose check digit is wrong. */
export function generateInvalidCedula(rng: Rng): string {
  return corruptCheckDigit(rng, generateCedula(rng));
}

/** Reference number printed on a Registro Mercantil certification. */
export function generateNumeroRegistro(rng: Rng): string {
  return String(rng.int(10_000, 999_999));
}

/** Verification code printed on a DGII certification. */
export function generateCodigoVerificacion(rng: Rng): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[rng.int(0, alphabet.length - 1)];
  return out;
}
