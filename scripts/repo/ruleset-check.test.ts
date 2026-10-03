import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GhApiRequest } from '#scripts/git/git-gh-exec'
import { gh_failure } from '#scripts/git/git-gh-failure'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequiredChecksReport } from './required-checks-report'
import { ruleset_check } from './ruleset-check'

const mocks = vi.hoisted(() => ({
	read: vi.fn<(request: GhApiRequest) => string | undefined>(),
	exec: vi.fn<(request: GhApiRequest) => string>(),
}))

vi.mock('#scripts/git/git-gh-exec', () => ({
	git_gh_exec: { read_gh_api_sync: mocks.read, exec_gh_api_sync: mocks.exec },
}))

const REPO = 'joshuafolkken/game-kit'
const BRANCH = 'main'
const RULESET_ID = 7
const SONAR_QUBE = 'SonarQube'
const CHECKS = 'Checks'
const REQUIRED_STATUS_CHECKS = 'required_status_checks'
const RULES_PATH = `repos/${REPO}/rules/branches/${BRANCH}`
const PROTECTION_PATH = `repos/${REPO}/branches/${BRANCH}/protection/required_status_checks`
const RULESET_PATH = `repos/${REPO}/rulesets/${String(RULESET_ID)}`
const NOT_FOUND = 404
const FORBIDDEN = 403

function write_workflow(root: string, content: string): void {
	mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
	writeFileSync(path.join(root, '.github', 'workflows', 'sonar-qube.yml'), content)
}

// A checkout holding only the SonarQube workflow, so exactly one check is expected.
const scratch = mkdtempSync(path.join(tmpdir(), 'ruleset-check-test-'))

write_workflow(scratch, `jobs:\n  sonar:\n    name: ${SONAR_QUBE}\n`)

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function branch_rules(contexts: ReadonlyArray<string>): string {
	return JSON.stringify([
		{
			type: REQUIRED_STATUS_CHECKS,
			ruleset_id: RULESET_ID,
			parameters: { required_status_checks: contexts.map((context) => ({ context })) },
		},
	])
}

function stub_reads(responses: Record<string, string | undefined>): void {
	mocks.read.mockImplementation((request: { path: string; jq_filter?: string }) =>
		request.jq_filter === undefined ? responses[request.path] : BRANCH,
	)
}

function fail_protection_read(status: number): void {
	mocks.exec.mockImplementationOnce(() => {
		throw gh_failure.attach(new Error('gh api failed'), { status })
	})
}

function report_for(source: RequiredChecksReport['source']): RequiredChecksReport {
	return { repo: REPO, branch: BRANCH, source, expected: [SONAR_QUBE], missing: [SONAR_QUBE] }
}

beforeEach(() => {
	vi.resetAllMocks()
})

describe('ruleset_check.inspect beside a ruleset', () => {
	it('reads the ruleset with no protection on the branch and reports what neither requires', () => {
		stub_reads({ [RULES_PATH]: branch_rules([CHECKS]) })
		fail_protection_read(NOT_FOUND)

		expect(ruleset_check.inspect(REPO, scratch)).toMatchObject({
			source: { kind: 'ruleset', ruleset_id: RULESET_ID },
			expected: [SONAR_QUBE],
			missing: [SONAR_QUBE],
		})
	})

	// GitHub enforces both, so a check classic protection requires is not missing beside a ruleset.
	it('counts a check classic protection requires beside a ruleset as required', () => {
		stub_reads({ [RULES_PATH]: branch_rules([CHECKS]) })
		mocks.exec.mockReturnValueOnce(`{"contexts":["${SONAR_QUBE}"]}`)

		expect(ruleset_check.inspect(REPO, scratch)).toMatchObject({
			source: { kind: 'ruleset', ruleset_id: RULESET_ID, contexts: [CHECKS, SONAR_QUBE] },
			missing: [],
		})
		expect(mocks.exec).toHaveBeenCalledWith(expect.objectContaining({ path: PROTECTION_PATH }))
	})
})

describe('ruleset_check.inspect', () => {
	it('falls back to classic protection when no ruleset requires a check', () => {
		stub_reads({ [RULES_PATH]: '[]' })
		mocks.exec.mockReturnValueOnce(`{"contexts":["${SONAR_QUBE}"]}`)

		expect(ruleset_check.inspect(REPO, scratch)).toMatchObject({
			source: { kind: 'protection' },
			missing: [],
		})
		expect(mocks.exec).toHaveBeenCalledWith(expect.objectContaining({ path: PROTECTION_PATH }))
	})

	// A failed read must stay `unreadable`: falling through to protection would turn it into `none`.
	it('reports unreadable rules as unreadable, with nothing missing and no protection read', () => {
		stub_reads({})

		expect(ruleset_check.inspect(REPO, scratch)).toMatchObject({
			source: { kind: 'unreadable' },
			missing: [],
		})
		expect(mocks.exec).not.toHaveBeenCalled()
	})

	it('reads nothing when the repository is unknown', () => {
		expect(ruleset_check.inspect(undefined, scratch).source).toEqual({ kind: 'unreadable' })
		expect(mocks.read).not.toHaveBeenCalled()
	})
})

describe('ruleset_check.inspect protection failures', () => {
	// Only GitHub's 404 means "no protection"; a 403 without admin access must not read as missing.
	it.each([
		[NOT_FOUND, 'none'],
		[FORBIDDEN, 'unreadable'],
	])('reads a protection failure with status %s as %s', (status, kind) => {
		stub_reads({ [RULES_PATH]: '[]' })
		fail_protection_read(status)

		expect(ruleset_check.inspect(REPO, scratch).source).toEqual({ kind })
	})
})

describe('ruleset_check.expected_in', () => {
	it('expects the checks the workflow on disk reports', () => {
		expect(ruleset_check.expected_in(scratch)).toEqual([SONAR_QUBE])
	})

	it('expects nothing from a same-named workflow that reports none of the checks', () => {
		const own = mkdtempSync(path.join(tmpdir(), 'ruleset-check-own-'))

		write_workflow(own, 'jobs:\n  build:\n    name: build\n')

		expect(ruleset_check.expected_in(own)).toEqual([])
		rmSync(own, { force: true, recursive: true })
	})
})

describe('ruleset_check.apply_missing', () => {
	it('puts the ruleset back with the missing checks appended', () => {
		mocks.exec.mockReturnValueOnce(
			JSON.stringify({ rules: [{ type: REQUIRED_STATUS_CHECKS, parameters: {} }] }),
		)
		const report = report_for({ kind: 'ruleset', ruleset_id: RULESET_ID, contexts: [] })

		expect(ruleset_check.apply_missing(report)).toBe(true)
		expect(mocks.exec).toHaveBeenLastCalledWith(
			expect.objectContaining({ path: RULESET_PATH, method: 'PUT' }),
		)
		expect(mocks.exec.mock.lastCall?.[0].body).toContain(SONAR_QUBE)
	})

	it('posts the missing checks to the branch protection contexts', () => {
		expect(ruleset_check.apply_missing(report_for({ kind: 'protection', contexts: [] }))).toBe(true)
		expect(mocks.exec).toHaveBeenCalledWith(
			expect.objectContaining({ path: `${PROTECTION_PATH}/contexts`, method: 'POST' }),
		)
	})

	it.each([[{ kind: 'none' }], [{ kind: 'unreadable' }]] as const)(
		'writes nothing for a %o source',
		(source) => {
			expect(ruleset_check.apply_missing(report_for(source))).toBe(false)
			expect(mocks.exec).not.toHaveBeenCalled()
		},
	)
})
