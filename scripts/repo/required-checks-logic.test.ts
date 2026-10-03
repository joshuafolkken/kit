import { readFileSync } from 'node:fs'
import { ci_yml_fixture } from '#scripts/ci/ci-yml-fixture'
import { describe, expect, it } from 'vitest'
import { required_checks_logic } from './required-checks-logic'

const CI_WORKFLOW = '.github/workflows/ci.yml'
const SONAR_WORKFLOW = '.github/workflows/sonar-qube.yml'
const CLASSIFICATION_WORKFLOW = '.github/workflows/pr-classification.yml'
const RULESET_ID = 15_220_506
const ACTIONS_INTEGRATION_ID = 15_368
const CHECKS = 'Checks'
const E2E = 'E2E'
const SONAR_QUBE = 'SonarQube'
const RELEASE_CLASSIFICATION = 'Release classification'
const REQUIRED_STATUS_CHECKS = 'required_status_checks'
const NOT_FOUND = 404
const FORBIDDEN = 403
const SERVER_ERROR = 502

// Where each distributed workflow's text comes from in this package: consumers receive the ci.yml
// template, kit runs its own `.github` copy, and the other two are distributed byte for byte.
const SOURCES_BY_WORKFLOW: Record<string, ReadonlyArray<string>> = {
	[CI_WORKFLOW]: [ci_yml_fixture.TEMPLATE_CI_YML, ci_yml_fixture.RUNTIME_CI_YML],
	[SONAR_WORKFLOW]: [SONAR_WORKFLOW],
	[CLASSIFICATION_WORKFLOW]: [CLASSIFICATION_WORKFLOW],
}

const REQUIRED_RULE = {
	type: REQUIRED_STATUS_CHECKS,
	parameters: {
		strict_required_status_checks_policy: false,
		required_status_checks: [{ context: CHECKS, integration_id: ACTIONS_INTEGRATION_ID }],
	},
}
const RULESET = JSON.stringify({ id: RULESET_ID, rules: [{ type: 'deletion' }, REQUIRED_RULE] })

function job_names(relative_path: string): Array<string> {
	return Object.values(ci_yml_fixture.load_workflow(relative_path).jobs).flatMap((job) =>
		job.name === undefined ? [] : [job.name],
	)
}

function workflow_text(names: ReadonlyArray<string>): string {
	const jobs = names.map((name, index) => `  job_${String(index)}:\n    name: ${name}\n`)

	return `name: CI\njobs:\n${jobs.join('')}  unnamed:\n    runs-on: ubuntu-latest\n`
}

function read_distributed_workflow(workflow: string): string | undefined {
	const [source] = SOURCES_BY_WORKFLOW[workflow] ?? []

	return source === undefined ? undefined : readFileSync(source, 'utf8')
}

function read_without_ci(workflow: string): string | undefined {
	return workflow === CI_WORKFLOW ? undefined : read_distributed_workflow(workflow)
}

function branch_rules(contexts: ReadonlyArray<string>): string {
	return JSON.stringify([
		{ type: 'deletion', ruleset_id: RULESET_ID },
		{
			type: REQUIRED_STATUS_CHECKS,
			ruleset_id: RULESET_ID,
			parameters: { required_status_checks: contexts.map((context) => ({ context })) },
		},
	])
}

describe('DISTRIBUTED_CHECKS', () => {
	// A ruleset matches a required check by the job's `name:`, so a renamed job would silently leave
	// the required check waiting on a context nothing reports.
	it.each(required_checks_logic.DISTRIBUTED_CHECKS.map((entry) => [entry.workflow, entry]))(
		'names jobs that %s actually defines',
		(_workflow, entry) => {
			const sources = SOURCES_BY_WORKFLOW[entry.workflow] ?? []

			for (const source of sources) {
				expect(job_names(source)).toEqual(expect.arrayContaining([...entry.checks]))
			}
		},
	)

	it('covers every workflow the test knows a source for', () => {
		const workflows = required_checks_logic.DISTRIBUTED_CHECKS.map((entry) => entry.workflow)

		expect(workflows).toEqual(Object.keys(SOURCES_BY_WORKFLOW))
	})
})

describe('workflow_job_names', () => {
	it('reads every job name, skipping jobs without one', () => {
		expect(required_checks_logic.workflow_job_names(workflow_text([CHECKS, E2E]))).toEqual([
			CHECKS,
			E2E,
		])
	})

	it.each([['jobs: ['], ['name: CI'], ['']])('reports nothing for %j', (content) => {
		expect(required_checks_logic.workflow_job_names(content)).toEqual([])
	})
})

describe('expected_checks', () => {
	it('expects every distributed check from the distributed workflows themselves', () => {
		expect(required_checks_logic.expected_checks(read_distributed_workflow)).toEqual([
			CHECKS,
			'Detect E2E',
			E2E,
			'Security Audit',
			SONAR_QUBE,
			RELEASE_CLASSIFICATION,
		])
	})

	it('drops the checks of a workflow the repository does not have', () => {
		expect(required_checks_logic.expected_checks(read_without_ci)).toEqual([
			SONAR_QUBE,
			RELEASE_CLASSIFICATION,
		])
	})

	// A same-named file is not kit's: a project's own ci.yml must not be told to require `Checks`.
	it('expects only the checks a same-named workflow actually reports', () => {
		const read_own_ci = (workflow: string): string | undefined =>
			workflow === CI_WORKFLOW ? workflow_text(['build', CHECKS]) : undefined

		expect(required_checks_logic.expected_checks(read_own_ci)).toEqual([CHECKS])
	})
})

describe('parse_branch_rules', () => {
	it('reads the required contexts and the ruleset they belong to', () => {
		expect(required_checks_logic.parse_branch_rules(branch_rules([CHECKS, E2E]))).toEqual({
			kind: 'ruleset',
			ruleset_id: RULESET_ID,
			contexts: [CHECKS, E2E],
		})
	})

	it('reads a branch with rules but no required checks as none', () => {
		const rules = JSON.stringify([{ type: 'deletion', ruleset_id: RULESET_ID }])

		expect(required_checks_logic.parse_branch_rules(rules)).toEqual({ kind: 'none' })
	})

	it.each([[undefined], ['not json'], ['{"message":"Not Found"}']])(
		'reads %s as unreadable rather than as missing',
		(stdout) => {
			expect(required_checks_logic.parse_branch_rules(stdout)).toEqual({ kind: 'unreadable' })
		},
	)
})

describe('parse_protection', () => {
	it('reads the classic protection contexts', () => {
		const read = { kind: 'body', stdout: '{"contexts":["Checks"]}' } as const

		expect(required_checks_logic.parse_protection(read)).toEqual({
			kind: 'protection',
			contexts: [CHECKS],
		})
	})

	it('reads a 404 (an unprotected branch) as none', () => {
		const read = { kind: 'failed', status: NOT_FOUND } as const

		expect(required_checks_logic.parse_protection(read)).toEqual({ kind: 'none' })
	})

	// A 403 for a caller without admin access, a 5xx or a timeout must never pass for "no checks".
	it.each([[FORBIDDEN], [SERVER_ERROR], [undefined]])(
		'reads a failure with status %s as unreadable',
		(status) => {
			const read = { kind: 'failed', status } as const

			expect(required_checks_logic.parse_protection(read)).toEqual({ kind: 'unreadable' })
		},
	)

	it('reads a body that is not the protection document as unreadable', () => {
		const read = { kind: 'body', stdout: 'not json' } as const

		expect(required_checks_logic.parse_protection(read)).toEqual({ kind: 'unreadable' })
	})
})

describe('combine_sources', () => {
	const ruleset = { kind: 'ruleset', ruleset_id: RULESET_ID, contexts: [CHECKS] } as const

	it('adds the contexts classic protection requires to the ruleset, once each', () => {
		const protection = { kind: 'protection', contexts: [CHECKS, SONAR_QUBE] } as const

		expect(required_checks_logic.combine_sources(ruleset, protection)).toEqual({
			...ruleset,
			contexts: [CHECKS, SONAR_QUBE],
		})
	})

	it('keeps the ruleset alone on a branch without protection', () => {
		expect(required_checks_logic.combine_sources(ruleset, { kind: 'none' })).toEqual(ruleset)
	})

	it('reads an unreadable protection beside a ruleset as unreadable', () => {
		const combined = required_checks_logic.combine_sources(ruleset, { kind: 'unreadable' })

		expect(combined).toEqual({ kind: 'unreadable' })
	})

	it('answers with protection when no ruleset requires a check', () => {
		const protection = { kind: 'protection', contexts: [E2E] } as const

		expect(required_checks_logic.combine_sources({ kind: 'none' }, protection)).toEqual(protection)
	})
})

describe('missing_checks', () => {
	it('lists the expected checks the repository does not require, in expected order', () => {
		const expected = [CHECKS, E2E, SONAR_QUBE, RELEASE_CLASSIFICATION]
		const required = [CHECKS, 'SonarCloud Code Analysis', RELEASE_CLASSIFICATION]

		expect(required_checks_logic.missing_checks(expected, required)).toEqual([E2E, SONAR_QUBE])
	})
})

describe('ruleset_update_body', () => {
	it('appends the missing checks and keeps every other rule as read', () => {
		const body = required_checks_logic.ruleset_update_body(RULESET, [E2E])
		const added = [...REQUIRED_RULE.parameters.required_status_checks, { context: E2E }]

		expect(JSON.parse(body ?? '')).toEqual({
			rules: [
				{ type: 'deletion' },
				{
					...REQUIRED_RULE,
					parameters: { ...REQUIRED_RULE.parameters, required_status_checks: added },
				},
			],
		})
	})

	it('refuses a response that is not a ruleset', () => {
		expect(required_checks_logic.ruleset_update_body('{}', [E2E])).toBeUndefined()
	})
})

describe('protection_update_body', () => {
	it('carries only the contexts to append', () => {
		expect(JSON.parse(required_checks_logic.protection_update_body([E2E]))).toEqual({
			contexts: [E2E],
		})
	})
})
