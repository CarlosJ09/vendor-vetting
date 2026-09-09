/**
 * Prompts.
 *
 * ## The rule these are written against
 *
 * §3: the model extracts, the code validates. Every prompt here asks the model
 * to report what a document says. None asks whether a document is valid,
 * expired, consistent with another document, or acceptable. Concretely, none of
 * these words appear in any instruction sent to a model: vencido, válido,
 * aprobar, rechazar, cumple. If a future prompt needs one of them, the rule has
 * been broken and the logic belongs in `src/lib/validation` instead.
 *
 * There is a test asserting exactly that.
 *
 * ## On self-reported confidence
 *
 * Asking a model how sure it is produces a number that is only loosely
 * calibrated, and small models tend to be overconfident. It is used anyway
 * because the alternative — per-token logprobs aggregated per field — is not
 * exposed usefully through the Ollama chat API. The eval measures whether the
 * number separates correct extractions from wrong ones; if it does not, that is
 * a finding for the README, not something to paper over.
 */

import { DOCUMENT_TYPE_LABELS } from "@/lib/domain/types";

export const CLASSIFY_SYSTEM = `Eres un sistema de clasificación documental. Identificas qué tipo de documento te presentan. Respondes únicamente en JSON conforme al esquema indicado.`;

/**
 * Descriptions are written from observable surface features — the issuing body,
 * the heading, the fields present — because that is what distinguishes these
 * documents from each other. Three of the four carry an RNC and a company name,
 * so content alone is not enough; the issuer is the discriminator.
 */
export const CLASSIFY_INSTRUCTIONS = `Clasifica el documento en uno de estos tipos:

- "registro_mercantil": ${DOCUMENT_TYPE_LABELS.registro_mercantil}. Emitido por una Cámara de Comercio y Producción. Menciona el Registro Mercantil, un número de registro, y un representante legal. Suele imprimir una fecha de vencimiento propia.
- "certificacion_dgii": ${DOCUMENT_TYPE_LABELS.certificacion_dgii}. Emitido por la Dirección General de Impuestos Internos (DGII). Trata sobre obligaciones fiscales o tributarias. Suele incluir un código de verificación.
- "certificacion_tss": ${DOCUMENT_TYPE_LABELS.certificacion_tss}. Emitido por la Tesorería de la Seguridad Social (TSS). Trata sobre contribuciones a la seguridad social y menciona a un empleador.
- "cedula": ${DOCUMENT_TYPE_LABELS.cedula}. Documento de identidad de una persona física. Tiene nombres, apellidos, fecha de nacimiento y un número de documento de 11 dígitos.
- "unknown": no corresponde claramente a ninguno de los anteriores.

Los documentos pueden llevar sellos o leyendas que los identifican como ejemplares sintéticos, de prueba, o sin efecto legal. Esas leyendas NO determinan el tipo de documento. Clasifica según el emisor, el encabezado y los campos presentes, ignorando esas marcas.

Elige "unknown" solo si la estructura del documento no encaja con ninguno de los tipos anteriores. Es preferible a adivinar.

Indica tu confianza entre 0 y 1.`;

export const EXTRACT_SYSTEM = `Eres un sistema de extracción de datos documentales. Tu única tarea es leer el documento y reportar textualmente lo que dice. Respondes únicamente en JSON conforme al esquema indicado.

Reglas:
- Transcribe los valores EXACTAMENTE como aparecen impresos, sin reformatear.
- Las fechas se transcriben tal cual están escritas (por ejemplo "03/08/2025" o "3 de agosto de 2025"). No las conviertas a otro formato.
- Si un campo no aparece en el documento, devuelve una cadena vacía.
- No inventes ni completes valores que no estén presentes.
- No incluyas la etiqueta del campo dentro del valor. Si el documento dice "Empleador<TAB>Nombre de la empresa", el valor es solo "Nombre de la empresa".
- Los documentos pueden llevar sellos o leyendas que los identifican como ejemplares sintéticos o sin efecto legal. Ignóralas y extrae los campos igualmente.
- Indica para cada campo tu confianza entre 0 y 1, y el número de página donde lo encontraste.`;

const STATUS_INSTRUCTIONS = `Para el campo "estado", elige el valor que refleje lo que declara el documento:
- "al_dia": el documento declara que está al día, que cumplió, o que no tiene deudas ni obligaciones pendientes.
- "con_deuda": el documento declara deudas, atrasos, omisiones u obligaciones pendientes de pago.
- "indeterminado": el documento no permite decidir entre los dos anteriores. Por ejemplo si menciona un acuerdo o plan de pago en curso, una revisión o conciliación en proceso, un recurso en trámite, o dice que la situación no pudo determinarse.

Elige "indeterminado" cuando el texto sea ambiguo. No supongas.`;

export const EXTRACT_INSTRUCTIONS: Record<string, string> = {
  registro_mercantil: `Extrae del documento:
- rnc: el Registro Nacional de Contribuyente (9 dígitos).
- razon_social: el nombre de la sociedad comercial, incluida su forma legal (SRL, S.A., etc.).
- numero_registro: el número de registro mercantil.
- fecha_emision: la fecha en que se expidió el documento.
- fecha_vencimiento: la fecha hasta la cual el documento indica que mantiene vigencia.
- representante_legal: el nombre de la persona señalada como representante legal.`,

  certificacion_dgii: `Extrae del documento:
- rnc: el Registro Nacional de Contribuyente (9 dígitos).
- razon_social: el nombre del contribuyente, incluida su forma legal.
- estado: ver las instrucciones de estado más abajo.
- fecha_emision: la fecha en que se expidió el documento.
- codigo_verificacion: el código de verificación impreso.

${STATUS_INSTRUCTIONS}`,

  certificacion_tss: `Extrae del documento:
- rnc: el Registro Nacional de Contribuyente (9 dígitos).
- razon_social: el nombre del empleador, incluida su forma legal.
- estado: ver las instrucciones de estado más abajo.
- fecha_emision: la fecha en que se expidió el documento.

${STATUS_INSTRUCTIONS}`,

  cedula: `Extrae del documento de identidad:
- cedula: el número de documento (11 dígitos). Transcríbelo tal como aparece, con o sin guiones.
- nombre_completo: nombres y apellidos juntos, en ese orden.
- fecha_nacimiento: la fecha de nacimiento.
- fecha_vencimiento: la fecha de vencimiento del documento.

La imagen puede estar rotada, con poca luz, con ruido o parcialmente recortada. Si un campo resulta ilegible, devuelve una cadena vacía e indica confianza baja en lugar de adivinar.`,
};

/** Wrap a document's text layer for a prompt. */
export function textPrompt(instructions: string, text: string): string {
  return `${instructions}

--- INICIO DEL DOCUMENTO ---
${text}
--- FIN DEL DOCUMENTO ---`;
}
