/**
 * PDF renderers for the three text-based certifications.
 *
 * Layout conventions here (institutional header, labelled field block, prose
 * body, signature and seal, verification footer) are modelled on the general
 * shape of official Dominican certifications. They are NOT reproductions of any
 * real template, and no real institutional branding, insignia or wording is
 * used — every page is stamped as synthetic. See README "Assumptions".
 */

import { formatDominicanDate, formatLongSpanishDate, type PlainDate } from "@/lib/dates";

import type { PlannedDocument } from "../plan";
import { generatePersonName } from "../pools";
import type { Rng } from "../random";
import {
  CitationRecorder,
  type FieldCitation,
  type Fonts,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PDFDocument,
  drawField,
  drawFooter,
  drawHeader,
  drawParagraph,
  drawSignatureBlock,
  drawTitle,
  loadFonts,
} from "./pdf-layout";

export interface RenderedPdf {
  bytes: Uint8Array;
  citations: Record<string, FieldCitation>;
  pageCount: number;
}

const REPUBLIC = "REPUBLICA DOMINICANA";

/**
 * @param issuedOn the document's own issue date, used as its PDF timestamp.
 *
 * pdf-lib defaults `CreationDate` and `ModDate` to the wall clock, which made
 * every generated PDF differ between runs — and made two renders of the same
 * document differ whenever they straddled a second boundary. Pinning both to the
 * issue date is what actually makes `pnpm synth` reproducible, and it is the
 * more plausible metadata anyway.
 */
async function startDocument(issuedOn: PlainDate): Promise<{
  doc: PDFDocument;
  page: ReturnType<PDFDocument["addPage"]>;
  fonts: Fonts;
  recorder: CitationRecorder;
}> {
  const doc = await PDFDocument.create();
  doc.setProducer("vendor-vetting synthetic generator");
  doc.setCreator("vendor-vetting synthetic generator");
  doc.setSubject("SYNTHETIC TEST DOCUMENT - NO LEGAL VALIDITY");

  const timestamp = new Date(`${issuedOn}T00:00:00Z`);
  doc.setCreationDate(timestamp);
  doc.setModificationDate(timestamp);

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const fonts = await loadFonts(doc);
  return { doc, page, fonts, recorder: new CitationRecorder() };
}

async function finish(
  doc: PDFDocument,
  recorder: CitationRecorder,
): Promise<RenderedPdf> {
  return {
    bytes: await doc.save(),
    citations: recorder.toJSON(),
    pageCount: doc.getPageCount(),
  };
}

/** Certificación de Registro Mercantil — Cámara de Comercio y Producción. */
export async function renderRegistroMercantil(
  document: Extract<PlannedDocument, { type: "registro_mercantil" }>,
  rng: Rng,
): Promise<RenderedPdf> {
  const f = document.fields;
  const { doc, page, fonts, recorder } = await startDocument(f.fecha_emision);

  let y = drawHeader(page, fonts, {
    republic: REPUBLIC,
    institution: `CAMARA DE COMERCIO Y PRODUCCION DE ${document.city.toUpperCase()}`,
    unit: "Departamento de Registro Mercantil",
  });

  y = drawTitle(page, fonts, "CERTIFICACION DE REGISTRO MERCANTIL", y);

  y = drawParagraph(
    page,
    "La Camara de Comercio y Produccion que suscribe CERTIFICA que, segun los archivos que reposan en el Registro Mercantil a su cargo, la sociedad comercial que a continuacion se describe se encuentra debidamente inscrita:",
    y,
    fonts,
  );

  y -= 16;

  y = drawField(page, recorder, 1, {
    label: "Razon social",
    value: f.razon_social,
    field: "razon_social",
    y,
    fonts,
  });
  y = drawField(page, recorder, 1, {
    label: "Registro Nacional",
    value: f.rnc,
    field: "rnc",
    y,
    fonts,
  });
  y = drawField(page, recorder, 1, {
    label: "No. de registro",
    value: f.numero_registro,
    field: "numero_registro",
    y,
    fonts,
  });
  y = drawField(page, recorder, 1, {
    label: "Representante legal",
    value: f.representante_legal,
    field: "representante_legal",
    y,
    fonts,
  });
  y = drawField(page, recorder, 1, {
    label: "Fecha de emision",
    value: formatDominicanDate(f.fecha_emision),
    field: "fecha_emision",
    y,
    fonts,
  });
  y = drawField(page, recorder, 1, {
    label: "Valida hasta",
    value: formatDominicanDate(f.fecha_vencimiento),
    field: "fecha_vencimiento",
    y,
    fonts,
  });

  y -= 12;

  y = drawParagraph(
    page,
    `La presente certificacion se expide a solicitud de parte interesada en la ciudad de ${document.city}, a los ${formatLongSpanishDate(f.fecha_emision)}, y mantiene su vigencia hasta el ${formatDominicanDate(f.fecha_vencimiento)}.`,
    y,
    fonts,
  );

  drawSignatureBlock(page, fonts, {
    name: generatePersonName(rng),
    role: "Encargado(a) del Registro Mercantil",
    y: Math.max(y - 46, MARGIN + 120),
  });

  drawFooter(page, fonts, `Registro No. ${f.numero_registro}`);

  return finish(doc, recorder);
}

/** Certificación de cumplimiento fiscal — DGII. */
export async function renderCertificacionDgii(
  document: Extract<PlannedDocument, { type: "certificacion_dgii" }>,
  rng: Rng,
): Promise<RenderedPdf> {
  const f = document.fields;
  const { doc, page, fonts, recorder } = await startDocument(f.fecha_emision);

  let y = drawHeader(page, fonts, {
    republic: REPUBLIC,
    institution: "DIRECCION GENERAL DE IMPUESTOS INTERNOS",
    unit: "Departamento de Certificaciones",
  });

  y = drawTitle(page, fonts, "CERTIFICACION DE CUMPLIMIENTO FISCAL", y);

  y = drawField(page, recorder, 1, {
    label: "Razon social",
    value: f.razon_social,
    field: "razon_social",
    y,
    fonts,
  });
  y = drawField(page, recorder, 1, {
    label: "RNC",
    value: f.rnc,
    field: "rnc",
    y,
    fonts,
  });
  y = drawField(page, recorder, 1, {
    label: "Fecha de emision",
    value: formatDominicanDate(f.fecha_emision),
    field: "fecha_emision",
    y,
    fonts,
  });

  y -= 14;

  // The status is expressed only in prose, never as a labelled enum. This is the
  // point of the document: the extractor has to map varied wording onto the
  // status vocabulary, and the code — not the model — decides what it implies.
  y = drawParagraph(
    page,
    `La Direccion General de Impuestos Internos CERTIFICA que el contribuyente ${f.razon_social}, RNC ${f.rnc}, ${document.phrasing}`,
    y,
    fonts,
  );
  recorder.recordPageOnly("estado", 1);

  y -= 10;

  y = drawParagraph(
    page,
    `Expedida en Santo Domingo de Guzman, Distrito Nacional, a los ${formatLongSpanishDate(f.fecha_emision)}.`,
    y,
    fonts,
  );

  y -= 10;

  y = drawField(page, recorder, 1, {
    label: "Codigo de verificacion",
    value: f.codigo_verificacion,
    field: "codigo_verificacion",
    y,
    fonts,
  });

  drawSignatureBlock(page, fonts, {
    name: generatePersonName(rng),
    role: "Encargado(a) del Departamento de Certificaciones",
    y: Math.max(y - 40, MARGIN + 120),
  });

  drawFooter(page, fonts, `Codigo de verificacion: ${f.codigo_verificacion}`);

  return finish(doc, recorder);
}

/** Certificación de la Tesorería de la Seguridad Social. */
export async function renderCertificacionTss(
  document: Extract<PlannedDocument, { type: "certificacion_tss" }>,
  rng: Rng,
): Promise<RenderedPdf> {
  const f = document.fields;
  const { doc, page, fonts, recorder } = await startDocument(f.fecha_emision);

  let y = drawHeader(page, fonts, {
    republic: REPUBLIC,
    institution: "TESORERIA DE LA SEGURIDAD SOCIAL",
    unit: "Sistema Dominicano de Seguridad Social",
  });

  y = drawTitle(page, fonts, "CERTIFICACION DE CUMPLIMIENTO", y);

  y = drawParagraph(
    page,
    "La Tesoreria de la Seguridad Social, en cumplimiento de sus atribuciones, hace constar lo siguiente respecto del empleador identificado a continuacion:",
    y,
    fonts,
  );

  y -= 16;

  y = drawField(page, recorder, 1, {
    label: "Empleador",
    value: f.razon_social,
    field: "razon_social",
    y,
    fonts,
  });
  y = drawField(page, recorder, 1, {
    label: "RNC",
    value: f.rnc,
    field: "rnc",
    y,
    fonts,
  });
  y = drawField(page, recorder, 1, {
    label: "Fecha de emision",
    value: formatDominicanDate(f.fecha_emision),
    field: "fecha_emision",
    y,
    fonts,
  });

  y -= 14;

  y = drawParagraph(
    page,
    `Se CERTIFICA que el empleador ${f.razon_social}, RNC ${f.rnc}, ${document.phrasing}`,
    y,
    fonts,
  );
  recorder.recordPageOnly("estado", 1);

  y -= 10;

  y = drawParagraph(
    page,
    `Dada en Santo Domingo, Distrito Nacional, a los ${formatLongSpanishDate(f.fecha_emision)}.`,
    y,
    fonts,
  );

  drawSignatureBlock(page, fonts, {
    name: generatePersonName(rng),
    role: "Gerencia de Recaudo y Cobranzas",
    y: Math.max(y - 46, MARGIN + 120),
  });

  drawFooter(page, fonts, "Verifique en el portal institucional (documento sintetico)");

  return finish(doc, recorder);
}
