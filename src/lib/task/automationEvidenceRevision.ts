import { evidenceRuleVersion, recognizeEvidence } from './automationEngine';
import type { AutomationGrant, TaskEvidence } from './automationTypes';
/** A missing retained source is different from a currently visible correction of
 * the exact evidence we applied. Only the latter invalidates a prior affirmation. */
export function hasAmbiguousEvidenceRevision(grant: AutomationGrant, sources: TaskEvidence[]): boolean {
  const scope = evidenceRuleVersion(grant.rule);
  return sources.some(source => {
    const applied = grant.records.filter(record => !record.undone && (!record.ruleVersion || record.ruleVersion === scope)
      && record.source === source.source && record.sourceId === source.id).at(-1);
    return !!applied && applied.sourceVersion !== source.version && !recognizeEvidence(grant.rule, grant.uid, source);
  });
}
