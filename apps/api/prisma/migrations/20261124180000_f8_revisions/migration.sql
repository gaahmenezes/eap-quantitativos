-- CreateTable
CREATE TABLE "project_revision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "notes" VARCHAR(2000),
    "summary" JSONB NOT NULL,
    "issuedById" UUID NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_wbs_node" (
    "revisionId" UUID NOT NULL,
    "wbsNodeId" UUID NOT NULL,
    "parentId" UUID,
    "code" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "nodeType" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL,
    "depth" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "revision_wbs_node_pkey" PRIMARY KEY ("revisionId","wbsNodeId")
);

-- CreateTable
CREATE TABLE "revision_structure_node" (
    "revisionId" UUID NOT NULL,
    "structureNodeId" UUID NOT NULL,
    "parentId" UUID,
    "kind" VARCHAR(30) NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "depth" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "revision_structure_node_pkey" PRIMARY KEY ("revisionId","structureNodeId")
);

-- CreateTable
CREATE TABLE "revision_measurement" (
    "revisionId" UUID NOT NULL,
    "measurementId" UUID NOT NULL,
    "measurementRevisionId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "wbsNodeId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "serviceCode" VARCHAR(30) NOT NULL,
    "anchorLabel" VARCHAR(400) NOT NULL,
    "quantity" DECIMAL(28,10) NOT NULL,
    "unit" VARCHAR(12) NOT NULL,
    "multiplier" INTEGER NOT NULL,
    "effectiveTotal" DECIMAL(38,10) NOT NULL,

    CONSTRAINT "revision_measurement_pkey" PRIMARY KEY ("revisionId","measurementId")
);

-- CreateTable
CREATE TABLE "revision_line" (
    "id" BIGSERIAL NOT NULL,
    "revisionId" UUID NOT NULL,
    "mid" UUID NOT NULL,
    "qty" DECIMAL(28,10) NOT NULL,
    "unit_symbol" VARCHAR(12) NOT NULL,
    "wbsItem" UUID NOT NULL,
    "wbs1" UUID,
    "wbs2" UUID,
    "wbs3" UUID,
    "service" UUID NOT NULL,
    "category" UUID,
    "module" UUID,
    "PHASE" UUID,
    "STAGE" UUID,
    "SECTOR" UUID,
    "BLOCK_QUADRA" UUID,
    "LOT" UUID,
    "STREET" UUID,
    "TOWER" UUID,
    "BUILDING_BLOCK" UUID,
    "FLOOR" UUID,
    "typology" UUID,
    "unit" UUID,
    "system" UUID,
    "network" UUID,

    CONSTRAINT "revision_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_label" (
    "revisionId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "label" VARCHAR(400) NOT NULL,

    CONSTRAINT "revision_label_pkey" PRIMARY KEY ("revisionId","entityId")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_revision_id_projectId_key" ON "project_revision"("id", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_revision_projectId_number_key" ON "project_revision"("projectId", "number");

-- CreateIndex
CREATE INDEX "revision_line_revisionId_idx" ON "revision_line"("revisionId");

-- AddForeignKey
ALTER TABLE "project_revision" ADD CONSTRAINT "project_revision_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_wbs_node" ADD CONSTRAINT "revision_wbs_node_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "project_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_structure_node" ADD CONSTRAINT "revision_structure_node_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "project_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_measurement" ADD CONSTRAINT "revision_measurement_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "project_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_measurement" ADD CONSTRAINT "revision_measurement_measurementRevisionId_fkey" FOREIGN KEY ("measurementRevisionId") REFERENCES "measurement_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_line" ADD CONSTRAINT "revision_line_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "project_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_label" ADD CONSTRAINT "revision_label_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "project_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===================== Restrições da F8 (ADR-018) =====================
ALTER TABLE "project_revision" ADD CONSTRAINT project_revision_number CHECK (number >= 0);
ALTER TABLE "project_revision" ADD CONSTRAINT project_revision_code CHECK (code = 'R' || lpad(number::text, 2, '0'));

-- Revisões emitidas e suas fotografias são imutáveis e não podem ser apagadas.
CREATE OR REPLACE FUNCTION revision_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'revisões emitidas são imutáveis' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER project_revision_immutable BEFORE UPDATE OR DELETE ON "project_revision" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_immutable();
CREATE TRIGGER revision_wbs_node_immutable BEFORE UPDATE OR DELETE ON "revision_wbs_node" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_immutable();
CREATE TRIGGER revision_structure_node_immutable BEFORE UPDATE OR DELETE ON "revision_structure_node" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_immutable();
CREATE TRIGGER revision_measurement_immutable BEFORE UPDATE OR DELETE ON "revision_measurement" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_immutable();
CREATE TRIGGER revision_line_immutable BEFORE UPDATE OR DELETE ON "revision_line" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_immutable();
CREATE TRIGGER revision_label_immutable BEFORE UPDATE OR DELETE ON "revision_label" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_immutable();

-- Fotografia só pode ser gravada na mesma transação em que a revisão é criada.
CREATE OR REPLACE FUNCTION revision_snapshot_same_tx() RETURNS trigger AS $$
DECLARE x xid;
BEGIN
  SELECT xmin INTO x FROM "project_revision" WHERE id = NEW."revisionId";
  IF x IS DISTINCT FROM pg_current_xact_id()::xid THEN
    RAISE EXCEPTION 'a fotografia de uma revisão é gravada apenas na emissão' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER revision_wbs_node_same_tx BEFORE INSERT ON "revision_wbs_node" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_same_tx();
CREATE TRIGGER revision_structure_node_same_tx BEFORE INSERT ON "revision_structure_node" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_same_tx();
CREATE TRIGGER revision_measurement_same_tx BEFORE INSERT ON "revision_measurement" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_same_tx();
CREATE TRIGGER revision_line_same_tx BEFORE INSERT ON "revision_line" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_same_tx();
CREATE TRIGGER revision_label_same_tx BEFORE INSERT ON "revision_label" FOR EACH ROW EXECUTE FUNCTION revision_snapshot_same_tx();
