-- CreateEnum
CREATE TYPE "ElementDomain" AS ENUM ('INFRA', 'CONSTRUTIVO');

-- CreateEnum
CREATE TYPE "ElementCategory" AS ENUM ('NETWORK_NODE', 'NETWORK_SEGMENT', 'ELEMENT');

-- CreateEnum
CREATE TYPE "AttributeDataType" AS ENUM ('NUMBER', 'TEXT', 'BOOLEAN', 'ENUM');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "UnitOverrideOp" AS ENUM ('EXCLUDE_ELEMENT', 'ADD_ELEMENT');

-- AlterTable
ALTER TABLE "dwelling_unit" ADD COLUMN     "pinnedRevisionId" UUID;

-- CreateTable
CREATE TABLE "infrastructure_system_type" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "networkBased" BOOLEAN NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "infrastructure_system_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "element_type" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "domain" "ElementDomain" NOT NULL,
    "category" "ElementCategory" NOT NULL,
    "systemTypeId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "element_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "element_attribute_definition" (
    "id" UUID NOT NULL,
    "elementTypeId" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "dataType" "AttributeDataType" NOT NULL,
    "unit" VARCHAR(16),
    "required" BOOLEAN NOT NULL DEFAULT false,
    "enumValues" TEXT[],
    "min" DECIMAL(18,6),
    "max" DECIMAL(18,6),
    "position" INTEGER NOT NULL,

    CONSTRAINT "element_attribute_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infrastructure_system" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "systemTypeId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "scopeNodeId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "infrastructure_system_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "infrastructure_network" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "systemId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "infrastructure_network_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_node" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "elementTypeId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "locationNodeId" UUID,
    "coverElevation" DECIMAL(10,3),
    "bottomElevation" DECIMAL(10,3),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "network_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_segment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "networkId" UUID NOT NULL,
    "elementTypeId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "fromNodeId" UUID NOT NULL,
    "toNodeId" UUID NOT NULL,
    "streetSectionId" UUID,
    "length" DECIMAL(12,3) NOT NULL,
    "diameter" DECIMAL(8,1),
    "material" VARCHAR(60),
    "upstreamInvert" DECIMAL(10,3),
    "downstreamInvert" DECIMAL(10,3),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "network_segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physical_element" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "elementTypeId" UUID NOT NULL,
    "systemId" UUID,
    "structureNodeId" UUID,
    "name" VARCHAR(120) NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "physical_element_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "typology_revision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "typologyId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(1000),
    "publishedAt" TIMESTAMPTZ(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "typology_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "typology_element" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "parentId" UUID,
    "stableKey" UUID NOT NULL,
    "elementTypeId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL,

    CONSTRAINT "typology_element_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_override" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "op" "UnitOverrideOp" NOT NULL,
    "targetStableKey" UUID,
    "parentStableKey" UUID,
    "elementTypeId" UUID,
    "name" VARCHAR(120),
    "attributes" JSONB,
    "reason" VARCHAR(500) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMPTZ(3),
    "archiveReason" VARCHAR(500),

    CONSTRAINT "unit_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "infrastructure_system_type_id_organizationId_key" ON "infrastructure_system_type"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "infrastructure_system_type_organizationId_code_key" ON "infrastructure_system_type"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "element_type_id_organizationId_key" ON "element_type"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "element_type_organizationId_code_key" ON "element_type"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "element_attribute_definition_elementTypeId_key_key" ON "element_attribute_definition"("elementTypeId", "key");

-- CreateIndex
CREATE INDEX "infrastructure_system_organizationId_projectId_idx" ON "infrastructure_system"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "infrastructure_system_id_projectId_key" ON "infrastructure_system"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "infrastructure_network_id_projectId_key" ON "infrastructure_network"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "infrastructure_network_systemId_code_key" ON "infrastructure_network"("systemId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "network_node_id_networkId_key" ON "network_node"("id", "networkId");

-- CreateIndex
CREATE UNIQUE INDEX "network_node_networkId_code_key" ON "network_node"("networkId", "code");

-- CreateIndex
CREATE INDEX "network_segment_networkId_fromNodeId_idx" ON "network_segment"("networkId", "fromNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "network_segment_networkId_code_key" ON "network_segment"("networkId", "code");

-- CreateIndex
CREATE INDEX "physical_element_projectId_systemId_idx" ON "physical_element"("projectId", "systemId");

-- CreateIndex
CREATE INDEX "physical_element_projectId_structureNodeId_idx" ON "physical_element"("projectId", "structureNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "typology_revision_id_projectId_key" ON "typology_revision"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "typology_revision_typologyId_number_key" ON "typology_revision"("typologyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "typology_element_id_revisionId_key" ON "typology_element"("id", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "typology_element_revisionId_stableKey_key" ON "typology_element"("revisionId", "stableKey");

-- CreateIndex
CREATE INDEX "unit_override_projectId_unitId_idx" ON "unit_override"("projectId", "unitId");

-- AddForeignKey
ALTER TABLE "dwelling_unit" ADD CONSTRAINT "dwelling_unit_pinnedRevisionId_projectId_fkey" FOREIGN KEY ("pinnedRevisionId", "projectId") REFERENCES "typology_revision"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infrastructure_system_type" ADD CONSTRAINT "infrastructure_system_type_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_type" ADD CONSTRAINT "element_type_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_type" ADD CONSTRAINT "element_type_systemTypeId_organizationId_fkey" FOREIGN KEY ("systemTypeId", "organizationId") REFERENCES "infrastructure_system_type"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_attribute_definition" ADD CONSTRAINT "element_attribute_definition_elementTypeId_fkey" FOREIGN KEY ("elementTypeId") REFERENCES "element_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infrastructure_system" ADD CONSTRAINT "infrastructure_system_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infrastructure_system" ADD CONSTRAINT "infrastructure_system_systemTypeId_organizationId_fkey" FOREIGN KEY ("systemTypeId", "organizationId") REFERENCES "infrastructure_system_type"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infrastructure_system" ADD CONSTRAINT "infrastructure_system_scopeNodeId_projectId_fkey" FOREIGN KEY ("scopeNodeId", "projectId") REFERENCES "structure_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "infrastructure_network" ADD CONSTRAINT "infrastructure_network_systemId_projectId_fkey" FOREIGN KEY ("systemId", "projectId") REFERENCES "infrastructure_system"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_node" ADD CONSTRAINT "network_node_networkId_projectId_fkey" FOREIGN KEY ("networkId", "projectId") REFERENCES "infrastructure_network"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_node" ADD CONSTRAINT "network_node_elementTypeId_organizationId_fkey" FOREIGN KEY ("elementTypeId", "organizationId") REFERENCES "element_type"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_node" ADD CONSTRAINT "network_node_locationNodeId_projectId_fkey" FOREIGN KEY ("locationNodeId", "projectId") REFERENCES "structure_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_segment" ADD CONSTRAINT "network_segment_networkId_projectId_fkey" FOREIGN KEY ("networkId", "projectId") REFERENCES "infrastructure_network"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_segment" ADD CONSTRAINT "network_segment_elementTypeId_organizationId_fkey" FOREIGN KEY ("elementTypeId", "organizationId") REFERENCES "element_type"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_segment" ADD CONSTRAINT "network_segment_fromNodeId_networkId_fkey" FOREIGN KEY ("fromNodeId", "networkId") REFERENCES "network_node"("id", "networkId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_segment" ADD CONSTRAINT "network_segment_toNodeId_networkId_fkey" FOREIGN KEY ("toNodeId", "networkId") REFERENCES "network_node"("id", "networkId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_segment" ADD CONSTRAINT "network_segment_streetSectionId_projectId_fkey" FOREIGN KEY ("streetSectionId", "projectId") REFERENCES "structure_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_element" ADD CONSTRAINT "physical_element_elementTypeId_organizationId_fkey" FOREIGN KEY ("elementTypeId", "organizationId") REFERENCES "element_type"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_element" ADD CONSTRAINT "physical_element_systemId_projectId_fkey" FOREIGN KEY ("systemId", "projectId") REFERENCES "infrastructure_system"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_element" ADD CONSTRAINT "physical_element_structureNodeId_projectId_fkey" FOREIGN KEY ("structureNodeId", "projectId") REFERENCES "structure_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "typology_revision" ADD CONSTRAINT "typology_revision_typologyId_projectId_fkey" FOREIGN KEY ("typologyId", "projectId") REFERENCES "dwelling_typology"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "typology_element" ADD CONSTRAINT "typology_element_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "typology_revision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "typology_element" ADD CONSTRAINT "typology_element_parentId_revisionId_fkey" FOREIGN KEY ("parentId", "revisionId") REFERENCES "typology_element"("id", "revisionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "typology_element" ADD CONSTRAINT "typology_element_elementTypeId_organizationId_fkey" FOREIGN KEY ("elementTypeId", "organizationId") REFERENCES "element_type"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_override" ADD CONSTRAINT "unit_override_unitId_projectId_fkey" FOREIGN KEY ("unitId", "projectId") REFERENCES "dwelling_unit"("structureNodeId", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_override" ADD CONSTRAINT "unit_override_elementTypeId_organizationId_fkey" FOREIGN KEY ("elementTypeId", "organizationId") REFERENCES "element_type"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Restrições adicionais F3 (ADR-003/008/010) =====
ALTER TABLE "network_segment" ADD CONSTRAINT network_segment_distinct_nodes CHECK ("fromNodeId" <> "toNodeId");
ALTER TABLE "network_segment" ADD CONSTRAINT network_segment_length_positive CHECK (length > 0);
ALTER TABLE "network_segment" ADD CONSTRAINT network_segment_diameter_positive CHECK (diameter IS NULL OR diameter > 0);
ALTER TABLE "physical_element" ADD CONSTRAINT physical_element_anchor CHECK ("systemId" IS NOT NULL OR "structureNodeId" IS NOT NULL);
ALTER TABLE "typology_revision" ADD CONSTRAINT typology_revision_published_consistency CHECK ((status = 'PUBLISHED') = ("publishedAt" IS NOT NULL));
ALTER TABLE "typology_revision" ADD CONSTRAINT typology_revision_number_positive CHECK (number >= 1);
CREATE UNIQUE INDEX typology_revision_single_draft ON "typology_revision" ("typologyId") WHERE status = 'DRAFT';
ALTER TABLE "unit_override" ADD CONSTRAINT unit_override_shape CHECK (
  (op = 'EXCLUDE_ELEMENT' AND "targetStableKey" IS NOT NULL AND "elementTypeId" IS NULL AND name IS NULL)
  OR (op = 'ADD_ELEMENT' AND "targetStableKey" IS NULL AND "elementTypeId" IS NOT NULL AND name IS NOT NULL)
);

-- Revisão publicada é imutável; só a transição DRAFT -> PUBLISHED é permitida.
CREATE OR REPLACE FUNCTION typology_revision_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'typology_revision publicada é imutável' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'typology_revision publicada é imutável' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER typology_revision_immutable BEFORE UPDATE OR DELETE ON "typology_revision" FOR EACH ROW EXECUTE FUNCTION typology_revision_guard();

-- Elementos de revisão publicada não mudam.
CREATE OR REPLACE FUNCTION typology_element_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status::text INTO st FROM "typology_revision" WHERE id = COALESCE(NEW."revisionId", OLD."revisionId");
  IF st = 'PUBLISHED' THEN RAISE EXCEPTION 'elementos de revisão publicada são imutáveis' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER typology_element_immutable BEFORE INSERT OR UPDATE OR DELETE ON "typology_element" FOR EACH ROW EXECUTE FUNCTION typology_element_guard();

-- Unidade só pode ser fixada numa revisão PUBLICADA da sua própria tipologia.
CREATE OR REPLACE FUNCTION dwelling_unit_pin_guard() RETURNS trigger AS $$
DECLARE r record;
BEGIN
  IF NEW."pinnedRevisionId" IS NULL THEN RETURN NEW; END IF;
  SELECT "typologyId", status::text AS status INTO r FROM "typology_revision" WHERE id = NEW."pinnedRevisionId";
  IF r.status <> 'PUBLISHED' OR r."typologyId" IS DISTINCT FROM NEW."typologyId" THEN
    RAISE EXCEPTION 'unidade só pode ser fixada em revisão publicada da própria tipologia' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER dwelling_unit_pin BEFORE INSERT OR UPDATE OF "pinnedRevisionId", "typologyId" ON "dwelling_unit" FOR EACH ROW EXECUTE FUNCTION dwelling_unit_pin_guard();

-- Particularidades: nunca apagadas; só podem ser arquivadas (uma vez).
CREATE OR REPLACE FUNCTION unit_override_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'unit_override não pode ser apagada (arquive)' USING ERRCODE = 'check_violation'; END IF;
  IF OLD."archivedAt" IS NOT NULL
     OR NEW.op IS DISTINCT FROM OLD.op OR NEW."targetStableKey" IS DISTINCT FROM OLD."targetStableKey"
     OR NEW."parentStableKey" IS DISTINCT FROM OLD."parentStableKey" OR NEW."elementTypeId" IS DISTINCT FROM OLD."elementTypeId"
     OR NEW.name IS DISTINCT FROM OLD.name OR NEW.attributes::text IS DISTINCT FROM OLD.attributes::text
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW."unitId" IS DISTINCT FROM OLD."unitId" THEN
    RAISE EXCEPTION 'unit_override só permite arquivamento' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER unit_override_append_only BEFORE UPDATE OR DELETE ON "unit_override" FOR EACH ROW EXECUTE FUNCTION unit_override_guard();
