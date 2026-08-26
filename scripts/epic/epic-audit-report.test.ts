import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import type { AuditFinding } from './epic-audit'
import { epic_audit_report } from './epic-audit-report'

const WARNING: AuditFinding = { level: 'warning', check: 'implicit dependency', message: 'look' }
const ERROR: AuditFinding = { level: 'error', check: 'order contradiction', message: 'fix' }
const BUILD_INPUT: ReadonlyArray<AuditFinding> = [WARNING, ERROR]
const DISAGREE_MESSAGE = 'they disagree'

describe('epic_audit_report.build_result — only errors fail', () => {
	it('passes a clean audit', () => {
		expect(epic_audit_report.build_result([]).exit_code).toBe(0)
	})

	// Check 1 fires on a legitimate forward reference as readily as on a missing dependency, so a
	// gate failing on warnings would make design notes unwritable.
	it('passes an audit with warnings only', () => {
		expect(epic_audit_report.build_result([WARNING, WARNING]).exit_code).toBe(0)
	})

	it('fails an audit with any error', () => {
		expect(epic_audit_report.build_result(BUILD_INPUT).exit_code).toBe(1)
	})

	it('keeps every finding, whatever the exit code', () => {
		expect(epic_audit_report.build_result(BUILD_INPUT).findings).toHaveLength(2)
	})
})

describe('epic_audit_report.anomaly_findings', () => {
	// `epic:next` refuses to run on a cycle or a body-versus-relations disagreement, so an audit that
	// only warned would disagree with the command that acts on it.
	it('reports a graph anomaly as an error', () => {
		const findings = epic_audit_report.anomaly_findings([{ kind: 'cycle', message: 'a cycle' }])

		expect(findings[0]?.level).toBe('error')
	})

	it('carries the anomaly message through', () => {
		const findings = epic_audit_report.anomaly_findings([
			{ kind: 'declaration_mismatch', message: DISAGREE_MESSAGE },
		])

		expect(findings[0]?.message).toBe(DISAGREE_MESSAGE)
	})
})

describe('epic_audit_report.format_report', () => {
	it('says so plainly when nothing was found', () => {
		expect(epic_audit_report.format_report({ findings: [], exit_code: 0 })).toBe(
			epic_audit_report.PASS_LINE,
		)
	})

	it('puts the errors above the warnings', () => {
		const text = epic_audit_report.format_report(epic_audit_report.build_result(BUILD_INPUT))

		expect(text.indexOf('fix')).toBeLessThan(text.indexOf('look'))
	})

	it('counts what it found, and says which half decides the result', () => {
		const text = epic_audit_report.format_report(epic_audit_report.build_result(BUILD_INPUT))

		expect(text).toContain('1 error(s), 1 warning(s)')
		expect(text).toContain('Only errors fail this check')
	})

	it('marks the two levels differently', () => {
		const text = epic_audit_report.format_report(epic_audit_report.build_result(BUILD_INPUT))

		expect(text).toContain('✖')
		expect(text).toContain('⚠')
	})
})

describe('josh epic:audit registration', () => {
	it('is registered as a command', () => {
		const entry = COMMAND_MAP['epic:audit']

		expect(entry?.script).toBe('scripts/epic/epic-audit-cli.ts')
	})

	it('is reachable through the ea alias', () => {
		const { ea } = ALIASES

		expect(ea).toBe('epic:audit')
	})
})
