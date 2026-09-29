import { type AuditLog, auditActionLabel, auditEntityLabel, auditRoleLabel } from "@/lib/audit-logs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDateForFilename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const CSV_HEADER = ["Horodatage", "Utilisateur", "Rôle", "Action", "Cible", "ID cible", "Détails"];

export function exportAuditLogsToCsv(items: AuditLog[], baseName = "logs"): void {
  if (items.length === 0) return;

  const lines = [
    CSV_HEADER.map(csvEscape).join(";"),
    ...items.map((log) =>
      [
        new Date(log.createdAt).toLocaleString("fr-FR"),
        log.actor,
        auditRoleLabel(log.actorRole),
        auditActionLabel(log.action),
        auditEntityLabel(log.entityType),
        log.entityId ?? "",
        log.details ?? "",
      ]
        .map(csvEscape)
        .join(";"),
    ),
  ];

  const csv = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}_${formatDateForFilename()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportAuditLogsToPdf(
  items: AuditLog[],
  options?: { title?: string; fileBaseName?: string },
): void {
  if (items.length === 0) return;

  const title = options?.title ?? "Logs";
  const fileBase = options?.fileBaseName ?? "logs";

  const head = [["Horodatage", "Utilisateur", "Rôle", "Action", "Cible", "ID", "Détails"]];
  const body = items.map((log) => [
    new Date(log.createdAt).toLocaleString("fr-FR"),
    log.actor,
    auditRoleLabel(log.actorRole),
    auditActionLabel(log.action),
    auditEntityLabel(log.entityType),
    log.entityId ?? "",
    log.details ?? "",
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 14, 12);
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(`Généré le ${new Date().toLocaleString("fr-FR")} — ${items.length} log(s)`, 14, 18);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 22,
    head,
    body,
    styles: { fontSize: 6, cellPadding: 1, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: [5, 102, 218], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 30 }, // Horodatage
      1: { cellWidth: 32 }, // Utilisateur
      2: { cellWidth: 22 }, // Rôle
      3: { cellWidth: 26 }, // Action
      4: { cellWidth: 30 }, // Cible
      5: { cellWidth: 22 }, // ID
      6: { cellWidth: "auto" }, // Détails
    },
    margin: { left: 10, right: 10 },
  });

  doc.save(`${fileBase}_${formatDateForFilename()}.pdf`);
}

