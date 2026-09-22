import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'
import { test_declared_commit } from './test-declared-commit'

// joshuafolkken/kit#2118: the verdict is read from the real working tree, so this suite drives real git
// in a throwaway repository — the way `git-staging-ledger.test.ts` does — and pins that the delivery
// fires only on `required`. Both directions matter: silent on a satisfied or exempt tree, speaking on
// an untested runtime change. The trigger and reason it exercises are `test-declared-commit.ts`.

const { git } = git_fixture_workspace
const NOW_MS = 1_700_000_000_000
const FOREGROUND_PUSH = 'pnpm josh git -y "Refuse a commit whose code change carries no test #2118"'
const RUNTIME_FILE = 'scripts/thing.ts'
const README = 'README.md'
const A_RUNTIME_LINE = 'export const x = 1\n'
const A_CHANGED_LINE = 'export const x = 2\n'
const DECLARED = 'test-declared'
const RUN_TAIL = 'run-tail'
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'test-declared-rule-'))
const ENTRY_DIRECTORY = process.cwd()
const WRITTEN_TRANSCRIPTS = new Set<string>()

const state: { fixture: FixtureWorkspace } = {
	fixture: { workspace: '', previous_cwd: '', restore_environment: undefined },
}

function write_file(relative_path: string, body: string): void {
	const target = path.join(state.fixture.workspace, relative_path)

	mkdirSync(path.dirname(target), { recursive: true })
	writeFileSync(target, body)
}

// `scripts/thing.ts` is committed so its directory is tracked: a new file beside it then lists as its
// own path rather than as an untracked `scripts/` directory, which is what lets the satisfied case name
// the test file.
async function build_repository(): Promise<void> {
	const { workspace } = state.fixture

	await git(workspace, ['init', git_fixture_workspace.MAIN_BRANCH])
	write_file(README, 'first\n')
	write_file(RUNTIME_FILE, A_RUNTIME_LINE)
	await git(workspace, ['add', '-A'])
	await git(workspace, ['commit', '-m', 'initial'])
}

function transcript(name: string): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, '')
	WRITTEN_TRANSCRIPTS.add(target)

	return target
}

// A backgrounded push keeps `run-tail` silent, so a silence case tests only test-declared's decision.
function push_payload(name: string, is_background: boolean): string {
	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript(name),
		tool_name: 'Bash',
		tool_input: { command: FOREGROUND_PUSH, run_in_background: is_background },
	})
}

beforeEach(async () => {
	process.env[SWITCH_ENV_KEY] = ''
	state.fixture = git_fixture_workspace.open_workspace('test-declared-rule-repo-')
	await build_repository()
	process.chdir(state.fixture.workspace)
})

afterEach(async () => {
	await git_fixture_workspace.close_workspace(state.fixture)
})

afterAll(() => {
	process.chdir(ENTRY_DIRECTORY)

	for (const target of WRITTEN_TRANSCRIPTS) {
		rmSync(delivered_rules.delivery_path(DECLARED, target), { force: true })
		rmSync(delivered_rules.delivery_path(RUN_TAIL, target), { force: true })
	}

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

describe('rule_delivery — the test-declared rule at the commit stage', () => {
	it('delivers on a foreground commit that changes a runtime file with no test', () => {
		write_file(RUNTIME_FILE, A_CHANGED_LINE)

		expect(rule_delivery(push_payload('required', false), NOW_MS)).toBe(test_declared_commit.REASON)
	})

	it('says nothing when a test file changed', () => {
		write_file('scripts/thing.test.ts', A_RUNTIME_LINE)

		expect(rule_delivery(push_payload('satisfied', true), NOW_MS)).toBeUndefined()
	})

	it('says nothing when only documentation changed', () => {
		write_file(README, 'second\n')

		expect(rule_delivery(push_payload('exempt', true), NOW_MS)).toBeUndefined()
	})

	// The deliberate overlap with run-tail, in the order that makes it safe: test-declared decides
	// whether the commit should happen at all, so it is delivered first; run-tail is delivered on the
	// reissue, its per-id stamp untouched by the first refusal.
	it('delivers test-declared first and run-tail on the reissue for an untested foreground push', () => {
		write_file(RUNTIME_FILE, A_CHANGED_LINE)
		const payload = push_payload('overlap', false)

		expect(rule_delivery(payload, NOW_MS)).toBe(test_declared_commit.REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBe(delivered_rules.RUN_TAIL_REASON)
	})
})

describe('TEST_DECLARED_REASON', () => {
	it.each([
		// The command a person runs to see the same answer.
		['pnpm josh test:declared'],
		['required'],
		// The rule it enforces, and the exception a person declares past it.
		['ALL code changes'],
		['non-runtime exception'],
		['Step 0 work summary'],
		// The pointer, and the reissue sentence every delivery needs.
		['prompts/collaboration-workflow/rule-delivery.md'],
		['once per run'],
	])('carries %j', (marker) => {
		expect(test_declared_commit.REASON).toContain(marker)
	})
})
