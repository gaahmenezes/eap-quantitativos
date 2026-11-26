-- Atualização de fichas e quadros por nova versão da planilha (ADR-025): aba de origem, para sugerir a atualização
-- quando a mesma aba volta numa nova versão do arquivo.
ALTER TABLE "sheet" ADD COLUMN "sourceSheetName" VARCHAR(100);
ALTER TABLE "schedule" ADD COLUMN "sourceSheetName" VARCHAR(100);
CREATE INDEX "sheet_projectId_sourceSheetName_idx" ON "sheet"("projectId", "sourceSheetName");
CREATE INDEX "schedule_projectId_sourceSheetName_idx" ON "schedule"("projectId", "sourceSheetName");
