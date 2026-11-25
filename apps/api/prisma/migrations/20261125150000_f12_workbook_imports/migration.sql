-- CreateEnum
CREATE TYPE "WorkbookImportStatus" AS ENUM ('DRAFT', 'APPLIED', 'CANCELLED');

-- CreateTable
CREATE TABLE "workbook_import" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "status" "WorkbookImportStatus" NOT NULL DEFAULT 'DRAFT',
    "plan" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workbook_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workbook_import_sheet" (
    "importId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "colCount" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "cells" JSONB NOT NULL,

    CONSTRAINT "workbook_import_sheet_pkey" PRIMARY KEY ("importId","index")
);

-- CreateIndex
CREATE INDEX "workbook_import_projectId_createdAt_idx" ON "workbook_import"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "workbook_import_id_organizationId_key" ON "workbook_import"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "workbook_import" ADD CONSTRAINT "workbook_import_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbook_import" ADD CONSTRAINT "workbook_import_documentId_organizationId_fkey" FOREIGN KEY ("documentId", "organizationId") REFERENCES "document"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbook_import_sheet" ADD CONSTRAINT "workbook_import_sheet_importId_organizationId_fkey" FOREIGN KEY ("importId", "organizationId") REFERENCES "workbook_import"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Extrato da aba não muda depois de lido; migração aplicada não volta a rascunho.
CREATE OR REPLACE FUNCTION workbook_import_sheet_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'o extrato da aba é imutável' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER workbook_import_sheet_keep BEFORE UPDATE ON "workbook_import_sheet" FOR EACH ROW EXECUTE FUNCTION workbook_import_sheet_immutable();
CREATE OR REPLACE FUNCTION workbook_import_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'migrações não são apagadas' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.status <> OLD.status OR NEW.plan IS DISTINCT FROM OLD.plan OR NEW.result IS DISTINCT FROM OLD.result) THEN
    RAISE EXCEPTION 'migração encerrada não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER workbook_import_lifecycle BEFORE UPDATE OR DELETE ON "workbook_import" FOR EACH ROW EXECUTE FUNCTION workbook_import_guard();
