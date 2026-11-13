// Título de um problema: o resumo da regra no axe (`help`) ou, sem ele, "Regra <id>".
import type { Finding } from "../api/types";
import { t } from "../i18n";
import { AxeText } from "./AxeText";

export function findingTitleText(finding: Pick<Finding, "help" | "rule_id">): string {
  return finding.help ?? t.report.finding.ruleTitle(finding.rule_id);
}

export function FindingTitle({ finding }: { finding: Pick<Finding, "help" | "rule_id"> }) {
  return finding.help ? <AxeText>{finding.help}</AxeText> : <>{t.report.finding.ruleTitle(finding.rule_id)}</>;
}
