// Utility helpers for sorting, trimming, and paginating History Log records.
import type { AuditEntry, StockChange } from "../types";

export const HISTORY_LOG_MAX_RECORDS = 1000;
export const HISTORY_LOG_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export const DEFAULT_HISTORY_LOG_PAGE_SIZE = 20;

export function trimAuditLogEntries(entries: AuditEntry[]) {
  return entries
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, HISTORY_LOG_MAX_RECORDS);
}

export function trimStockChangeEntries(entries: StockChange[]) {
  return entries
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, HISTORY_LOG_MAX_RECORDS);
}
