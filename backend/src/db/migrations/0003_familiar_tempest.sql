CREATE TABLE "bill_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_path" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"proposal_json" jsonb NOT NULL,
	"match_supplier_id" uuid,
	"match_method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"org_number" text,
	"vat_number" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "supplier_org_number" text;--> statement-breakpoint
ALTER TABLE "bill_drafts" ADD CONSTRAINT "bill_drafts_match_supplier_id_suppliers_id_fk" FOREIGN KEY ("match_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_org_unique" ON "suppliers" USING btree ("org_number") WHERE "suppliers"."org_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_vat_unique" ON "suppliers" USING btree ("vat_number") WHERE "suppliers"."vat_number" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;