-- CreateEnum
CREATE TYPE "MeasurementMethod" AS ENUM ('MANUAL', 'FORMULA');

-- CreateEnum
CREATE TYPE "MeasurementAnchorKind" AS ENUM ('STRUCTURE_NODE', 'TYPOLOGY_ELEMENT', 'NETWORK_SEGMENT', 'NETWORK_NODE', 'PHYSICAL_ELEMENT');

-- CreateTable
CREATE TABLE "formula" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "formula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formula_version" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "formulaId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "expression" VARCHAR(500) NOT NULL,
    "variables" JSONB NOT NULL,
    "dimL" INTEGER,
    "dimM" INTEGER,
    "dimT" INTEGER,
    "notes" VARCHAR(1000),
    "publishedAt" TIMESTAMPTZ(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formula_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "wbsNodeId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "anchorKind" "MeasurementAnchorKind" NOT NULL,
    "structureNodeId" UUID,
    "networkSegmentId" UUID,
    "networkNodeId" UUID,
    "physicalElementId" UUID,
    "typologyId" UUID,
    "elementKey" VARCHAR(80),
    "dwellingUnitId" UUID,
    "currentNumber" INTEGER NOT NULL DEFAULT 1,
    "quantity" DECIMAL(28,10) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "archiveReason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurement_revision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "measurementId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "method" "MeasurementMethod" NOT NULL,
    "formulaVersionId" UUID,
    "inputs" JSONB NOT NULL,
    "memory" JSONB NOT NULL,
    "quantity" DECIMAL(28,10) NOT NULL,
    "unitId" UUID NOT NULL,
    "sourceReference" VARCHAR(300),
    "notes" VARCHAR(2000),
    "reason" VARCHAR(500),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "formula_id_organizationId_key" ON "formula"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "formula_organizationId_code_key" ON "formula"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "formula_version_id_organizationId_key" ON "formula_version"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "formula_version_formulaId_number_key" ON "formula_version"("formulaId", "number");

-- CreateIndex
CREATE INDEX "measurement_projectId_wbsNodeId_serviceId_idx" ON "measurement"("projectId", "wbsNodeId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_id_projectId_key" ON "measurement"("id", "projectId");

-- CreateIndex
CREATE INDEX "measurement_revision_projectId_createdAt_idx" ON "measurement_revision"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "measurement_revision_measurementId_number_key" ON "measurement_revision"("measurementId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "network_node_id_projectId_key" ON "network_node"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "network_segment_id_projectId_key" ON "network_segment"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "physical_element_id_projectId_key" ON "physical_element"("id", "projectId");

-- AddForeignKey
ALTER TABLE "formula" ADD CONSTRAINT "formula_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_version" ADD CONSTRAINT "formula_version_formulaId_organizationId_fkey" FOREIGN KEY ("formulaId", "organizationId") REFERENCES "formula"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_wbsNodeId_projectId_fkey" FOREIGN KEY ("wbsNodeId", "projectId") REFERENCES "wbs_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_serviceId_organizationId_fkey" FOREIGN KEY ("serviceId", "organizationId") REFERENCES "service"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_structureNodeId_projectId_fkey" FOREIGN KEY ("structureNodeId", "projectId") REFERENCES "structure_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_networkSegmentId_projectId_fkey" FOREIGN KEY ("networkSegmentId", "projectId") REFERENCES "network_segment"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_networkNodeId_projectId_fkey" FOREIGN KEY ("networkNodeId", "projectId") REFERENCES "network_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_physicalElementId_projectId_fkey" FOREIGN KEY ("physicalElementId", "projectId") REFERENCES "physical_element"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_typologyId_projectId_fkey" FOREIGN KEY ("typologyId", "projectId") REFERENCES "dwelling_typology"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_dwellingUnitId_projectId_fkey" FOREIGN KEY ("dwellingUnitId", "projectId") REFERENCES "dwelling_unit"("structureNodeId", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_revision" ADD CONSTRAINT "measurement_revision_measurementId_projectId_fkey" FOREIGN KEY ("measurementId", "projectId") REFERENCES "measurement"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_revision" ADD CONSTRAINT "measurement_revision_formulaVersionId_organizationId_fkey" FOREIGN KEY ("formulaVersionId", "organizationId") REFERENCES "formula_version"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurement_revision" ADD CONSTRAINT "measurement_revision_unitId_organizationId_fkey" FOREIGN KEY ("unitId", "organizationId") REFERENCES "unit_of_measure"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================== Restrições da F6 (ADR-016) =====================
CREATE UNIQUE INDEX formula_version_single_draft ON "formula_version" ("formulaId") WHERE status = 'DRAFT';
ALTER TABLE "formula_version" ADD CONSTRAINT formula_version_published CHECK ((status = 'PUBLISHED') = ("publishedAt" IS NOT NULL));
ALTER TABLE "formula_version" ADD CONSTRAINT formula_version_number_positive CHECK (number >= 1);

-- Exatamente uma âncora, coerente com o tipo.
ALTER TABLE "measurement" ADD CONSTRAINT measurement_single_anchor CHECK (
  (("structureNodeId" IS NOT NULL)::int + ("networkSegmentId" IS NOT NULL)::int + ("networkNodeId" IS NOT NULL)::int
   + ("physicalElementId" IS NOT NULL)::int + ("typologyId" IS NOT NULL)::int) = 1
  AND ("anchorKind" <> 'STRUCTURE_NODE' OR "structureNodeId" IS NOT NULL)
  AND ("anchorKind" <> 'NETWORK_SEGMENT' OR "networkSegmentId" IS NOT NULL)
  AND ("anchorKind" <> 'NETWORK_NODE' OR "networkNodeId" IS NOT NULL)
  AND ("anchorKind" <> 'PHYSICAL_ELEMENT' OR "physicalElementId" IS NOT NULL)
  AND ("anchorKind" <> 'TYPOLOGY_ELEMENT' OR ("typologyId" IS NOT NULL AND "elementKey" IS NOT NULL))
  AND (("typologyId" IS NULL) = ("elementKey" IS NULL))
  AND ("dwellingUnitId" IS NULL OR "typologyId" IS NOT NULL)
  AND ("elementKey" IS NULL OR "elementKey" NOT LIKE 'unit:%' OR "dwellingUnitId" IS NOT NULL)
);
ALTER TABLE "measurement" ADD CONSTRAINT measurement_current_number CHECK ("currentNumber" >= 1);
ALTER TABLE "measurement_revision" ADD CONSTRAINT measurement_revision_number CHECK (number >= 1);
ALTER TABLE "measurement_revision" ADD CONSTRAINT measurement_revision_formula CHECK ((method = 'FORMULA') = ("formulaVersionId" IS NOT NULL));
ALTER TABLE "measurement_revision" ADD CONSTRAINT measurement_revision_reason CHECK (number = 1 OR "reason" IS NOT NULL);

-- Versão publicada de fórmula é imutável e não pode ser apagada.
CREATE OR REPLACE FUNCTION formula_version_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'versão publicada de fórmula é imutável' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER formula_version_immutable BEFORE UPDATE OR DELETE ON "formula_version" FOR EACH ROW EXECUTE FUNCTION formula_version_guard();

-- Medição só pode referenciar versão publicada de fórmula.
CREATE OR REPLACE FUNCTION measurement_revision_formula_published() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  IF NEW."formulaVersionId" IS NOT NULL THEN
    SELECT status::text INTO st FROM "formula_version" WHERE id = NEW."formulaVersionId";
    IF st IS DISTINCT FROM 'PUBLISHED' THEN RAISE EXCEPTION 'medição exige versão publicada de fórmula' USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER measurement_revision_formula_check BEFORE INSERT ON "measurement_revision" FOR EACH ROW EXECUTE FUNCTION measurement_revision_formula_published();

-- Memória de cálculo é somente inclusão.
CREATE OR REPLACE FUNCTION measurement_revision_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'revisões de medição são imutáveis' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER measurement_revision_immutable BEFORE UPDATE OR DELETE ON "measurement_revision" FOR EACH ROW EXECUTE FUNCTION measurement_revision_append_only();

-- A medição não pode ser apagada (arquivamento) e sua âncora/nó/serviço não mudam.
CREATE OR REPLACE FUNCTION measurement_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'medições não são apagadas; use arquivamento' USING ERRCODE = 'check_violation'; END IF;
  IF NEW."wbsNodeId" <> OLD."wbsNodeId" OR NEW."serviceId" <> OLD."serviceId" OR NEW."anchorKind" <> OLD."anchorKind"
     OR NEW."structureNodeId" IS DISTINCT FROM OLD."structureNodeId" OR NEW."networkSegmentId" IS DISTINCT FROM OLD."networkSegmentId"
     OR NEW."networkNodeId" IS DISTINCT FROM OLD."networkNodeId" OR NEW."physicalElementId" IS DISTINCT FROM OLD."physicalElementId"
     OR NEW."typologyId" IS DISTINCT FROM OLD."typologyId" OR NEW."elementKey" IS DISTINCT FROM OLD."elementKey"
     OR NEW."dwellingUnitId" IS DISTINCT FROM OLD."dwellingUnitId" THEN
    RAISE EXCEPTION 'nó da EAP, serviço e âncora de uma medição não mudam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER measurement_identity BEFORE UPDATE OR DELETE ON "measurement" FOR EACH ROW EXECUTE FUNCTION measurement_guard();
