CREATE TABLE "accounts" (
	"number" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Seed: BAS kontoplan subset from the interview spec. ON CONFLICT lets us run
-- this idempotently in case the table is later seeded from code as well.
INSERT INTO "accounts" ("number", "name") VALUES
	('1930', 'Företagskonto'),
	('2440', 'Leverantörsskulder'),
	('2640', 'Ingående moms'),
	('4010', 'Inköp material & varor'),
	('5010', 'Lokalhyra'),
	('5060', 'Driftskostnader lokal'),
	('5220', 'Hyra inventarier'),
	('5410', 'Förbrukningsinventarier'),
	('5460', 'Förbrukningsmaterial'),
	('5610', 'Kontorsmaterial'),
	('5690', 'Övriga kontorskostnader'),
	('6110', 'Kontorsförnödenheter'),
	('6211', 'Fast telefoni'),
	('6230', 'Datakommunikation'),
	('6310', 'Företagsförsäkringar'),
	('6530', 'IT-tjänster'),
	('6540', 'IT-drift & hosting'),
	('6570', 'Programvara, licenser'),
	('6910', 'Licensavgifter & medlemskap'),
	('7631', 'Personalmat & fika')
ON CONFLICT ("number") DO NOTHING;
