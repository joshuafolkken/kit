import { repo_setting } from './repo-setting'
import type { RequiredSource } from './required-checks-logic'

// What one read of a repository's required status checks found, against what kit's distributed
// workflows report.
interface RequiredChecksReport {
	repo: string | undefined
	branch: string | undefined
	source: RequiredSource
	expected: ReadonlyArray<string>
	missing: ReadonlyArray<string>
}

const LABEL = 'Required status checks'
const APPLY_COMMAND = 'pnpm josh ruleset:check --apply'

function source_label(source: RequiredSource): string {
	return source.kind === 'ruleset' ? `ruleset ${String(source.ruleset_id)}` : 'branch protection'
}

// An unreadable answer is never reported as a missing one — the same rule every repository-setting
// report follows — so it names the possible causes and no remediation.
function format_unreadable(report: RequiredChecksReport): Array<string> {
	return [
		`  ⚠ ${LABEL}: could not be read (${repo_setting.report_target(report.repo)}) — not checked, not necessarily missing`,
		'    `gh` is missing or unauthenticated, or the request failed (offline, timed out).',
	]
}

// No ruleset or protection requires anything. `--apply` adds to an existing rule and never creates
// one — which branches a ruleset targets and who may bypass it are the maintainer's choices.
function format_none(report: RequiredChecksReport, target: string): Array<string> {
	return [
		`  ⚠ ${LABEL}: none required on ${String(report.branch)} (${target})`,
		`    Expected: ${report.expected.join(', ')}`,
		'    Create a branch ruleset (Settings → Rules → Rulesets) that requires them.',
	]
}

function format_found(report: RequiredChecksReport, target: string): Array<string> {
	const where = `${String(report.branch)} (${target}, ${source_label(report.source)})`

	if (report.missing.length === 0) {
		return [`  ✔ ${LABEL}: all ${String(report.expected.length)} kit checks required on ${where}`]
	}

	return [
		`  ⚠ ${LABEL}: ${report.missing.join(', ')} not required on ${where}`,
		`    Add: ${APPLY_COMMAND}`,
	]
}

function format_report(report: RequiredChecksReport): Array<string> {
	const target = repo_setting.report_target(report.repo)
	if (report.source.kind === 'unreadable') return format_unreadable(report)
	if (report.source.kind === 'none') return format_none(report, target)

	return format_found(report, target)
}

// Whether nothing is left to do: the checks were read and every expected one is required.
function is_complete(report: RequiredChecksReport): boolean {
	const is_read = report.source.kind === 'ruleset' || report.source.kind === 'protection'

	return is_read && report.missing.length === 0
}

const required_checks_report = { format_report, is_complete }

export type { RequiredChecksReport }
export { required_checks_report }
