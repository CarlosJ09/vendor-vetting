/**
 * Synthetic cedula renderer: vector card -> raster -> deliberate degradation.
 *
 * This is the one document in the corpus that is an image rather than a text
 * PDF, and that is the point: it forces the pipeline through a genuinely
 * different modality where there is no text layer to fall back on.
 *
 * The card is drawn as SVG and rasterised with sharp, then degraded the way a
 * phone photo or a tired office scanner would degrade it — rotation, uneven
 * lighting, sensor noise, JPEG artefacts, and sometimes a clipped edge. Each
 * parameter comes from the dossier plan, so a given seed always produces a
 * byte-identical image.
 *
 * The layout is a neutral, obviously-synthetic ID card. It deliberately does not
 * reproduce the design, insignia, colours or security features of the real
 * Dominican cedula: the goal is a realistic *extraction problem*, not a
 * convincing forgery. Every face is stamped SYNTHETIC / SIN VALIDEZ LEGAL.
 */

import sharp from "sharp";

import { formatDominicanDate, type PlainDate } from "@/lib/dates";
import { formatCedula } from "@/lib/identifiers/cedula";

import type { DegradationSpec, PlannedDocument } from "../plan";
import { createRng } from "../random";

/** 300 DPI rendering of a standard ID-1 card, plus margins for both faces. */
const CARD_WIDTH = 1011;
const CARD_HEIGHT = 638;
const GUTTER = 48;
const SHEET_WIDTH = CARD_WIDTH + GUTTER * 2;
const SHEET_HEIGHT = CARD_HEIGHT * 2 + GUTTER * 3;

const FONT_STACK = "DejaVu Sans, Ubuntu, Liberation Sans, sans-serif";

/** Escape the five XML predefined entities so names never break the SVG. */
function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function frontFace(fields: {
  cedula: string;
  nombre_completo: string;
  fecha_nacimiento: string;
  fecha_vencimiento: string;
}): string {
  // Local convention: one or two given names followed by two surnames, so the
  // split is from the end. Taking the first token as the given name would file
  // a middle name under APELLIDOS and quietly corrupt the name-matching fixture.
  const tokens = fields.nombre_completo.split(" ").filter(Boolean);
  const surnameCount = Math.min(2, Math.max(1, tokens.length - 1));
  const given = tokens.slice(0, tokens.length - surnameCount).join(" ");
  const surnames = tokens.slice(tokens.length - surnameCount).join(" ");

  return `
  <g transform="translate(${GUTTER}, ${GUTTER})">
    <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="28" fill="#f4f6f8" stroke="#c3cad2" stroke-width="3"/>
    <rect width="${CARD_WIDTH}" height="96" rx="28" fill="#e2e8ee"/>
    <rect y="68" width="${CARD_WIDTH}" height="28" fill="#e2e8ee"/>

    <text x="36" y="46" font-family="${FONT_STACK}" font-size="24" font-weight="bold" fill="#2b3440">DOCUMENTO DE IDENTIDAD</text>
    <text x="36" y="78" font-family="${FONT_STACK}" font-size="17" fill="#6b7685">EJEMPLAR SINTETICO - SIN VALIDEZ LEGAL</text>

    <!-- Photo placeholder: a neutral silhouette, never a real or generated face. -->
    <rect x="36" y="130" width="232" height="290" rx="10" fill="#d7dde4" stroke="#b9c2cc" stroke-width="2"/>
    <circle cx="152" cy="232" r="58" fill="#b3bcc7"/>
    <path d="M 62 420 Q 152 292 242 420 Z" fill="#b3bcc7"/>
    <text x="152" y="452" text-anchor="middle" font-family="${FONT_STACK}" font-size="15" fill="#7b8593">FOTO</text>

    <text x="300" y="158" font-family="${FONT_STACK}" font-size="16" fill="#77818f">NOMBRES</text>
    <text x="300" y="192" font-family="${FONT_STACK}" font-size="30" font-weight="bold" fill="#1d242e">${xml(given)}</text>

    <text x="300" y="242" font-family="${FONT_STACK}" font-size="16" fill="#77818f">APELLIDOS</text>
    <text x="300" y="276" font-family="${FONT_STACK}" font-size="30" font-weight="bold" fill="#1d242e">${xml(surnames)}</text>

    <text x="300" y="330" font-family="${FONT_STACK}" font-size="16" fill="#77818f">FECHA DE NACIMIENTO</text>
    <text x="300" y="362" font-family="${FONT_STACK}" font-size="26" fill="#1d242e">${formatDominicanDate(fields.fecha_nacimiento)}</text>

    <text x="640" y="330" font-family="${FONT_STACK}" font-size="16" fill="#77818f">VENCIMIENTO</text>
    <text x="640" y="362" font-family="${FONT_STACK}" font-size="26" fill="#1d242e">${formatDominicanDate(fields.fecha_vencimiento)}</text>

    <text x="300" y="424" font-family="${FONT_STACK}" font-size="16" fill="#77818f">No. DE DOCUMENTO</text>
    <text x="300" y="464" font-family="${FONT_STACK}" font-size="36" font-weight="bold" letter-spacing="2" fill="#1d242e">${formatCedula(fields.cedula)}</text>

    <rect x="36" y="510" width="${CARD_WIDTH - 72}" height="72" rx="8" fill="#e8ecf1"/>
    <text x="52" y="556" font-family="DejaVu Sans Mono, monospace" font-size="26" letter-spacing="4" fill="#5d6773">SYNTH&lt;&lt;${xml(fields.cedula)}&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</text>
  </g>`;
}

function backFace(fields: { cedula: string }, issued: string): string {
  const y = GUTTER * 2 + CARD_HEIGHT;

  return `
  <g transform="translate(${GUTTER}, ${y})">
    <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="28" fill="#f4f6f8" stroke="#c3cad2" stroke-width="3"/>

    <text x="36" y="64" font-family="${FONT_STACK}" font-size="20" font-weight="bold" fill="#2b3440">REVERSO</text>
    <text x="36" y="102" font-family="${FONT_STACK}" font-size="17" fill="#6b7685">Documento generado para pruebas automatizadas.</text>
    <text x="36" y="132" font-family="${FONT_STACK}" font-size="17" fill="#6b7685">No emitido por ninguna institucion. Sin validez legal.</text>

    <text x="36" y="196" font-family="${FONT_STACK}" font-size="16" fill="#77818f">LUGAR DE EXPEDICION</text>
    <text x="36" y="228" font-family="${FONT_STACK}" font-size="24" fill="#1d242e">SANTO DOMINGO</text>

    <text x="36" y="284" font-family="${FONT_STACK}" font-size="16" fill="#77818f">FECHA DE EXPEDICION</text>
    <text x="36" y="316" font-family="${FONT_STACK}" font-size="24" fill="#1d242e">${issued}</text>

    <!-- Barcode placeholder: evenly spaced bars, carrying no encoded data. -->
    <g>
      ${Array.from({ length: 46 }, (_, i) => {
        const barX = 560 + i * 9;
        const width = i % 3 === 0 ? 5 : 2;
        return `<rect x="${barX}" y="180" width="${width}" height="150" fill="#39424e"/>`;
      }).join("")}
    </g>

    <rect x="36" y="380" width="${CARD_WIDTH - 72}" height="180" rx="8" fill="#e8ecf1"/>
    <text x="52" y="428" font-family="DejaVu Sans Mono, monospace" font-size="24" letter-spacing="3" fill="#5d6773">SYNTHDOC&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</text>
    <text x="52" y="472" font-family="DejaVu Sans Mono, monospace" font-size="24" letter-spacing="3" fill="#5d6773">${xml(fields.cedula)}&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</text>
    <text x="52" y="516" font-family="DejaVu Sans Mono, monospace" font-size="24" letter-spacing="3" fill="#5d6773">SIN&lt;VALIDEZ&lt;LEGAL&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</text>
  </g>`;
}

function buildSvg(
  document: Extract<PlannedDocument, { type: "cedula" }>,
  issuedDate: string,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" viewBox="0 0 ${SHEET_WIDTH} ${SHEET_HEIGHT}">
  <rect width="${SHEET_WIDTH}" height="${SHEET_HEIGHT}" fill="#ffffff"/>
  ${frontFace(document.fields)}
  ${backFace(document.fields, issuedDate)}
</svg>`;
}

/**
 * A soft diagonal gradient standing in for uneven lighting across the platen.
 *
 * Rasterised and explicitly resized to the sheet: sharp renders SVG at its own
 * default density, which produced an overlay smaller than the base image that
 * composited as a hard-edged rectangle in one corner instead of a gradient
 * across the whole page.
 */
async function lightingOverlay(width: number, height: number, strength: number): Promise<Buffer> {
  const low = Math.round(255 * (1 - strength));
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="l" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="rgb(255,255,255)"/>
          <stop offset="55%" stop-color="rgb(${low + 20},${low + 20},${low + 18})"/>
          <stop offset="100%" stop-color="rgb(${low},${low},${low})"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#l)"/>
    </svg>`,
  );

  return sharp(svg).resize(width, height, { fit: "fill" }).png().toBuffer();
}

/**
 * Seeded monochrome gaussian grain, as a raw RGB buffer.
 *
 * Replaces sharp's `create.noise`, which exposes no seed and therefore made the
 * corpus unreproducible. One sample is drawn per pixel and shared across the
 * three channels: sensor grain is closer to monochrome than to independent
 * per-channel noise, and it cuts the sample count by two thirds.
 *
 * Mid-grey (128) is the neutral point for `overlay` blending, so the grain
 * perturbs local contrast without shifting average luminance.
 */
function buildNoise(width: number, height: number, sigma: number, seed: number): Buffer {
  const rng = createRng(seed);
  const buffer = Buffer.allocUnsafe(width * height * 3);

  for (let i = 0; i < width * height; i++) {
    // Box-Muller transform: two uniforms in, one standard normal out.
    const u1 = Math.max(rng.next(), Number.EPSILON);
    const u2 = rng.next();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    const value = Math.round(128 + sigma * normal);
    const clamped = value < 0 ? 0 : value > 255 ? 255 : value;

    const offset = i * 3;
    buffer[offset] = clamped;
    buffer[offset + 1] = clamped;
    buffer[offset + 2] = clamped;
  }

  return buffer;
}

/**
 * Apply the planned degradation.
 *
 * Order matters and mirrors the physical pipeline: lighting and grain belong to
 * the capture, so they go on before the page is skewed; the crop is the framing
 * error of whoever took the picture; JPEG is the last thing that touches it.
 */
async function degrade(base: Buffer, spec: DegradationSpec): Promise<Buffer> {
  // Overlays are built from the rasterised size, not the nominal sheet size.
  // sharp renders SVG at its own density, so the base can come out larger than
  // SHEET_WIDTH/SHEET_HEIGHT; an overlay built from the constants would then be
  // composited undersized and read as a hard-edged rectangle in one corner.
  const baseMeta = await sharp(base).metadata();
  const width = baseMeta.width ?? SHEET_WIDTH;
  const height = baseMeta.height ?? SHEET_HEIGHT;

  const lit = await sharp(base)
    .composite([
      {
        input: await lightingOverlay(width, height, spec.lightingStrength),
        blend: "multiply",
      },
    ])
    .toBuffer();

  const noisy = await sharp(lit)
    .composite([
      {
        input: buildNoise(width, height, spec.noiseSigma, spec.noiseSeed),
        raw: { width, height, channels: 3 },
        blend: "overlay",
      },
    ])
    .toBuffer();

  const rotated = await sharp(noisy)
    .rotate(spec.rotationDegrees, { background: { r: 238, g: 238, b: 240 } })
    .toBuffer();

  let framed = rotated;
  if (spec.cropFraction > 0) {
    const meta = await sharp(rotated).metadata();
    const width = meta.width ?? SHEET_WIDTH;
    const height = meta.height ?? SHEET_HEIGHT;
    const cut = Math.round(width * spec.cropFraction);
    framed = await sharp(rotated)
      .extract({ left: cut, top: 0, width: width - cut, height })
      .toBuffer();
  }

  return sharp(framed).jpeg({ quality: spec.jpegQuality, mozjpeg: true }).toBuffer();
}

export interface RenderedImage {
  bytes: Buffer;
  width: number;
  height: number;
}

export async function renderCedula(
  document: Extract<PlannedDocument, { type: "cedula" }>,
  issuedDate: PlainDate,
): Promise<RenderedImage> {
  const svg = buildSvg(document, formatDominicanDate(issuedDate));
  const base = await sharp(Buffer.from(svg), { density: 96 }).png().toBuffer();
  const bytes = await degrade(base, document.degradation);
  const meta = await sharp(bytes).metadata();

  return { bytes, width: meta.width ?? 0, height: meta.height ?? 0 };
}
