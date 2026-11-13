// Selo de achado que pede confirmação (RF-RA012): da IA ou de heurística, o `AiReviewBadge` com a
// confiança; do axe (`incomplete`), "O axe não conseguiu decidir: confirme manualmente".
import type { Finding } from "../api/types";
import { t } from "../i18n";
import { AiReviewBadge } from "./AiReviewBadge";
import { SeverityBadge } from "./SeverityBadge";

export function ReviewBadge({ finding }: { finding: Pick<Finding, "needs_review" | "source" | "confidence"> }) {
  if (!finding.needs_review) return null;
  if (finding.source === "axe") return <SeverityBadge level="revisao" label={t.report.axeUndecided} />;
  return <AiReviewBadge confidence={finding.confidence} />;
}
