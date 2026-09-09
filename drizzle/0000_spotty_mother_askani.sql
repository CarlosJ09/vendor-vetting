CREATE TYPE "public"."compliance_status" AS ENUM('al_dia', 'con_deuda', 'indeterminado');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('registro_mercantil', 'certificacion_dgii', 'certificacion_tss', 'cedula', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('ingest', 'render', 'classify', 'extract', 'normalize', 'validate', 'cross_check', 'dossier');--> statement-breakpoint
CREATE TYPE "public"."requirement_status" AS ENUM('pass', 'warn', 'fail', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('ok', 'error', 'skipped');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dossier_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"classified_type" "document_type",
	"classification_confidence" double precision,
	"page_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dossiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"reference_date" text NOT NULL,
	"overall_status" "requirement_status",
	"source_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "extracted_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"field" text NOT NULL,
	"raw_value" text,
	"normalized_value" text,
	"confidence" double precision NOT NULL,
	"page" integer,
	"bbox" jsonb,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dossier_id" uuid NOT NULL,
	"requirement" text NOT NULL,
	"status" "requirement_status" NOT NULL,
	"detail" text NOT NULL,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dossier_id" uuid NOT NULL,
	"document_id" uuid,
	"stage" "pipeline_stage" NOT NULL,
	"status" "stage_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_input_tokens" integer,
	"cost_usd" double precision,
	"output" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_results" ADD CONSTRAINT "requirement_results_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_dossier_idx" ON "documents" USING btree ("dossier_id");--> statement-breakpoint
CREATE INDEX "documents_sha256_idx" ON "documents" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "dossiers_external_id_idx" ON "dossiers" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extracted_fields_document_field_idx" ON "extracted_fields" USING btree ("document_id","field");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_results_dossier_requirement_idx" ON "requirement_results" USING btree ("dossier_id","requirement");--> statement-breakpoint
CREATE INDEX "stage_runs_dossier_stage_idx" ON "stage_runs" USING btree ("dossier_id","stage");--> statement-breakpoint
CREATE INDEX "stage_runs_document_idx" ON "stage_runs" USING btree ("document_id");