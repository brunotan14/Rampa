// Card de problema resumido (design/components/IssueCard, variante "Resumido"): uma regra com os
// elementos afetados. O título é um h3 (a tecla H do leitor de tela lista os problemas como um
// índice); o card não é clicável por inteiro: cada elemento é um link para o detalhe.
import type { Finding } from "../api/types";
import { t } from "../i18n";
import { confidenceBand, findingPath } from "../report";
import { fromApiSeverity } from "../severity";
import { FindingTitle } from "./FindingTitle";
import { Link } from "./Link";
import { ReviewBadge } from "./ReviewBadge";
import { SeverityBadge } from "./SeverityBadge";
import { useId } from "react";

export interface FindingGroupData {
  key: string;
  first: Finding;
  findings: Finding[];
}

/**
 * Junta os achados da mesma regra, severidade, origem e revisão, na ordem em que chegam (a API
 * manda por severidade, com os da mesma regra juntos). Achado de uma página seguinte da lista
 * entra no grupo que já existe.
 */
export function groupFindings(findings: readonly Finding[]): FindingGroupData[] {
  const groups = new Map<string, FindingGroupData>();
  for (const finding of findings) {
    const key = [finding.severity, finding.rule_id, finding.source, finding.needs_review].join("|");
    const group = groups.get(key);
    if (group) group.findings.push(finding);
    else groups.set(key, { key, first: finding, findings: [finding] });
  }
  return [...groups.values()];
}

/** Id do link de um achado na lista, para levar o foco ao primeiro de um lote novo. */
export const findingLinkId = (findingId: string) => `achado-${findingId}`;

export function FindingGroup({ auditId, group }: { auditId: string; group: FindingGroupData }) {
  const titleId = useId();
  const { first, findings } = group;
  return (
    <article className="rp-card" aria-labelledby={titleId}>
      <div className="rp-card__head">
        <div className="rp-card__meta">
          <SeverityBadge level={fromApiSeverity(first.severity)} />
          <ReviewBadge finding={{ ...first, confidence: null }} />
        </div>
        <h3 id={titleId} className="rp-card__title">
          <FindingTitle finding={first} />
        </h3>
      </div>
      <dl className="rp-card__dl">
        <dt>{t.report.group.rule}</dt>
        <dd>
          <code>{first.rule_id}</code>
        </dd>
        <dt>{t.report.group.criteria}</dt>
        <dd>
          {first.wcag_criteria.length > 0
            ? first.wcag_criteria.map(t.report.criterion).join(", ")
            : t.report.noCriteria}
        </dd>
        <dt>{t.report.group.source}</dt>
        <dd>{t.report.sources[first.source]}</dd>
      </dl>
      {/* Não é `section`: os cards repetem o mesmo nome e virariam marcos iguais. */}
      <div className="rp-card__section">
        <h4>{t.report.group.elements(findings.length)}</h4>
        <ol className="rp-elements">
          {findings.map((finding) => (
            <li key={finding.id}>
              <Link href={findingPath(auditId, finding.id)} className="rp-elements__link" id={findingLinkId(finding.id)}>
                <span className="rp-sr">{t.report.group.elementPrefix}</span>{" "}
                {finding.selector ? <code>{finding.selector}</code> : t.report.group.noSelector}
              </Link>
              {finding.needs_review && finding.source !== "axe" && finding.confidence !== null && (
                <span className="rp-caption">
                  {" "}
                  {t.report.ai.confidenceValue(
                    t.report.ai.confidence[confidenceBand(finding.confidence)],
                    Math.round(finding.confidence * 100),
                  )}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}
