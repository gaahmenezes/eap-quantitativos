-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('SERVICES', 'STRUCTURE', 'MEASUREMENTS');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'VALID', 'WARNING', 'ERROR');

-- AlterEnum
ALTER TYPE "MeasurementMethod" ADD VALUE 'IMPORTED';

-- AlterTable
ALTER TABLE "measurement_revision" ADD COLUMN     "documentId" UUID;

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "fileName" VARCHAR(255) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "mime" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storageKey" VARCHAR(80) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "documentId" UUID NOT NULL,
    "sheets" JSONB NOT NULL,
    "sheet" VARCHAR(100),
    "headers" JSONB NOT NULL,
    "mapping" JSONB,
    "summary" JSONB,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "appliedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row" (
    "jobId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "data" JSONB,

    CONSTRAINT "import_row_pkey" PRIMARY KEY ("jobId","rowNumber")
);

-- CreateIndex
CREATE INDEX "document_organizationId_projectId_idx" ON "document"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "document_id_organizationId_key" ON "document"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "document_storageKey_key" ON "document"("storageKey");

-- CreateIndex
CREATE INDEX "import_job_organizationId_projectId_createdAt_idx" ON "import_job"("organizationId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "import_row_jobId_status_idx" ON "import_row"("jobId", "status");

-- AddForeignKey
ALTER TABLE "measurement_revision" ADD CONSTRAINT "measurement_revision_documentId_organizationId_fkey" FOREIGN KEY ("documentId", "organizationId") REFERENCES "document"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_documentId_organizationId_fkey" FOREIGN KEY ("documentId", "organizationId") REFERENCES "document"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "import_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===================== Restrições da F9 (ADR-019) =====================
ALTER TABLE "document" ADD CONSTRAINT document_size CHECK (size > 0);
ALTER TABLE "document" ADD CONSTRAINT document_kind CHECK (kind IN ('XLSX', 'CSV', 'PDF', 'PNG', 'JPEG'));
ALTER TABLE "document" ADD CONSTRAINT document_sha256 CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "import_row" ADD CONSTRAINT import_row_number CHECK ("rowNumber" >= 1);

-- Documentos são registros de origem: não mudam nem são apagados.
CREATE OR REPLACE FUNCTION document_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'documentos de origem são imutáveis' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER document_immutable BEFORE UPDATE OR DELETE ON "document" FOR EACH ROW EXECUTE FUNCTION document_immutable();

-- Importação aplicada ou cancelada não volta a mudar.
CREATE OR REPLACE FUNCTION import_job_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('APPLIED', 'CANCELLED') THEN RAISE EXCEPTION 'importação encerrada não pode ser alterada' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER import_job_closed BEFORE UPDATE OR DELETE ON "import_job" FOR EACH ROW EXECUTE FUNCTION import_job_guard();
