-- AlterTable
ALTER TABLE "measurement" ALTER COLUMN "sheetOutputKey" SET DATA TYPE VARCHAR(64);

-- AlterTable
ALTER TABLE "sheet" ADD COLUMN     "rowAnchors" JSONB NOT NULL DEFAULT '[]';

