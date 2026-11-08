# vendor-vetting — Project Brief

## 1. What this is

An agentic document-vetting system for supplier onboarding, built against the document
requirements of the Dominican Republic's **Registro de Proveedores del Estado (RPE)**,
administered by the Dirección General de Contrataciones Públicas (DGCP).

The flow: a user drops an unlabeled folder of supplier documents into the system. The system
figures out what each document is, extracts the relevant fields, validates them against
deterministic rules, cross-checks the documents against each other for coherence, and produces
a dossier with a pass/warn/fail status per requirement plus links to the exact page and region
that supports each finding.

**This is a portfolio artifact, not a startup.** It exists to demonstrate production-grade
engineering judgment with LLM systems. Ship it, publish it, move on.

## 2. Explicit non-goals

Do not build, do not suggest building, do not scope-creep into:

- Authentication beyond a hardcoded stub user
- Multi-tenancy, organizations, roles, or permissions
- Billing, plans, or usage metering
- An admin panel or settings screens
- Notifications, email, or webhooks
- Any document type beyond the four listed in §4
- Real (non-synthetic) documents containing actual personal or company data
- Customer discovery, user interviews, or market validation

If a task doesn't move the pipeline or the eval numbers forward, it's out of scope.

## 3. The one architectural principle that matters

**The model extracts. The code validates.**

The LLM's only job is to read a document and report what it says, with a confidence score and
a page citation. It is never asked to judge, decide, or reason about business rules.

- ✅ Ask the model: "What issue date appears on this document?"
- ❌ Never ask the model: "Is this document expired?"

Expiry, check digits, status enums, and cross-document consistency are all deterministic code
with unit tests. This separation is the thing the project is meant to demonstrate — do not blur
it for convenience, and never move a validation rule into a prompt.

## 4. Domain: the four documents

Chosen because each one forces a different technical problem. Do not add more.

### 4.1 Certificación de Registro Mercantil (Cámara de Comercio)
Text-based PDF. Establishes the company's legal existence.

| Field | Type | Notes |
|---|---|---|
| `rnc` | string | 9 digits, check-digit validated |
| `razon_social` | string | normalized for comparison |
| `numero_registro` | string | |
| `fecha_emision` | date | |
| `fecha_vencimiento` | date | **explicit** expiry date printed on the document |
| `representante_legal` | string | person name |

Technical problem: structured PDF extraction + explicit expiry logic.

### 4.2 Certificación de cumplimiento fiscal (DGII)
Text-based PDF. Confirms the company is current on tax obligations.

| Field | Type | Notes |
|---|---|---|
| `rnc` | string | |
| `razon_social` | string | |
| `estado` | enum | `al_dia` \| `con_deuda` \| `indeterminado` |
| `fecha_emision` | date | |
| `codigo_verificacion` | string | |

Technical problems: (a) a **status enum** the model must classify from prose that varies in
wording; (b) **implicit expiry** — this certification has a short validity window measured from
the issue date, with no printed expiry. That window lives in a config constant in code, not in a
prompt. Make the window configurable and document the assumption in the README.

### 4.3 Certificación de la TSS (Tesorería de la Seguridad Social)
Text-based PDF. Confirms the company is current on social security contributions.

| Field | Type | Notes |
|---|---|---|
| `rnc` | string | |
| `razon_social` | string | |
| `estado` | enum | `al_dia` \| `con_deuda` \| `indeterminado` |
| `fecha_emision` | date | |

Technical problem: this is the third document carrying `rnc` and `razon_social`, which is what
makes the cross-document coherence check meaningful.

### 4.4 Cédula del representante legal
**Scanned image**, not a text PDF. National ID card, front and back.

| Field | Type | Notes |
|---|---|---|
| `cedula` | string | 11 digits, check-digit validated |
| `nombre_completo` | string | |
| `fecha_nacimiento` | date | extract but do not display in the dossier UI |
| `fecha_vencimiento` | date | |

Technical problems: a different input modality (rasterized image, OCR-style extraction from a
degraded scan) and a second cross-document link — the name here must match
`representante_legal` from the Registro Mercantil.

## 5. Validation rules

### Deterministic field-level
- **RNC check digit** — 9-digit identifier with a modulus-based check digit.
- **Cédula check digit** — 11-digit identifier with a modulus-based check digit.

⚠️ Do **not** implement either algorithm from memory or from a single blog post. Find a
reference implementation, write a unit test suite with known-valid and known-invalid numbers
first, and make the implementation pass it. If the algorithm can't be confirmed, mark the
validator as `unverified` in the code and say so in the README rather than shipping a
confidently wrong checksum. An invalid check digit short-circuits the pipeline before any
tokens are spent.

- **Date sanity** — issue date not in the future, expiry after issue, dates parseable in
  the `DD/MM/YYYY` convention used locally.
- **Freshness** — Registro Mercantil uses its printed expiry; DGII and TSS use
  `fecha_emision + VALIDITY_WINDOW_DAYS` (config constant, per document type).
- **Status** — anything other than `al_dia` fails that requirement.

### Cross-document coherence
- `rnc` identical across Registro Mercantil, DGII, and TSS.
- `razon_social` matches across the same three after normalization (case, accents, whitespace,
  legal suffixes like `SRL` / `S.R.L.` / `S.A.`). Use a normalized comparison with a similarity
  threshold, and surface near-misses as `warn` rather than silently passing them.
- `nombre_completo` on the cédula matches `representante_legal` on the Registro Mercantil,
  same normalization approach.
- Completeness: all four document types present.

### Confidence handling
Every extracted field carries `{ value, confidence, page, bbox? }`. Fields below a configurable
confidence threshold are not auto-rejected — they go to a **review queue** and the dossier shows
`needs_review` for that requirement. Production systems keep a human in the loop; showing that
judgment is part of the point.

## 6. Synthetic data — build this first

There is no legal way to publish a demo using real supplier documents. The synthetic generator
is therefore a first-class deliverable, not a test fixture, and it gets built before the
extraction pipeline.

Build a `synth` package that generates realistic PDFs and images:

- Correct-looking layouts for the three certifications (headers, seals as placeholder shapes,
  reference numbers, official-register formatting conventions)
- Generated RNCs and cédulas with **valid** check digits, plus a deliberate minority with
  invalid ones
- A spread of date scenarios: fresh, near-expiry, expired, issued in the future
- A spread of status values including ambiguous phrasing
- For cédulas: rasterize, then degrade — rotation of 1–5°, gaussian noise, JPEG compression
  artifacts, uneven lighting, partial crops
- **Deliberately broken dossiers**: mismatched RNC across documents, a legal representative
  name that doesn't match the cédula, a missing document, a duplicate document

Every generated dossier is emitted alongside a ground-truth JSON file. That ground truth is the
eval set.

Target: 40 dossiers, roughly 60% clean and 40% containing at least one defect.

## 7. Pipeline

```
ingest        →  accept a folder of files, no filename assumptions
render        →  PDFs to page images + text layer; images stay images
classify      →  determine document type per file (or "unknown")
extract       →  per-type structured extraction with confidence + page citation
normalize     →  parse dates, trim strings, canonicalize names
validate      →  deterministic field rules
cross-check   →  coherence across documents
dossier       →  per-requirement status: pass | warn | fail | needs_review
```

Each stage is independently testable and independently benchmarked. Persist intermediate output
so a stage can be re-run without repeating the ones before it.

## 8. Stack

Deliberately boring. This project demonstrates judgment, not framework novelty.

- **Next.js** (App Router) + **TypeScript**
- **PostgreSQL** + **Drizzle** (decided; do not revisit)
- Document bytes stored in Postgres (`documents.content`), with the local filesystem kept as a
  fallback for development. Decided when the deployed demo turned out to have no filesystem to
  read from: the whole synthetic corpus is 5 MB, so this keeps the deployment to two moving
  parts instead of adding object storage and its credentials. S3 remains the right answer at
  real volume, and is not needed at this one.
- **Local models via Ollama** for classification and extraction, using structured output
- `pdf-lib` / `pdfjs` for PDF handling, `sharp` for image manipulation
- Vitest for tests

### 8.1 Model provider

Inference goes through a provider interface with exactly two methods, `classify` and `extract`,
both returning structured output. Nothing above that interface knows which model answered.

The default is **Ollama running locally** — `qwen2.5` for the text PDFs, `qwen2.5vl` for the
scanned cédula. Chosen so the project costs nothing to develop and reproduce, and so anyone
cloning the repo can run the full eval without an API key.

The interface is not framework abstraction for its own sake: it is what makes the eval portable
across backends, which turns "here are my numbers on a 7B local model" into a comparison rather
than an excuse. A hosted-API adapter may be added later purely to produce a second eval column.

Expect the scanned cédula to be where a 7B quantised vision model loses the most ground. That
result is a finding to publish under §11's failure-modes section, not a defect to hide.

Constraint: **do not add a dependency without asking first.** A short dependency list is part of
the story.

## 9. Evaluation harness

Non-negotiable and built early — this is what separates the project from a demo.

`npm run eval` runs the pipeline over the 40-dossier synthetic set and prints:

- Classification accuracy per document type, plus a confusion matrix
- Per-field extraction precision and recall
- Validation-decision accuracy vs. ground truth (did the dossier get the right verdict)
- False-pass rate — a defective dossier marked clean is the **worst** failure mode; call it out
  separately and prominently
- Cost per dossier. Local inference costs nothing, so report the measured `$0.00` **and** a
  projected hosted-API cost derived from the token counts recorded in `stage_runs`. Reporting only
  the zero would make the metric useless; reporting only the projection would be dishonest.
- Latency p50 / p95, per stage. On local inference this is the binding constraint rather than
  cost, so it carries the weight the cost table would otherwise carry.
- Model and quantisation used, recorded alongside every result. A number without the model that
  produced it is not reproducible.

Results are committed to the repo as a dated markdown table and reproduced in the README. When a
number is bad, publish it and explain it. A README that admits an 82% recall on scanned cédulas
and analyzes why is far more credible than one claiming 99%.

## 10. Execution order

Not time-boxed. Ordered by dependency — each item is buildable only once the ones above it exist.
Work straight down the list; ship as fast as correctness allows.

**Done**

- [x] Repo scaffolding, toolchain, test harness
- [x] Check-digit validators for RNC and cédula, verified against two independent references each
- [x] Date parsing and arithmetic; name normalisation and similarity primitives
- [x] Domain types and tunable config constants
- [x] Synthetic generator: all four document types, 40-dossier corpus with ground truth and
      field-level citations, stratified defect injection
- [x] Database schema and migration, verified against a live Postgres
- [x] Deterministic validation layer: field rules and cross-document coherence, each mapping to
      `pass | warn | fail | needs_review`
- [x] Model provider interface (`classify`, `extract`) with an Ollama adapter
- [x] Pipeline: ingest → render → classify → extract → normalize → locate, persisted per stage
- [x] Eval harness (§9), with the false-pass rate reported on its own
- [x] Citation locator: each value found in the text layer, measured against the generator's own
      recorded bounding boxes
- [x] Review queue driven by the confidence threshold
- [x] Dossier view with evidence links to page and region
- [x] README (§11)
- [x] Deployed demo with the corpus pre-loaded — https://vendor-vetting.vercel.app
      (Vercel + Supabase; verified against ground truth in production: 40/40 verdicts,
      0 false passes, all documents byte-identical to the files on disk)

**Nothing next. §10 is finished — ship it, publish it, move on (§1).**

The demo runs on a free tier that suspends the database after a stretch of inactivity, so
the link needs waking from the Supabase dashboard before it is shared. That is a property
of the hosting, not a task: the README reproduces everything with no account anywhere.

Open questions, carried rather than closed:

- `VALIDITY_WINDOW_DAYS = 30` is a documented placeholder, not a verified legal fact. It stays
  flagged in code and README until someone supplies a real figure.
- Scanned documents get no evidence region: the locator reads a PDF text layer and a cédula has
  none. Fixing it needs per-word OCR geometry the vision path does not produce.
- The eval reports 100% on a corpus generated by this repo. That measures the pipeline, not the
  documents a real registry would send.

Rationale for the order that was followed: the validation layer came before any model work,
because it is the project's whole thesis (§3) and could be fully tested against ground truth
without a single token being spent. That paid off — with the rules proven correct in isolation,
every wrong dossier verdict the eval later reported was unambiguously an extraction fault, and
each one was traced to its real cause rather than argued about.

## 11. README requirements

The README is a deliverable, not documentation. It must contain:

- One paragraph on the problem, stated concretely
- Architecture diagram and the extract-vs-validate principle, explained
- The eval tables with real numbers
- **A failure-modes section**: what breaks, why, what was tried that didn't work
- Cost and latency figures
- A prominent note that this is an independent portfolio project with **no affiliation** to
  DGCP or any government institution, and that **all demo documents are synthetic**

Repo description:
`Agentic document vetting for supplier onboarding, built against the Dominican Republic's public procurement registry requirements.`

## 12. Working agreements for Claude Code

- Ask before adding any dependency.
- Ask before adding any file to the repo root.
- Never move a business rule into a prompt.
- Never fabricate an official document format, procedure, or legal requirement — if a real-world
  detail is uncertain, flag it and mark the assumption in code and README.
- Write the test before the validator.
- Don't polish UI until the pipeline produces correct output end to end.
- Prefer one working slice over four scaffolded stubs.
- When a suggestion falls outside §2, say so and don't build it.