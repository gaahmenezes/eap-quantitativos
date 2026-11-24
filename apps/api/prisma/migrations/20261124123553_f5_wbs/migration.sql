-- CreateEnum
CREATE TYPE "WbsNodeType" AS ENUM ('GROUP', 'ITEM');

-- CreateEnum
CREATE TYPE "WbsNodeOrigin" AS ENUM ('GENERATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "WbsNodeStatus" AS ENUM ('ACTIVE', 'OBSOLETE');

-- CreateEnum
CREATE TYPE "WbsRepeatScope" AS ENUM ('TOWER', 'BUILDING_BLOCK', 'FLOOR', 'DWELLING_UNIT', 'DWELLING_TYPOLOGY', 'COMMON_AREA', 'SPECIAL_AREA', 'PHASE', 'STAGE', 'SECTOR', 'BLOCK_QUADRA', 'LOT', 'STREET', 'STREET_SECTION', 'INFRA_SYSTEM', 'NETWORK');

-- CreateEnum
CREATE TYPE "WbsBindingKind" AS ENUM ('MODULE', 'STRUCTURE', 'TYPOLOGY', 'SYSTEM', 'NETWORK');

-- DropIndex
DROP INDEX "service_normalized_trgm";

-- CreateTable
CREATE TABLE "wbs_template" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "moduleKinds" "ModuleKind"[],
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wbs_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wbs_template_version" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(1000),
    "publishedAt" TIMESTAMPTZ(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wbs_template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wbs_template_node" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "parentId" UUID,
    "stableKey" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "nodeType" "WbsNodeType" NOT NULL,
    "condition" VARCHAR(500),
    "repeat" "WbsRepeatScope",
    "position" INTEGER NOT NULL,
    "serviceIds" UUID[],

    CONSTRAINT "wbs_template_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wbs_node" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "parentId" UUID,
    "title" VARCHAR(200) NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "depth" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "nodeType" "WbsNodeType" NOT NULL,
    "origin" "WbsNodeOrigin" NOT NULL,
    "status" "WbsNodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "generationKey" VARCHAR(600),
    "moduleId" UUID,
    "templateVersionId" UUID,
    "templateNodeKey" VARCHAR(60),
    "bindingKind" "WbsBindingKind",
    "bindingId" UUID,
    "titleOverridden" BOOLEAN NOT NULL DEFAULT false,
    "placementOverridden" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wbs_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wbs_node_service" (
    "wbsNodeId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "fromTemplate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wbs_node_service_pkey" PRIMARY KEY ("wbsNodeId","serviceId")
);

-- CreateTable
CREATE TABLE "wbs_generation_run" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "selections" JSONB NOT NULL,
    "factsHash" VARCHAR(16) NOT NULL,
    "resultHash" VARCHAR(16) NOT NULL,
    "summary" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wbs_generation_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wbs_template_id_organizationId_key" ON "wbs_template"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "wbs_template_organizationId_code_key" ON "wbs_template"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "wbs_template_version_id_organizationId_key" ON "wbs_template_version"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "wbs_template_version_templateId_number_key" ON "wbs_template_version"("templateId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "wbs_template_node_id_versionId_key" ON "wbs_template_node"("id", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "wbs_template_node_versionId_stableKey_key" ON "wbs_template_node"("versionId", "stableKey");

-- CreateIndex
CREATE INDEX "wbs_node_projectId_parentId_position_idx" ON "wbs_node"("projectId", "parentId", "position");

-- CreateIndex
CREATE INDEX "wbs_node_projectId_path_idx" ON "wbs_node"("projectId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "wbs_node_id_projectId_key" ON "wbs_node"("id", "projectId");

-- CreateIndex
CREATE INDEX "wbs_node_service_projectId_serviceId_idx" ON "wbs_node_service"("projectId", "serviceId");

-- CreateIndex
CREATE INDEX "wbs_generation_run_projectId_createdAt_idx" ON "wbs_generation_run"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "wbs_template" ADD CONSTRAINT "wbs_template_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_template_version" ADD CONSTRAINT "wbs_template_version_templateId_organizationId_fkey" FOREIGN KEY ("templateId", "organizationId") REFERENCES "wbs_template"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_template_node" ADD CONSTRAINT "wbs_template_node_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "wbs_template_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_template_node" ADD CONSTRAINT "wbs_template_node_parentId_versionId_fkey" FOREIGN KEY ("parentId", "versionId") REFERENCES "wbs_template_node"("id", "versionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_node" ADD CONSTRAINT "wbs_node_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_node" ADD CONSTRAINT "wbs_node_parentId_projectId_fkey" FOREIGN KEY ("parentId", "projectId") REFERENCES "wbs_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_node" ADD CONSTRAINT "wbs_node_templateVersionId_organizationId_fkey" FOREIGN KEY ("templateVersionId", "organizationId") REFERENCES "wbs_template_version"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_node_service" ADD CONSTRAINT "wbs_node_service_wbsNodeId_projectId_fkey" FOREIGN KEY ("wbsNodeId", "projectId") REFERENCES "wbs_node"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_node_service" ADD CONSTRAINT "wbs_node_service_serviceId_organizationId_fkey" FOREIGN KEY ("serviceId", "organizationId") REFERENCES "service"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wbs_generation_run" ADD CONSTRAINT "wbs_generation_run_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Restrições adicionais F5 (ADR-005/008) =====
CREATE UNIQUE INDEX wbs_node_generation_key_unique ON "wbs_node" ("projectId", "generationKey") WHERE "generationKey" IS NOT NULL;
CREATE UNIQUE INDEX wbs_template_version_single_draft ON "wbs_template_version" ("templateId") WHERE status = 'DRAFT';
ALTER TABLE "wbs_node" ADD CONSTRAINT wbs_node_origin_key CHECK ((origin = 'GENERATED') = ("generationKey" IS NOT NULL));
ALTER TABLE "wbs_node" ADD CONSTRAINT wbs_node_position_positive CHECK (position >= 1);
ALTER TABLE "wbs_node" ADD CONSTRAINT wbs_node_not_self_parent CHECK ("parentId" IS NULL OR "parentId" <> id);
ALTER TABLE "wbs_node" ADD CONSTRAINT wbs_node_binding_pair CHECK (("bindingKind" IS NULL) = ("bindingId" IS NULL));
ALTER TABLE "wbs_template_version" ADD CONSTRAINT wbs_template_version_published CHECK ((status = 'PUBLISHED') = ("publishedAt" IS NOT NULL));

-- Versão publicada de template é imutável e não pode ser apagada.
CREATE OR REPLACE FUNCTION wbs_template_version_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'versão publicada de template é imutável' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wbs_template_version_immutable BEFORE UPDATE OR DELETE ON "wbs_template_version" FOR EACH ROW EXECUTE FUNCTION wbs_template_version_guard();

CREATE OR REPLACE FUNCTION wbs_template_node_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status::text INTO st FROM "wbs_template_version" WHERE id = COALESCE(NEW."versionId", OLD."versionId");
  IF st = 'PUBLISHED' THEN RAISE EXCEPTION 'nós de versão publicada de template são imutáveis' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wbs_template_node_immutable BEFORE INSERT OR UPDATE OR DELETE ON "wbs_template_node" FOR EACH ROW EXECUTE FUNCTION wbs_template_node_guard();
