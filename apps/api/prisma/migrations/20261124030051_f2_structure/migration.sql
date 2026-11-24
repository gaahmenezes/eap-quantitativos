-- CreateEnum
CREATE TYPE "ModuleKind" AS ENUM ('VERTICAL_RESIDENTIAL', 'HORIZONTAL_RESIDENTIAL', 'LAND_SUBDIVISION', 'COMMON_AREAS', 'INFRASTRUCTURE');

-- CreateEnum
CREATE TYPE "StructureNodeKind" AS ENUM ('PHASE', 'STAGE', 'SECTOR', 'BLOCK_QUADRA', 'LOT', 'STREET', 'STREET_SECTION', 'TOWER', 'BUILDING_BLOCK', 'FLOOR', 'DWELLING_UNIT', 'COMMON_AREA', 'TECHNICAL_AREA', 'INSTITUTIONAL_AREA', 'GREEN_AREA');

-- CreateEnum
CREATE TYPE "NodeOrigin" AS ENUM ('WIZARD', 'MANUAL', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "TypologyKind" AS ENUM ('APARTMENT', 'HOUSE');

-- CreateTable
CREATE TABLE "project_module" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "ModuleKind" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "position" INTEGER NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structure_node" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "moduleId" UUID NOT NULL,
    "parentId" UUID,
    "kind" "StructureNodeKind" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "position" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "origin" "NodeOrigin" NOT NULL DEFAULT 'MANUAL',
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "structure_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dwelling_unit" (
    "structureNodeId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "typologyId" UUID,

    CONSTRAINT "dwelling_unit_pkey" PRIMARY KEY ("structureNodeId")
);

-- CreateTable
CREATE TABLE "lot_detail" (
    "structureNodeId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "area" DECIMAL(14,4),
    "frontage" DECIMAL(10,3),

    CONSTRAINT "lot_detail_pkey" PRIMARY KEY ("structureNodeId")
);

-- CreateTable
CREATE TABLE "dwelling_typology" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" "TypologyKind" NOT NULL,
    "description" VARCHAR(2000),
    "privateArea" DECIMAL(12,4),
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dwelling_typology_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_module_organizationId_projectId_idx" ON "project_module"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_module_id_organizationId_key" ON "project_module"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "project_module_id_projectId_key" ON "project_module"("id", "projectId");

-- CreateIndex
CREATE INDEX "structure_node_projectId_moduleId_parentId_position_idx" ON "structure_node"("projectId", "moduleId", "parentId", "position");

-- CreateIndex
CREATE INDEX "structure_node_projectId_path_idx" ON "structure_node"("projectId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "structure_node_id_projectId_key" ON "structure_node"("id", "projectId");

-- CreateIndex
CREATE INDEX "dwelling_unit_projectId_typologyId_idx" ON "dwelling_unit"("projectId", "typologyId");

-- CreateIndex
CREATE UNIQUE INDEX "dwelling_unit_structureNodeId_projectId_key" ON "dwelling_unit"("structureNodeId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "lot_detail_structureNodeId_projectId_key" ON "lot_detail"("structureNodeId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "dwelling_typology_id_projectId_key" ON "dwelling_typology"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "dwelling_typology_projectId_code_key" ON "dwelling_typology"("projectId", "code");

-- AddForeignKey
ALTER TABLE "project_module" ADD CONSTRAINT "project_module_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structure_node" ADD CONSTRAINT "structure_node_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structure_node" ADD CONSTRAINT "structure_node_moduleId_projectId_fkey" FOREIGN KEY ("moduleId", "projectId") REFERENCES "project_module"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structure_node" ADD CONSTRAINT "structure_node_parentId_projectId_fkey" FOREIGN KEY ("parentId", "projectId") REFERENCES "structure_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dwelling_unit" ADD CONSTRAINT "dwelling_unit_structureNodeId_projectId_fkey" FOREIGN KEY ("structureNodeId", "projectId") REFERENCES "structure_node"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dwelling_unit" ADD CONSTRAINT "dwelling_unit_typologyId_projectId_fkey" FOREIGN KEY ("typologyId", "projectId") REFERENCES "dwelling_typology"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_detail" ADD CONSTRAINT "lot_detail_structureNodeId_projectId_fkey" FOREIGN KEY ("structureNodeId", "projectId") REFERENCES "structure_node"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dwelling_typology" ADD CONSTRAINT "dwelling_typology_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Restrições adicionais F2 (ADR-003) =====
ALTER TABLE "structure_node" ADD CONSTRAINT structure_node_position_positive CHECK (position >= 1);
ALTER TABLE "structure_node" ADD CONSTRAINT structure_node_depth_nonneg CHECK (depth >= 0);
ALTER TABLE "structure_node" ADD CONSTRAINT structure_node_version_positive CHECK (version >= 1);
ALTER TABLE "structure_node" ADD CONSTRAINT structure_node_not_self_parent CHECK ("parentId" IS NULL OR "parentId" <> id);
ALTER TABLE "project_module" ADD CONSTRAINT project_module_position_positive CHECK (position >= 1);
ALTER TABLE "lot_detail" ADD CONSTRAINT lot_detail_area_positive CHECK (area IS NULL OR area > 0);
ALTER TABLE "lot_detail" ADD CONSTRAINT lot_detail_frontage_positive CHECK (frontage IS NULL OR frontage > 0);
ALTER TABLE "dwelling_typology" ADD CONSTRAINT dwelling_typology_area_positive CHECK ("privateArea" IS NULL OR "privateArea" > 0);

-- Pai sempre no mesmo módulo do filho.
CREATE OR REPLACE FUNCTION structure_node_check_parent() RETURNS trigger AS $$
DECLARE parent_module uuid;
BEGIN
  IF NEW."parentId" IS NOT NULL THEN
    SELECT "moduleId" INTO parent_module FROM "structure_node" WHERE id = NEW."parentId";
    IF parent_module IS DISTINCT FROM NEW."moduleId" THEN
      RAISE EXCEPTION 'structure_node: pai pertence a outro módulo' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER structure_node_parent_same_module BEFORE INSERT OR UPDATE OF "parentId", "moduleId" ON "structure_node"
  FOR EACH ROW EXECUTE FUNCTION structure_node_check_parent();

-- Detalhes 1:1 só para o tipo de nó correspondente.
CREATE OR REPLACE FUNCTION structure_detail_check_kind() RETURNS trigger AS $$
DECLARE k text;
BEGIN
  SELECT kind::text INTO k FROM "structure_node" WHERE id = NEW."structureNodeId";
  IF TG_TABLE_NAME = 'dwelling_unit' AND k <> 'DWELLING_UNIT' THEN
    RAISE EXCEPTION 'dwelling_unit exige nó do tipo DWELLING_UNIT' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'lot_detail' AND k <> 'LOT' THEN
    RAISE EXCEPTION 'lot_detail exige nó do tipo LOT' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER dwelling_unit_kind BEFORE INSERT OR UPDATE ON "dwelling_unit" FOR EACH ROW EXECUTE FUNCTION structure_detail_check_kind();
CREATE TRIGGER lot_detail_kind BEFORE INSERT OR UPDATE ON "lot_detail" FOR EACH ROW EXECUTE FUNCTION structure_detail_check_kind();

-- Tipo do nó é imutável (muda a semântica dos detalhes e das regras de hierarquia).
CREATE OR REPLACE FUNCTION structure_node_kind_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'structure_node.kind é imutável' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER structure_node_kind_lock BEFORE UPDATE OF kind ON "structure_node" FOR EACH ROW EXECUTE FUNCTION structure_node_kind_immutable();
