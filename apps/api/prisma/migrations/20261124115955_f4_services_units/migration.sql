-- CreateEnum
CREATE TYPE "ServiceOrigin" AS ENUM ('CATALOG', 'PROJECT', 'DUPLICATE', 'IMPORT');

-- CreateTable
CREATE TABLE "unit_of_measure" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "symbol" VARCHAR(12) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "dimL" SMALLINT NOT NULL,
    "dimM" SMALLINT NOT NULL,
    "dimT" SMALLINT NOT NULL,
    "dimN" SMALLINT NOT NULL,
    "factor" DECIMAL(40,30) NOT NULL,
    "decimals" SMALLINT NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_of_measure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_category" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "parentId" UUID,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "code" VARCHAR(30) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "normalizedDescription" VARCHAR(300) NOT NULL,
    "categoryId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "measurementCriterion" VARCHAR(2000),
    "technicalDescription" VARCHAR(4000),
    "origin" "ServiceOrigin" NOT NULL,
    "derivedFromId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_of_measure_id_organizationId_key" ON "unit_of_measure"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_of_measure_organizationId_symbol_key" ON "unit_of_measure"("organizationId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "service_category_id_organizationId_key" ON "service_category"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "service_category_organizationId_code_key" ON "service_category"("organizationId", "code");

-- CreateIndex
CREATE INDEX "service_organizationId_projectId_categoryId_idx" ON "service"("organizationId", "projectId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "service_id_organizationId_key" ON "service"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "unit_of_measure" ADD CONSTRAINT "unit_of_measure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_category" ADD CONSTRAINT "service_category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_category" ADD CONSTRAINT "service_category_parentId_organizationId_fkey" FOREIGN KEY ("parentId", "organizationId") REFERENCES "service_category"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service" ADD CONSTRAINT "service_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service" ADD CONSTRAINT "service_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service" ADD CONSTRAINT "service_categoryId_organizationId_fkey" FOREIGN KEY ("categoryId", "organizationId") REFERENCES "service_category"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service" ADD CONSTRAINT "service_unitId_organizationId_fkey" FOREIGN KEY ("unitId", "organizationId") REFERENCES "unit_of_measure"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service" ADD CONSTRAINT "service_derivedFromId_organizationId_fkey" FOREIGN KEY ("derivedFromId", "organizationId") REFERENCES "service"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== Restrições adicionais F4 =====
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Código único no catálogo da organização e, separadamente, dentro de cada empreendimento.
CREATE UNIQUE INDEX service_catalog_code_unique ON "service" ("organizationId", code) WHERE "projectId" IS NULL;
CREATE UNIQUE INDEX service_project_code_unique ON "service" ("projectId", code) WHERE "projectId" IS NOT NULL;
-- Busca por similaridade de descrição (aviso de possível duplicidade).
CREATE INDEX service_normalized_trgm ON "service" USING gin ("normalizedDescription" gin_trgm_ops);

ALTER TABLE "unit_of_measure" ADD CONSTRAINT unit_factor_positive CHECK (factor > 0);
ALTER TABLE "unit_of_measure" ADD CONSTRAINT unit_decimals_range CHECK (decimals BETWEEN 0 AND 6);
ALTER TABLE "unit_of_measure" ADD CONSTRAINT unit_dims_range CHECK (abs("dimL") <= 4 AND abs("dimM") <= 4 AND abs("dimT") <= 4 AND abs("dimN") <= 4);
ALTER TABLE "service_category" ADD CONSTRAINT service_category_not_self CHECK ("parentId" IS NULL OR "parentId" <> id);

-- Dimensão e fator de uma unidade em uso não mudam (quantidades existentes mudariam de significado).
CREATE OR REPLACE FUNCTION unit_of_measure_guard() RETURNS trigger AS $$
BEGIN
  IF (NEW."dimL", NEW."dimM", NEW."dimT", NEW."dimN", NEW.factor) IS DISTINCT FROM (OLD."dimL", OLD."dimM", OLD."dimT", OLD."dimN", OLD.factor)
     AND EXISTS (SELECT 1 FROM "service" WHERE "unitId" = OLD.id) THEN
    RAISE EXCEPTION 'dimensão e fator de unidade em uso são imutáveis' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER unit_of_measure_immutable_when_used BEFORE UPDATE ON "unit_of_measure" FOR EACH ROW EXECUTE FUNCTION unit_of_measure_guard();
