import type { AuditEntryDto } from './projects.js';
import type { TaskStatus } from './tasks.js';

/** Centro operacional do empreendimento (F13, ADR-023): o que falta fazer, sem nada financeiro. */
export interface PendingItemDto {
  kind: 'SHEET' | 'SCHEDULE' | 'WORKBOOK_IMPORT';
  id: string;
  title: string;
  status: 'DRAFT' | 'LAUNCHED' | 'PENDING';
  /** Motivos em linguagem de obra: "sem item da EAP", "3 linhas com erro", "alterada após o lançamento"… */
  reasons: string[];
  updatedAt: string;
}
export interface CoverageGroupDto { wbsNodeId: string; code: string; title: string; items: number; measured: number }
export interface OperationsDto {
  pending: PendingItemDto[];
  counts: {
    sheets: { total: number; draft: number; pending: number; launched: number };
    schedules: { total: number; draft: number; pending: number; launched: number };
    workbookImports: number;
    /** Vínculos serviço × item da EAP sem medição ativa. */
    unmeasuredLinks: number;
    outdatedFormulas: number;
  };
  coverage: { items: number; measured: number; groups: CoverageGroupDto[] };
  revision: {
    last: { id: string; code: string; title: string; issuedAt: string } | null;
    /** Desde a última revisão emitida: medições novas, revisadas e arquivadas. */
    since: { created: number; revised: number; archived: number };
  };
  tasks: { byStatus: Record<TaskStatus, number>; overdue: number; unassigned: number };
  activity: AuditEntryDto[];
}
