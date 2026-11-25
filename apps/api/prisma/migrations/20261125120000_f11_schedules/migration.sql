-- CreateEnum
CREATE TYPE "ScheduleKind" AS ENUM ('ESQUADRIAS', 'LOUCAS_METAIS', 'INSTALACOES_HIDRAULICAS', 'INSTALACOES_ELETRICAS', 'OUTROS');

-- AlterEnum
ALTER TYPE "MeasurementMethod" ADD VALUE 'SCHEDULE';

-- AlterTable
ALTER TABLE "measurement" ADD COLUMN     "scheduleId" UUID,
ADD COLUMN     "scheduleKey" VARCHAR(80);

-- CreateTable
CREATE TABLE "schedule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "ScheduleKind" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "sourceReference" VARCHAR(300),
    "documentId" UUID,
    "launchedHash" CHAR(64),
    "launchedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_column" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "key" VARCHAR(20) NOT NULL,
    "position" INTEGER NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "wbsNodeId" UUID,
    "anchorKind" "MeasurementAnchorKind",
    "structureNodeId" UUID,
    "networkSegmentId" UUID,
    "networkNodeId" UUID,
    "physicalElementId" UUID,
    "typologyId" UUID,
    "elementKey" VARCHAR(80),
    "dwellingUnitId" UUID,

    CONSTRAINT "schedule_column_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_row" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "key" VARCHAR(20) NOT NULL,
    "position" INTEGER NOT NULL,
    "code" VARCHAR(30),
    "description" VARCHAR(200) NOT NULL,
    "spec" VARCHAR(200),
    "unitId" UUID NOT NULL,
    "width" DECIMAL(12,4),
    "height" DECIMAL(12,4),
    "cells" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "schedule_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_row_service" (
    "rowId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "schedule_row_service_pkey" PRIMARY KEY ("rowId","serviceId")
);

-- CreateIndex
CREATE INDEX "schedule_projectId_archivedAt_idx" ON "schedule"("projectId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_id_projectId_key" ON "schedule"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_column_scheduleId_key_key" ON "schedule_column"("scheduleId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_row_id_organizationId_key" ON "schedule_row"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_row_scheduleId_key_key" ON "schedule_row"("scheduleId", "key");

-- CreateIndex
CREATE INDEX "measurement_scheduleId_idx" ON "measurement"("scheduleId");

-- AddForeignKey
ALTER TABLE "measurement" ADD CONSTRAINT "measurement_scheduleId_projectId_fkey" FOREIGN KEY ("scheduleId", "projectId") REFERENCES "schedule"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_documentId_organizationId_fkey" FOREIGN KEY ("documentId", "organizationId") REFERENCES "document"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_column" ADD CONSTRAINT "schedule_column_scheduleId_projectId_fkey" FOREIGN KEY ("scheduleId", "projectId") REFERENCES "schedule"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_column" ADD CONSTRAINT "schedule_column_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_column" ADD CONSTRAINT "schedule_column_wbsNodeId_projectId_fkey" FOREIGN KEY ("wbsNodeId", "projectId") REFERENCES "wbs_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_column" ADD CONSTRAINT "schedule_column_structureNodeId_projectId_fkey" FOREIGN KEY ("structureNodeId", "projectId") REFERENCES "structure_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_column" ADD CONSTRAINT "schedule_column_networkSegmentId_projectId_fkey" FOREIGN KEY ("networkSegmentId", "projectId") REFERENCES "network_segment"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_column" ADD CONSTRAINT "schedule_column_networkNodeId_projectId_fkey" FOREIGN KEY ("networkNodeId", "projectId") REFERENCES "network_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_column" ADD CONSTRAINT "schedule_column_physicalElementId_projectId_fkey" FOREIGN KEY ("physicalElementId", "projectId") REFERENCES "physical_element"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_column" ADD CONSTRAINT "schedule_column_typologyId_projectId_fkey" FOREIGN KEY ("typologyId", "projectId") REFERENCES "dwelling_typology"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_column" ADD CONSTRAINT "schedule_column_dwellingUnitId_projectId_fkey" FOREIGN KEY ("dwellingUnitId", "projectId") REFERENCES "dwelling_unit"("structureNodeId", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_row" ADD CONSTRAINT "schedule_row_scheduleId_projectId_fkey" FOREIGN KEY ("scheduleId", "projectId") REFERENCES "schedule"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_row" ADD CONSTRAINT "schedule_row_unitId_organizationId_fkey" FOREIGN KEY ("unitId", "organizationId") REFERENCES "unit_of_measure"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_row_service" ADD CONSTRAINT "schedule_row_service_rowId_organizationId_fkey" FOREIGN KEY ("rowId", "organizationId") REFERENCES "schedule_row"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_row_service" ADD CONSTRAINT "schedule_row_service_serviceId_organizationId_fkey" FOREIGN KEY ("serviceId", "organizationId") REFERENCES "service"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================== Regras de banco dos quadros (ADR-021) =====================
ALTER TABLE "schedule_column" ADD CONSTRAINT schedule_column_anchor CHECK (
  (("structureNodeId" IS NOT NULL)::int + ("networkSegmentId" IS NOT NULL)::int + ("networkNodeId" IS NOT NULL)::int
   + ("physicalElementId" IS NOT NULL)::int + ("typologyId" IS NOT NULL)::int) = CASE WHEN "anchorKind" IS NULL THEN 0 ELSE 1 END
  AND ("anchorKind" IS DISTINCT FROM 'STRUCTURE_NODE' OR "structureNodeId" IS NOT NULL)
  AND ("anchorKind" IS DISTINCT FROM 'NETWORK_SEGMENT' OR "networkSegmentId" IS NOT NULL)
  AND ("anchorKind" IS DISTINCT FROM 'NETWORK_NODE' OR "networkNodeId" IS NOT NULL)
  AND ("anchorKind" IS DISTINCT FROM 'PHYSICAL_ELEMENT' OR "physicalElementId" IS NOT NULL)
  AND (("typologyId" IS NULL) = ("elementKey" IS NULL))
  AND ("dwellingUnitId" IS NULL OR "typologyId" IS NOT NULL)
);
ALTER TABLE "schedule_row" ADD CONSTRAINT schedule_row_dims CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0));
ALTER TABLE "schedule" ADD CONSTRAINT schedule_launch CHECK (("launchedAt" IS NULL) = ("launchedHash" IS NULL));

-- Quadros não são apagados (arquivamento); linhas e destinos são parte editável do quadro.
CREATE OR REPLACE FUNCTION schedule_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'quadros não são apagados; use arquivamento' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER schedule_keep BEFORE DELETE ON "schedule" FOR EACH ROW EXECUTE FUNCTION schedule_no_delete();

-- Uma origem por medição (ficha ou quadro); a origem nunca muda; uma medição ativa por chave do quadro.
ALTER TABLE "measurement" ADD CONSTRAINT measurement_schedule_origin CHECK (("scheduleId" IS NULL) = ("scheduleKey" IS NULL));
ALTER TABLE "measurement" ADD CONSTRAINT measurement_single_origin CHECK ("sheetId" IS NULL OR "scheduleId" IS NULL);
CREATE OR REPLACE FUNCTION measurement_schedule_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."scheduleId" IS DISTINCT FROM OLD."scheduleId" OR NEW."scheduleKey" IS DISTINCT FROM OLD."scheduleKey" THEN
    RAISE EXCEPTION 'o quadro de origem de uma medição não muda' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER measurement_schedule_identity BEFORE UPDATE ON "measurement" FOR EACH ROW EXECUTE FUNCTION measurement_schedule_guard();
CREATE UNIQUE INDEX measurement_schedule_key_active ON "measurement"("scheduleId", "scheduleKey") WHERE "scheduleId" IS NOT NULL AND "archivedAt" IS NULL;
