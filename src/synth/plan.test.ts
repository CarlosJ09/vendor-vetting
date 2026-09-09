import { describe, expect, it } from "vitest";

import { EXPIRY_WARNING_DAYS, VALIDITY_WINDOW_DAYS } from "@/lib/config";
import { addDays, compareDates, daysBetween } from "@/lib/dates";
import { DOCUMENT_TYPES } from "@/lib/domain/types";
import { isValidCedula } from "@/lib/identifiers/cedula";
import { isValidRnc } from "@/lib/identifiers/rnc";

import { assignDefects, planDossier } from "./plan";
import { createRng } from "./random";
import { COMBINABLE_DEFECTS, type DefectKind } from "./scenarios";

const plan = (seed: number, defectKinds: DefectKind[] = []) =>
  planDossier({ id: `d-${seed}`, seed, defectKinds, expiryWarningDays: EXPIRY_WARNING_DAYS });

describe("planDossier — clean dossiers", () => {
  it("produces all four document types exactly once", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const types = plan(seed).documents.map((d) => d.type).sort();
      expect(types).toEqual([...DOCUMENT_TYPES].sort());
    }
  });

  it("records no defects", () => {
    for (let seed = 1; seed <= 60; seed++) {
      expect(plan(seed).defects).toEqual([]);
    }
  });

  it("expects pass unless a document legitimately sits in the warning band", () => {
    // A defect-free dossier is not automatically a passing one: a certification
    // days from expiry warns without anything being wrong with it. Conflating
    // the two made the ground truth claim `pass` where the rules said `warn`.
    for (let seed = 1; seed <= 60; seed++) {
      const result = plan(seed);
      expect(result.expectedVerdict).toBe(result.expectedWarnings.length > 0 ? "warn" : "pass");
    }
  });

  it("never expects a warning from a document that is not in the dossier", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const result = plan(seed, ["missing_document"]);
      const present = new Set(result.documents.map((d) => d.type));
      for (const warning of result.expectedWarnings) {
        expect(present.has(warning.documentType)).toBe(true);
      }
    }
  });

  it("gives every document a checksum-valid identifier", () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const document of plan(seed).documents) {
        if (document.type === "cedula") {
          expect(isValidCedula(document.fields.cedula)).toBe(true);
        } else {
          expect(isValidRnc(document.fields.rnc)).toBe(true);
        }
      }
    }
  });

  it("agrees on the RNC across all three certifications", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rncs = new Set(
        plan(seed)
          .documents.filter((d) => d.type !== "cedula")
          .map((d) => d.fields.rnc),
      );
      expect(rncs.size).toBe(1);
    }
  });

  it("names the same representative on the cedula and the Registro Mercantil", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const result = plan(seed);
      const rm = result.documents.find((d) => d.type === "registro_mercantil");
      const cedula = result.documents.find((d) => d.type === "cedula");
      expect(cedula?.type === "cedula" && cedula.fields.nombre_completo).toBe(
        rm?.type === "registro_mercantil" && rm.fields.representante_legal,
      );
    }
  });

  it("keeps every document current as of the reference date", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const result = plan(seed);
      for (const document of result.documents) {
        if (document.type === "registro_mercantil") {
          expect(compareDates(document.fields.fecha_vencimiento, result.referenceDate)).toBeGreaterThanOrEqual(0);
          expect(compareDates(document.fields.fecha_emision, result.referenceDate)).toBeLessThanOrEqual(0);
        }
        if (document.type === "certificacion_dgii" || document.type === "certificacion_tss") {
          const window = VALIDITY_WINDOW_DAYS[document.type];
          const expiry = addDays(document.fields.fecha_emision, window);
          expect(compareDates(expiry, result.referenceDate)).toBeGreaterThanOrEqual(0);
          expect(compareDates(document.fields.fecha_emision, result.referenceDate)).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("reports estado al_dia on both certifications", () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const document of plan(seed).documents) {
        if (document.type === "certificacion_dgii" || document.type === "certificacion_tss") {
          expect(document.fields.estado).toBe("al_dia");
        }
      }
    }
  });
});

describe("planDossier — injected defects are actually present", () => {
  it("invalid_rnc_check_digit yields a failing RNC", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = plan(seed, ["invalid_rnc_check_digit"]);
      const rm = result.documents.find((d) => d.type === "registro_mercantil");
      expect(rm?.type === "registro_mercantil" && isValidRnc(rm.fields.rnc)).toBe(false);
      expect(result.expectedVerdict).toBe("fail");
    }
  });

  it("invalid_cedula_check_digit yields a failing cedula", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = plan(seed, ["invalid_cedula_check_digit"]);
      const cedula = result.documents.find((d) => d.type === "cedula");
      expect(cedula?.type === "cedula" && isValidCedula(cedula.fields.cedula)).toBe(false);
    }
  });

  it("rnc_mismatch makes the DGII copy disagree with the Registro Mercantil", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = plan(seed, ["rnc_mismatch"]);
      const rm = result.documents.find((d) => d.type === "registro_mercantil");
      const dgii = result.documents.find((d) => d.type === "certificacion_dgii");
      expect(rm?.type === "registro_mercantil" && dgii?.type === "certificacion_dgii").toBe(true);
      if (rm?.type === "registro_mercantil" && dgii?.type === "certificacion_dgii") {
        expect(dgii.fields.rnc).not.toBe(rm.fields.rnc);
      }
    }
  });

  it("representante_mismatch makes the cedula name differ", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = plan(seed, ["representante_mismatch"]);
      const rm = result.documents.find((d) => d.type === "registro_mercantil");
      const cedula = result.documents.find((d) => d.type === "cedula");
      if (rm?.type === "registro_mercantil" && cedula?.type === "cedula") {
        expect(cedula.fields.nombre_completo).not.toBe(rm.fields.representante_legal);
      }
    }
  });

  it("status_not_al_dia leaves at least one certification off al_dia", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const statuses = plan(seed, ["status_not_al_dia"])
        .documents.filter((d) => d.type === "certificacion_dgii" || d.type === "certificacion_tss")
        .map((d) => (d.type === "certificacion_dgii" || d.type === "certificacion_tss" ? d.fields.estado : null));
      expect(statuses.some((s) => s !== "al_dia")).toBe(true);
    }
  });

  it("expired_document pushes one document past the reference date", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = plan(seed, ["expired_document"]);
      const target = result.defects.find((d) => d.kind === "expired_document")?.documentType;
      const document = result.documents.find((d) => d.type === target);

      if (document?.type === "registro_mercantil") {
        expect(compareDates(document.fields.fecha_vencimiento, result.referenceDate)).toBeLessThan(0);
      } else if (document?.type === "certificacion_dgii" || document?.type === "certificacion_tss") {
        const expiry = addDays(document.fields.fecha_emision, VALIDITY_WINDOW_DAYS[document.type]);
        expect(compareDates(expiry, result.referenceDate)).toBeLessThan(0);
      }
    }
  });

  it("future_issue_date puts an issue date after the reference date", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = plan(seed, ["future_issue_date"]);
      const target = result.defects.find((d) => d.kind === "future_issue_date")?.documentType;
      const document = result.documents.find((d) => d.type === target);
      if (document && document.type !== "cedula") {
        expect(daysBetween(result.referenceDate, document.fields.fecha_emision)).toBeGreaterThan(0);
      }
    }
  });

  it("expired_cedula puts the cedula expiry in the past", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = plan(seed, ["expired_cedula"]);
      const cedula = result.documents.find((d) => d.type === "cedula");
      if (cedula?.type === "cedula") {
        expect(compareDates(cedula.fields.fecha_vencimiento, result.referenceDate)).toBeLessThan(0);
      }
    }
  });

  it("missing_document removes exactly one document", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = plan(seed, ["missing_document"]);
      expect(result.documents).toHaveLength(DOCUMENT_TYPES.length - 1);
    }
  });

  it("duplicate_document adds a second copy under a different filename", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const result = plan(seed, ["duplicate_document"]);
      expect(result.documents).toHaveLength(DOCUMENT_TYPES.length + 1);
      const filenames = new Set(result.documents.map((d) => d.filename));
      expect(filenames.size).toBe(result.documents.length);
    }
  });
});

describe("planDossier — general invariants", () => {
  it("never reuses a filename within a dossier", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const result = plan(seed, seed % 3 === 0 ? ["duplicate_document"] : []);
      const filenames = result.documents.map((d) => d.filename);
      expect(new Set(filenames).size).toBe(filenames.length);
    }
  });

  it("never leaks the document type through the filename", () => {
    // §7: the classifier must work from content alone.
    const leaky = /registro|mercantil|dgii|tss|cedula|fiscal|seguridad/i;
    for (let seed = 1; seed <= 80; seed++) {
      for (const document of plan(seed).documents) {
        expect(document.filename).not.toMatch(leaky);
      }
    }
  });

  it("is reproducible for a given seed", () => {
    expect(plan(99, ["rnc_mismatch"])).toEqual(plan(99, ["rnc_mismatch"]));
  });

  it("produces different dossiers for different seeds", () => {
    expect(plan(1).company.full === plan(2).company.full && plan(1).representanteLegal === plan(2).representanteLegal).toBe(false);
  });
});

describe("assignDefects", () => {
  it("returns one assignment per defective dossier", () => {
    const assignments = assignDefects(createRng(1), 16);
    expect(assignments).toHaveLength(16);
  });

  it("gives every assignment at least one defect", () => {
    for (const assignment of assignDefects(createRng(2), 16)) {
      expect(assignment.length).toBeGreaterThan(0);
    }
  });

  it("never repeats a defect kind within one dossier", () => {
    for (const assignment of assignDefects(createRng(3), 24)) {
      expect(new Set(assignment).size).toBe(assignment.length);
    }
  });

  it("never pairs a structural defect with anything else", () => {
    for (const assignment of assignDefects(createRng(4), 24)) {
      if (assignment.includes("missing_document") || assignment.includes("duplicate_document")) {
        expect(assignment).toHaveLength(1);
      }
    }
  });

  it("spreads combinable kinds near-evenly instead of clustering", () => {
    // The whole reason this function exists: independent draws left some kinds
    // with a single instance across the corpus, making per-defect rates noise.
    const counts = new Map<string, number>();
    for (const assignment of assignDefects(createRng(5), 40)) {
      for (const kind of assignment) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }

    const combinableCounts = COMBINABLE_DEFECTS.map((kind) => counts.get(kind) ?? 0);
    expect(Math.min(...combinableCounts)).toBeGreaterThan(0);
    expect(Math.max(...combinableCounts) - Math.min(...combinableCounts)).toBeLessThanOrEqual(1);
  });
});
