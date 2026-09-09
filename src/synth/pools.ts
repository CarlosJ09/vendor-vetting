/**
 * Source material for synthetic dossiers.
 *
 * Company and person names are assembled combinatorially from generic components
 * so the corpus reads as plausible without reproducing any real supplier or
 * individual. Common Dominican given names and surnames are used because a
 * corpus of "Test Company 1" would not exercise accent handling, multi-token
 * surnames, or the name-similarity thresholds at all.
 */

import type { Rng } from "./random";

const COMPANY_PREFIXES = [
  "Constructora",
  "Inversiones",
  "Servicios",
  "Comercial",
  "Distribuidora",
  "Grupo",
  "Suplidora",
  "Tecnología",
  "Ferretería",
  "Transporte",
  "Consultores",
  "Industrias",
  "Agropecuaria",
  "Importadora",
] as const;

const COMPANY_QUALIFIERS = [
  "del Caribe",
  "Bella Vista",
  "del Este",
  "Nacional",
  "del Ozama",
  "Antillana",
  "del Yaque",
  "Metropolitana",
  "La Altagracia",
  "San Rafael",
  "del Norte",
  "Los Cerros",
  "Punta Alta",
  "El Higüero",
] as const;

/**
 * Legal forms grouped by entity type, with each group listing the spellings the
 * same form appears in across institutions.
 *
 * Grouping matters for realism: a company is an SRL or an SA, and it does not
 * become the other one between two certifications. Only the punctuation varies,
 * so a dossier that re-prints the name still describes the same entity.
 */
const LEGAL_FORM_FAMILIES = [
  ["SRL", "S.R.L.", "S. R. L."],
  ["SAS", "S.A.S."],
  ["SA", "S.A."],
  ["EIRL", "E.I.R.L."],
  ["C. por A.", "C. POR A."],
] as const;

/**
 * Given names are grouped by grammatical gender and the middle name is drawn
 * from the matching group. Drawing both independently produced signatories like
 * "Rosa Antonio Martínez" — harmless to the pipeline, but the corpus is a
 * deliverable in its own right and implausible names undermine it.
 */
const NAMES_BY_GENDER = {
  feminine: {
    given: [
      "María",
      "Ana",
      "Carmen",
      "Rosa",
      "Altagracia",
      "Yokasta",
      "Mercedes",
      "Belkis",
      "Xiomara",
    ],
    middle: ["Esperanza", "del Carmen", "Isabel", "Altagracia", "Mercedes"],
  },
  masculine: {
    given: ["José", "Juan", "Luis", "Pedro", "Francisco", "Miguel", "Rafael", "Ramón", "Andrés"],
    middle: ["Antonio", "Alberto", "Manuel", "Emilio", "Enrique"],
  },
} as const;

const SURNAMES = [
  "Ramírez",
  "Peña",
  "Fernández",
  "Guzmán",
  "Martínez",
  "Núñez",
  "Sánchez",
  "Reyes",
  "Jiménez",
  "Castillo",
  "Vásquez",
  "Encarnación",
  "Ureña",
  "Polanco",
  "Batista",
  "Then",
] as const;

const CITIES = [
  "Santo Domingo",
  "Santiago de los Caballeros",
  "La Romana",
  "San Pedro de Macorís",
  "San Francisco de Macorís",
  "Puerto Plata",
  "Higüey",
  "Moca",
] as const;

export interface SyntheticCompany {
  /** Name without the legal form, e.g. `Constructora del Caribe`. */
  base: string;
  /** The entity's legal form, as the list of spellings it may be printed in. */
  legalFormFamily: readonly string[];
  /** Legal form as printed on the Registro Mercantil, e.g. `S.R.L.`. */
  legalForm: string;
  /** Full name as printed, e.g. `Constructora del Caribe, S.R.L.`. */
  full: string;
  city: string;
}

export function generateCompany(rng: Rng): SyntheticCompany {
  const base = `${rng.pick(COMPANY_PREFIXES)} ${rng.pick(COMPANY_QUALIFIERS)}`;
  const legalFormFamily = rng.pick(LEGAL_FORM_FAMILIES);
  const legalForm = rng.pick(legalFormFamily);
  // Roughly half of real certifications put a comma before the legal form.
  const separator = rng.bool(0.5) ? ", " : " ";
  return {
    base,
    legalFormFamily,
    legalForm,
    full: `${base}${separator}${legalForm}`,
    city: rng.pick(CITIES),
  };
}

/**
 * A person's name in the local convention: given name, optional middle name,
 * then two surnames.
 */
export function generatePersonName(rng: Rng): string {
  const group = rng.bool(0.5) ? NAMES_BY_GENDER.feminine : NAMES_BY_GENDER.masculine;

  const parts: string[] = [rng.pick(group.given)];
  if (rng.bool(0.4)) parts.push(rng.pick(group.middle));
  const [first, second] = rng.sample(SURNAMES, 2);
  parts.push(first, second);
  return parts.join(" ");
}

/**
 * Re-print the same company name with harmless cosmetic variation — the sort of
 * difference that appears legitimately across institutions and must normalize
 * away rather than being reported as a discrepancy.
 */
export function restyleCompanyName(rng: Rng, company: SyntheticCompany): string {
  const legalForm = rng.pick(company.legalFormFamily);
  const separator = rng.bool(0.5) ? ", " : " ";
  const base = rng.bool(0.3) ? company.base.toUpperCase() : company.base;
  return `${base}${separator}${legalForm}`;
}
