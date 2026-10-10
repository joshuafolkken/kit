import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace } from '#scripts/git/git-fixture-workspace'
import { josh_harness, type HarnessResult, type JoshEnvironment } from '#scripts/test/josh-harness'
import { josh_harness_fixture } from '#scripts/test/josh-harness-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { metrics_base } from './metrics-base'
import { metrics_ratchet } from './metrics-ratchet'

// Runs the real `josh metrics` in a kit-shaped repository (joshuafolkken/kit#3644):
// that the totals are held to the merge-base's, measured in a throwaway tree, is a property of the
// command, git and the two trees together, which no mocked git can show.

const { SCENARIO_TIMEOUT_MS, SETUP_TIMEOUT_MS } = josh_harness_fixture
const TOTALS_ONLY: ReadonlyArray<string> = ['metrics', '--totals-only']
const REASON = 'Fixture rules'
const ACCEPT: ReadonlyArray<string> = ['metrics', '--accept', '--reason', REASON]
const RULES_FILE = 'prompts/README.md'
const GROWN_RULES = 'A rule.\n\nAnother rule.\n'
const ISSUE = 7
const ISSUE_BRANCH = '7-lane'
const RULE_LINES = 'rules.lines'
const ON_DEMAND_BYTES = 'ai_cost.on_demand_bytes'
// Past anything the two added lines can reach: what is asked is that an approval covers the growth.
const APPROVED_GROWTH = 10_000
const APPROVAL = {
	reason: REASON,
	date: '2026-10-10',
	growth: { [RULE_LINES]: APPROVED_GROWTH, [ON_DEMAND_BYTES]: APPROVED_GROWTH },
}
const NOT_GROWN = 'no total grew past the merge-base'
const NO_ISSUE = 'this branch names no issue to record under'
const APPROVAL_FILE = '7.json'
const PARENT = 'HEAD^1'

const opened: { kit?: JoshEnvironment } = {}

function kit(): JoshEnvironment {
	if (opened.kit === undefined) throw new Error('no kit environment was opened')

	return opened.kit
}

async function git(arguments_: ReadonlyArray<string>): Promise<string> {
	return await git_fixture_workspace.git(kit().root, arguments_)
}

function grow_rules(): void {
	appendFileSync(path.join(kit().root, RULES_FILE), GROWN_RULES)
}

async function check(): Promise<HarnessResult> {
	return await josh_harness.run(kit(), TOTALS_ONLY)
}

async function accept(): Promise<HarnessResult> {
	return await josh_harness.run(kit(), ACCEPT)
}

function approval_files(): ReadonlyArray<string> {
	return [...metrics_base.approval_texts(kit().root).keys()]
}

async function worktrees(): Promise<string> {
	return await git(['worktree', 'list', '--porcelain'])
}

// The child inherits this process's environment, so a base named in the shell that runs the suite
// would be the one every scenario measured from.
beforeEach(async () => {
	vi.stubEnv(metrics_base.BASE_VARIABLE, '')
	opened.kit = await josh_harness.open_environment('kit')
}, SETUP_TIMEOUT_MS)

josh_harness_fixture.stop_leftovers_after_each()

afterEach(() => {
	vi.unstubAllEnvs()
	if (opened.kit !== undefined) josh_harness.close_environment(opened.kit)
})

describe('josh metrics --totals-only against the merge-base', () => {
	it(
		'passes on the default branch with nothing changed',
		async () => {
			const result = await check()

			expect(result.stdout).toContain(NOT_GROWN)
			expect(result.exit_code).toBe(0)
		},
		SCENARIO_TIMEOUT_MS,
	)

	it(
		'fails a branch whose rule documents grew, naming the total, and leaves no tree behind',
		async () => {
			await git(['switch', '-c', ISSUE_BRANCH])
			const before = await worktrees()

			grow_rules()

			const result = await check()

			expect(result.stderr).toContain(RULE_LINES)
			expect(result.exit_code).toBe(1)
			expect(await worktrees()).toBe(before)
		},
		SCENARIO_TIMEOUT_MS,
	)
})

describe('josh metrics --totals-only with an approval', () => {
	it(
		"passes the same growth once the issue's approval file covers it",
		async () => {
			await git(['switch', '-c', ISSUE_BRANCH])
			grow_rules()
			metrics_base.write_approval(kit().root, ISSUE, APPROVAL)

			const result = await check()

			expect(result.stdout).toContain('within the approval this branch recorded')
			expect(result.exit_code).toBe(0)
		},
		SCENARIO_TIMEOUT_MS,
	)

	// An approval that reached the default branch approved the branch that wrote it, and no later one.
	it(
		'fails a growth the only approval for which the merge-base already holds',
		async () => {
			metrics_base.write_approval(kit().root, ISSUE, APPROVAL)
			await git(['add', '-A'])
			await git(['commit', '-m', 'approval'])
			await git(['switch', '-c', ISSUE_BRANCH])
			grow_rules()

			const result = await check()

			expect(result.stderr).toContain(RULE_LINES)
			expect(result.exit_code).toBe(1)
		},
		SCENARIO_TIMEOUT_MS,
	)
})

describe('josh metrics --accept', () => {
	it(
		'records the growth in the file of the issue the branch names, and the check then passes',
		async () => {
			await git(['switch', '-c', ISSUE_BRANCH])
			grow_rules()

			const accepted = await accept()
			const [text = ''] = metrics_base.approval_texts(kit().root).values()
			const checked = await check()

			expect(accepted.exit_code).toBe(0)
			expect(approval_files()).toStrictEqual([APPROVAL_FILE])
			expect(metrics_ratchet.parse_approval(text)?.growth[RULE_LINES]).toBeGreaterThan(0)
			expect(checked.exit_code).toBe(0)
		},
		SCENARIO_TIMEOUT_MS,
	)
})

describe('josh metrics --accept on a branch that names no issue', () => {
	// The durations are accepted by the same form, on any branch: only a growth needs an issue.
	it(
		'asks for no issue on a branch that has no growth to record',
		async () => {
			const result = await accept()

			expect(result.stdout).toContain('there is no growth to record')
			expect(result.stderr).not.toContain(NO_ISSUE)
			expect(result.exit_code).toBe(0)
		},
		SCENARIO_TIMEOUT_MS,
	)

	it(
		'refuses to record a growth on a branch that names no issue, and writes no file',
		async () => {
			grow_rules()

			const result = await accept()

			expect(result.stderr).toContain(NO_ISSUE)
			expect(result.exit_code).toBe(1)
			expect(approval_files()).toStrictEqual([])
		},
		SCENARIO_TIMEOUT_MS,
	)
})

describe('josh metrics --totals-only with JOSH_METRICS_BASE', () => {
	it(
		'measures from the named commit where the merge-base is the checkout itself',
		async () => {
			grow_rules()
			await git(['add', '-A'])
			await git(['commit', '-m', 'rules'])
			const unnamed = await check()

			vi.stubEnv(metrics_base.BASE_VARIABLE, PARENT)

			const named = await check()

			expect(unnamed.exit_code).toBe(0)
			expect(named.stderr).toContain(RULE_LINES)
			expect(named.exit_code).toBe(1)
		},
		SCENARIO_TIMEOUT_MS,
	)

	it(
		'fails on a name that resolves to no commit rather than comparing with nothing',
		async () => {
			vi.stubEnv(metrics_base.BASE_VARIABLE, 'no-such-ref')

			const result = await check()

			expect(result.stderr).toContain(`${metrics_base.BASE_VARIABLE}=no-such-ref names no commit`)
			expect(result.exit_code).not.toBe(0)
			expect(result.stdout).not.toContain(NOT_GROWN)
		},
		SCENARIO_TIMEOUT_MS,
	)
})
