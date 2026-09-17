import { EPIC_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it } from 'vitest'
import type { AuditFinding } from './epic-audit'
import { epic_audit_checks, type AuditChild } from './epic-audit-checks'
import { epic_audit_cli, type AuditInput } from './epic-audit-cli'

// joshuafolkken/kit#1476. The two properties these cases keep apart are a row pointing at an *epic*
// and a row pointing at a child in *another repository*. The second is legitimate — it disables the
// epic auto-close by design — so a check that reported it would refuse the very shape `CLAUDE.md`
// asks for. Every case below therefore varies one property at a time.

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const EPIC = 858
const NESTED_EPIC_MESSAGE = '#1 is itself an epic'
const AUTO_CLOSE = 'auto-close'

function child(number: number, labels: ReadonlyArray<string> = [], repo = REPO): AuditChild {
	return { number, repo, state: 'OPEN', labels, blocked_by: [], body: undefined }
}

function closed(target: AuditChild): AuditChild {
	return { ...target, state: 'CLOSED' }
}

function messages(findings: ReadonlyArray<AuditFinding>): string {
	return findings.map((finding) => finding.message).join('\n')
}

function audit_input(children: ReadonlyArray<AuditChild>): AuditInput {
	return {
		epic_number: EPIC,
		repo: REPO,
		children,
		tracked: [],
		reference_states: new Map(),
		claiming: { kind: 'read', numbers: [], cutoff: 'none' },
		anomalies: [],
		contradictions: [],
		order_pairs: [],
		decisions: '',
		order_comments: new Map(),
	}
}

describe('epic_audit_checks.find_nested_epics', () => {
	it('reports a child that carries the epic label', () => {
		const findings = epic_audit_checks.find_nested_epics([child(1, [EPIC_LABEL])], REPO)

		expect(findings).toHaveLength(1)
		expect(findings[0]?.check).toBe(epic_audit_checks.NESTED_EPIC)
		expect(messages(findings)).toContain(NESTED_EPIC_MESSAGE)
	})

	it('says the epic will not auto-close from a grandchild merging', () => {
		const findings = epic_audit_checks.find_nested_epics([child(1, [EPIC_LABEL])], REPO)

		expect(messages(findings)).toContain(AUTO_CLOSE)
		expect(messages(findings)).toContain('grandchild')
	})

	// The deliberate divergence from `epic-classify.ts`, which skips a closed one: the auto-close
	// consequence is about the parent and outlives the child epic finishing — it is the moment it
	// bites — so a reader looking at an epic that will not close must still find the row.
	it('reports a closed one too, which is when that consequence bites', () => {
		const findings = epic_audit_checks.find_nested_epics([closed(child(1, [EPIC_LABEL]))], REPO)

		expect(findings).toHaveLength(1)
		expect(messages(findings)).toContain(AUTO_CLOSE)
	})

	it('leaves an ordinary child alone', () => {
		expect(epic_audit_checks.find_nested_epics([child(1)], REPO)).toEqual([])
	})

	it('leaves a child in another repository alone when it is not an epic', () => {
		expect(epic_audit_checks.find_nested_epics([child(1, [], OTHER_REPO)], REPO)).toEqual([])
	})

	it('reports one in another repository that is an epic, naming its repository', () => {
		const findings = epic_audit_checks.find_nested_epics([child(1, [EPIC_LABEL], OTHER_REPO)], REPO)

		expect(findings).toHaveLength(1)
		expect(messages(findings)).toContain(`${OTHER_REPO}#1`)
	})
})

describe('epic_audit_cli.audit — a row pointing at another epic', () => {
	it('is a warning, so it does not fail the audit an epicrun runs first', () => {
		const result = epic_audit_cli.audit(audit_input([child(1, [EPIC_LABEL])]))

		expect(result.exit_code).toBe(0)
		expect(messages(result.findings)).toContain(NESTED_EPIC_MESSAGE)
	})

	it('is reported through the composition, and only for the child that is an epic', () => {
		const result = epic_audit_cli.audit(audit_input([child(1), child(2, [EPIC_LABEL])]))

		expect(messages(result.findings)).toContain('#2 is itself an epic')
		expect(messages(result.findings)).not.toContain(NESTED_EPIC_MESSAGE)
	})
})
