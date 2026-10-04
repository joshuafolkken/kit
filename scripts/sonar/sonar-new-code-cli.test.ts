import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { http_fault_injection } from '#scripts/test/http-fault-injection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLEAN, FINDINGS, UNREADABLE } from './sonar-new-code'
import { sonar_new_code_cli } from './sonar-new-code-cli'
import { sonar_project } from './sonar-project'

// joshuafolkken/kit#3045: `josh sonar:new-code` is what turns the `SonarQube` check red on a single new
// issue or duplicated block. SonarCloud is replaced by a `fetch` stand-in, so no request leaves the
// machine; a failed read of either API must fail the check rather than pass it as clean.

const COMMAND = 'sonar:new-code'
const SCRIPT_PATH = 'scripts/sonar/sonar-new-code-cli.ts'
const PROJECT_KEY = 'demo_key'
const PULL_REQUEST = '42'
const MEASURES_PATH = '/api/measures/component'
const OK_STATUS = 200
const TOKEN = 'sqp_example'

const CODE_SMELL = {
	key: 'AaEC',
	rule: 'typescript:S1854',
	severity: 'MINOR',
	type: 'CODE_SMELL',
	component: `${PROJECT_KEY}:src/a.ts`,
	line: 3,
	message: 'Remove this useless assignment.',
}

function issues_body(issues: ReadonlyArray<object>): object {
	return { total: issues.length, issues }
}

function measures_body(blocks: string): object {
	const measure = { metric: 'new_duplicated_blocks', periods: [{ index: 1, value: blocks }] }

	return { component: { key: PROJECT_KEY, measures: [measure] } }
}

function sonar_stub(issues: object, measures: object): (input: unknown) => Promise<Response> {
	return async (input) => {
		const body = String(input).includes(MEASURES_PATH) ? measures : issues

		return Response.json(body, { status: OK_STATUS })
	}
}

async function report_for(issues: object, measures: object): Promise<ReadonlyArray<string>> {
	vi.stubGlobal('fetch', sonar_stub(issues, measures))
	const fetched = await sonar_new_code_cli.fetch_new_code(PROJECT_KEY, PULL_REQUEST)

	return sonar_new_code_cli.report(fetched).lines
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.unstubAllEnvs()
})

describe('sonar_new_code_cli urls', () => {
	it('asks for the unresolved issues on the pull request', () => {
		const url = new URL(sonar_new_code_cli.issues_url(PROJECT_KEY, PULL_REQUEST))

		expect(url.searchParams.get('componentKeys')).toBe(PROJECT_KEY)
		expect(url.searchParams.get('pullRequest')).toBe(PULL_REQUEST)
		expect(url.searchParams.get('resolved')).toBe('false')
	})

	it('asks for the new duplicated blocks on the pull request', () => {
		const url = new URL(sonar_new_code_cli.measures_url(PROJECT_KEY, PULL_REQUEST))

		expect(url.pathname).toBe(MEASURES_PATH)
		expect(url.searchParams.get('metricKeys')).toBe('new_duplicated_blocks')
		expect(url.searchParams.get('pullRequest')).toBe(PULL_REQUEST)
	})
})

describe('sonar_new_code_cli.report', () => {
	it('passes a pull request with no new issue and no new duplicated block', async () => {
		const fetched = await (async () => {
			vi.stubGlobal('fetch', sonar_stub(issues_body([]), measures_body('0')))

			return await sonar_new_code_cli.fetch_new_code(PROJECT_KEY, PULL_REQUEST)
		})()

		expect(sonar_new_code_cli.report(fetched)).toStrictEqual({ lines: [CLEAN], is_clean: true })
	})

	it('fails on one new code smell and prints it', async () => {
		const lines = await report_for(issues_body([CODE_SMELL]), measures_body('0'))

		expect(lines[0]).toContain(CODE_SMELL.rule)
		expect(lines[0]).toContain(`${CODE_SMELL.component}:3`)
		expect(lines.at(-1)).toMatch(new RegExp(`^${FINDINGS}: 1 new issue`, 'u'))
	})

	it('fails on one new duplicated block', async () => {
		const lines = await report_for(issues_body([]), measures_body('1'))

		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain('1 new duplicated block')
	})

	it('fails when the duplicated-blocks measure is not a number', async () => {
		const lines = await report_for(issues_body([]), measures_body('n/a'))

		expect(lines[0]).toMatch(new RegExp(`^${UNREADABLE}: `, 'u'))
	})
})

describe('sonar_new_code_cli.fetch_new_code — injected boundary failures', () => {
	it.each(http_fault_injection.NETWORK_MODES.map((mode) => [mode]))(
		'reports %s as unreadable rather than clean',
		async (mode) => {
			vi.stubGlobal('fetch', http_fault_injection.faulty_fetch(mode))

			const fetched = await sonar_new_code_cli.fetch_new_code(PROJECT_KEY, PULL_REQUEST)

			expect(sonar_new_code_cli.report(fetched).is_clean).toBe(false)
			expect('error' in fetched).toBe(true)
		},
	)
})

describe('sonar_project.request_init', () => {
	it('sends SONAR_TOKEN as a bearer token when it is set', () => {
		vi.stubEnv('SONAR_TOKEN', TOKEN)

		expect(new Headers(sonar_project.request_init().headers).get('Authorization')).toBe(
			`Bearer ${TOKEN}`,
		)
	})

	it('sends no authorization when SONAR_TOKEN is empty', () => {
		vi.stubEnv('SONAR_TOKEN', '')

		expect(sonar_project.request_init().headers).toBeUndefined()
	})
})

describe('sonar:new-code registration', () => {
	it('is on the command map', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
	})

	it('refuses a missing pull-request positional with the usage line', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(vi.fn())

		expect(await sonar_new_code_cli.run([])).toBe(1)
		expect(error).toHaveBeenCalledWith(sonar_new_code_cli.USAGE)
	})
})
