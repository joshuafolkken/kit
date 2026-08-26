import type { AuditFinding } from './epic-audit'
import type { GraphAnomaly } from './epic-graph'

// Turning the findings into a report and an exit code.
//
// Only errors decide the exit code. A warning is something a reader has to look at, not something a
// gate may fail on: check 1 fires on a legitimate forward reference as readily as on a real missing
// dependency, and a gate that failed on both would make design notes unwritable
// (joshuafolkken/kit#870).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const PASS_LINE = '✓ No cross-child contradictions found.'

interface AuditResult {
	findings: ReadonlyArray<AuditFinding>
	exit_code: number
}

// The graph's own problems, as findings. A cycle or a body-versus-relations disagreement is an error
// — `epic:next` already refuses to run on either, so an audit that only warned would disagree with
// the command that acts on it.
function anomaly_findings(anomalies: ReadonlyArray<GraphAnomaly>): Array<AuditFinding> {
	return anomalies.map((anomaly) => ({
		level: 'error' as const,
		check: anomaly.kind.replaceAll('_', ' '),
		message: anomaly.message,
	}))
}

function has_error(findings: ReadonlyArray<AuditFinding>): boolean {
	return findings.some((finding) => finding.level === 'error')
}

function build_result(findings: ReadonlyArray<AuditFinding>): AuditResult {
	return { findings, exit_code: has_error(findings) ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE }
}

function format_finding(finding: AuditFinding): string {
	return `${finding.level === 'error' ? '✖' : '⚠'} ${finding.check}: ${finding.message}`
}

// Errors first, so the things that must be fixed are not buried under the things to look at.
function sort_findings(findings: ReadonlyArray<AuditFinding>): Array<AuditFinding> {
	return findings.toSorted((left, right) => {
		if (left.level === right.level) return 0

		return left.level === 'error' ? -1 : 1
	})
}

function format_report(result: AuditResult): string {
	if (result.findings.length === 0) return PASS_LINE
	const lines = sort_findings(result.findings).map((finding) => format_finding(finding))
	const errors = result.findings.filter((finding) => finding.level === 'error').length
	const warnings = result.findings.length - errors

	return [
		...lines,
		'',
		`${String(errors)} error(s), ${String(warnings)} warning(s). Only errors fail this check.`,
	].join('\n')
}

const epic_audit_report = {
	PASS_LINE,
	anomaly_findings,
	has_error,
	build_result,
	sort_findings,
	format_report,
}

export type { AuditResult }
export { epic_audit_report }
