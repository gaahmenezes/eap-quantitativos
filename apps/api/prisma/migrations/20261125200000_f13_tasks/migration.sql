-- CreateEnum
CREATE TYPE "WorkTaskStatus" AS ENUM ('TODO', 'DOING', 'REVIEW', 'DONE');

-- CreateEnum
CREATE TYPE "WorkTaskKind" AS ENUM ('SHEET', 'SCHEDULE', 'WBS_ITEM', 'WORKBOOK_IMPORT', 'OTHER');

-- CreateTable
CREATE TABLE "work_task" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "kind" "WorkTaskKind" NOT NULL,
    "status" "WorkTaskStatus" NOT NULL DEFAULT 'TODO',
    "sheetId" UUID,
    "scheduleId" UUID,
    "wbsNodeId" UUID,
    "workbookImportId" UUID,
    "assigneeId" UUID,
    "reviewerId" UUID,
    "dueDate" DATE,
    "completedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "work_task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_task_projectId_status_idx" ON "work_task"("projectId", "status");

-- CreateIndex
CREATE INDEX "work_task_assigneeId_status_idx" ON "work_task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "work_task_reviewerId_status_idx" ON "work_task"("reviewerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workbook_import_id_projectId_key" ON "workbook_import"("id", "projectId");

-- AddForeignKey
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_sheetId_projectId_fkey" FOREIGN KEY ("sheetId", "projectId") REFERENCES "sheet"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_scheduleId_projectId_fkey" FOREIGN KEY ("scheduleId", "projectId") REFERENCES "schedule"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_wbsNodeId_projectId_fkey" FOREIGN KEY ("wbsNodeId", "projectId") REFERENCES "wbs_node"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_workbookImportId_projectId_fkey" FOREIGN KEY ("workbookImportId", "projectId") REFERENCES "workbook_import"("id", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task" ADD CONSTRAINT "work_task_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Vínculo coerente com o tipo da tarefa (no máximo um).
ALTER TABLE "work_task" ADD CONSTRAINT work_task_link CHECK (
  (("sheetId" IS NOT NULL)::int + ("scheduleId" IS NOT NULL)::int + ("wbsNodeId" IS NOT NULL)::int + ("workbookImportId" IS NOT NULL)::int) = CASE WHEN kind = 'OTHER' THEN 0 ELSE 1 END
  AND (kind <> 'SHEET' OR "sheetId" IS NOT NULL)
  AND (kind <> 'SCHEDULE' OR "scheduleId" IS NOT NULL)
  AND (kind <> 'WBS_ITEM' OR "wbsNodeId" IS NOT NULL)
  AND (kind <> 'WORKBOOK_IMPORT' OR "workbookImportId" IS NOT NULL)
);
ALTER TABLE "work_task" ADD CONSTRAINT work_task_done CHECK ((status = 'DONE') = ("completedAt" IS NOT NULL));
-- Tarefas não são apagadas (arquivamento).
CREATE OR REPLACE FUNCTION work_task_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tarefas não são apagadas; use arquivamento' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER work_task_keep BEFORE DELETE ON "work_task" FOR EACH ROW EXECUTE FUNCTION work_task_no_delete();
