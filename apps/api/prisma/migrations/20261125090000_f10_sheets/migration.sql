-- AlterEnum
ALTER TYPE "MeasurementMethod" ADD VALUE 'SHEET';

-- AlterTable
ALTER TABLE "measurement" ADD COLUMN     "sheetId" UUID,
ADD COLUMN     "sheetOutputKey" VARCHAR(30);

-- CreateTable
CREATE TABLE "sheet_template" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sheet_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_template_version" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "notes" VARCHAR(1000),
    "publishedAt" TIMESTAMPTZ(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sheet_template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "wbsNodeId" UUID,
    "anchorKind" "MeasurementAnchorKind",
    "structureNodeId" UUID,
    "networkSegmentId" UUID,
    "networkNodeId" UUID,
    "physicalElementId" UUID,
    "typologyId" UUID,
    "elementKey" VARCHAR(80),
    "dwellingUnitId" UUID,
    "params" JSONB NOT NULL DEFAULT '{}',
    "outputMap" JSONB NOT NULL DEFAULT '{}',
    "rows" JSONB NOT NULL DEFAULT '[]',
    "sourceReference" VARCHAR(300),
    "documentId" UUID,
    "launchedHash" CHAR(64),
    "launchedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sheet_template_id_organizationId_key" ON "sheet_template"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_template_organizationId_code_key" ON "sheet_template"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_template_version_id_organizationId_key" ON "sheet_template_version"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_template_version_templateId_number_key" ON "sheet_template_version"("templateId", "number");

-- CreateIndex
CREATE INDEX "sheet_projectId_archivedAt_idx" ON "sheet"("projectId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_id_projectId_key" ON "sheet"("id", "projectId");

-- CreateIndex
CREATE INDEX "measurement_sheetId_idx" ON "measurement"("sheetId");

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_sheetId_projectId_fkey" FOREIGN KEY ("sheetId", "projectId") REFERENCES "sheet"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_template" ADD CONSTRAINT "sheet_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_template_version" ADD CONSTRAINT "sheet_template_version_templateId_organizationId_fkey" FOREIGN KEY ("templateId", "organizationId") REFERENCES "sheet_template"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_templateVersionId_organizationId_fkey" FOREIGN KEY ("templateVersionId", "organizationId") REFERENCES "sheet_template_version"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_wbsNodeId_projectId_fkey" FOREIGN KEY ("wbsNodeId", "projectId") REFERENCES "wbs_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_structureNodeId_projectId_fkey" FOREIGN KEY ("structureNodeId", "projectId") REFERENCES "structure_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_networkSegmentId_projectId_fkey" FOREIGN KEY ("networkSegmentId", "projectId") REFERENCES "network_segment"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_networkNodeId_projectId_fkey" FOREIGN KEY ("networkNodeId", "projectId") REFERENCES "network_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_physicalElementId_projectId_fkey" FOREIGN KEY ("physicalElementId", "projectId") REFERENCES "physical_element"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_typologyId_projectId_fkey" FOREIGN KEY ("typologyId", "projectId") REFERENCES "dwelling_typology"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_dwellingUnitId_projectId_fkey" FOREIGN KEY ("dwellingUnitId", "projectId") REFERENCES "dwelling_unit"("structureNodeId", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_documentId_organizationId_fkey" FOREIGN KEY ("documentId", "organizationId") REFERENCES "document"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================== Regras de banco das fichas (ADR-020) =====================
ALTER TABLE "sheet_template_version" ADD CONSTRAINT sheet_template_version_published CHECK ((status = 'PUBLISHED') = ("publishedAt" IS NOT NULL));
ALTER TABLE "sheet_template_version" ADD CONSTRAINT sheet_template_version_number_positive CHECK (number >= 1);
CREATE UNIQUE INDEX sheet_template_single_draft ON "sheet_template_version"("templateId") WHERE status = 'DRAFT';

-- Versão publicada de modelo de ficha é imutável e não pode ser apagada.
CREATE OR REPLACE FUNCTION sheet_template_version_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'versão publicada de modelo de ficha é imutável' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sheet_template_version_immutable BEFORE UPDATE OR DELETE ON "sheet_template_version" FOR EACH ROW EXECUTE FUNCTION sheet_template_version_guard();

-- Ficha só usa versão publicada do modelo.
CREATE OR REPLACE FUNCTION sheet_template_published() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status::text INTO st FROM "sheet_template_version" WHERE id = NEW."templateVersionId";
  IF st IS DISTINCT FROM 'PUBLISHED' THEN RAISE EXCEPTION 'ficha exige versão publicada do modelo' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sheet_template_check BEFORE INSERT OR UPDATE OF "templateVersionId" ON "sheet" FOR EACH ROW EXECUTE FUNCTION sheet_template_published();

-- Âncora da ficha: nenhuma ou exatamente uma, coerente com o tipo.
ALTER TABLE "sheet" ADD CONSTRAINT sheet_anchor CHECK (
  (("structureNodeId" IS NOT NULL)::int + ("networkSegmentId" IS NOT NULL)::int + ("networkNodeId" IS NOT NULL)::int
   + ("physicalElementId" IS NOT NULL)::int + ("typologyId" IS NOT NULL)::int) = CASE WHEN "anchorKind" IS NULL THEN 0 ELSE 1 END
  AND ("anchorKind" IS DISTINCT FROM 'STRUCTURE_NODE' OR "structureNodeId" IS NOT NULL)
  AND ("anchorKind" IS DISTINCT FROM 'NETWORK_SEGMENT' OR "networkSegmentId" IS NOT NULL)
  AND ("anchorKind" IS DISTINCT FROM 'NETWORK_NODE' OR "networkNodeId" IS NOT NULL)
  AND ("anchorKind" IS DISTINCT FROM 'PHYSICAL_ELEMENT' OR "physicalElementId" IS NOT NULL)
  AND (("typologyId" IS NULL) = ("elementKey" IS NULL))
  AND ("dwellingUnitId" IS NULL OR "typologyId" IS NOT NULL)
);
ALTER TABLE "sheet" ADD CONSTRAINT sheet_launch CHECK (("launchedAt" IS NULL) = ("launchedHash" IS NULL));

-- Fichas não são apagadas (arquivamento).
CREATE OR REPLACE FUNCTION sheet_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fichas não são apagadas; use arquivamento' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sheet_keep BEFORE DELETE ON "sheet" FOR EACH ROW EXECUTE FUNCTION sheet_no_delete();

-- Origem da medição (ficha + saída) vem junto e nunca muda.
ALTER TABLE "measurement" ADD CONSTRAINT measurement_sheet_origin CHECK (("sheetId" IS NULL) = ("sheetOutputKey" IS NULL));
CREATE OR REPLACE FUNCTION measurement_sheet_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."sheetId" IS DISTINCT FROM OLD."sheetId" OR NEW."sheetOutputKey" IS DISTINCT FROM OLD."sheetOutputKey" THEN
    RAISE EXCEPTION 'a ficha de origem de uma medição não muda' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER measurement_sheet_identity BEFORE UPDATE ON "measurement" FOR EACH ROW EXECUTE FUNCTION measurement_sheet_guard();

-- Uma medição ativa por saída da ficha (arquivadas ficam no histórico).
CREATE UNIQUE INDEX measurement_sheet_output_active ON "measurement"("sheetId", "sheetOutputKey") WHERE "sheetId" IS NOT NULL AND "archivedAt" IS NULL;
