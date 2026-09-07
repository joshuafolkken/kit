import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'
import { gate_test_fixture } from './gate-test-fixture'
import { review_stamps } from './review/review-stamps'
import { package_file } from './skill-fixture'

// joshuafolkken/kit#1486: children no longer run `pnpm josh bump minor`. `pnpm josh release`
// (joshuafolkken/kit#1169) decides the version from main's own history, so the branch a child
// commits carries no version change at all.
//
// **Two things had to go with it, and this suite pins both.**
//
// The first is joshuafolkken/kit#1437's bump→gate ordering refusal, which stopped `josh gate`
// whenever a green record covered work whose changed files carried no `package.json`. That shape was
// "the bump is still owed" only while children bumped; now it is what every run looks like, so the
// refusal would have rejected every gate after the first green one — the exact standing false
// positive its own module said it must not have.
//
// The second is the instruction itself, in the eleven documents a run reads. A refusal removed from
// the code while a document still prescribes `bump minor` leaves the run bumping for nothing, and the
// version then moves in two places that cannot agree.

vi.mock('execa', () => ({ execa: vi.fn() }))

vi.mock('./type-check-step', () => ({
	type_check_step: {
		resolve_type_check_args: async (): Promise<ReadonlyArray<string>> => ['josh', 'check'],
	},
}))

const repository = vi.hoisted(() => ({ tree: {}, base: '' }))

vi.mock('./review/review-tree', () => ({
	review_tree: {
		read_changed_tree: async (): Promise<Record<string, string>> => repository.tree,
	},
}))

vi.mock('./git/git-command', () => ({
	git_command: { change_base_commit: async (): Promise<string> => repository.base },
}))

const { verification_gate } = await import('./verification-gate')
const execa_module = await import('execa')
const mocked_execa = vi.mocked(execa_module.execa)

const { as_execa_implementation, fake_result } = gate_test_fixture

const PASS = 0
const CHECK_COUNT = 4
const BASE = 'a1b2c3d4'
const GATE_SOURCE = 'scripts/verification-gate.ts'
const REVIEW_PROMPT = 'prompts/review.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const BEFORE_FIX: Record<string, string> = { [GATE_SOURCE]: 'digest-one' }
const AFTER_FIX: Record<string, string> = { [GATE_SOURCE]: 'digest-two' }

const RECORDS = gate_test_fixture.suite_records('child-bump-removed')
const { clear: clear_records, marker_path: MARKER_PATH, stamp_path: STAMP_PATH } = RECORDS

beforeEach(() => {
	vi.clearAllMocks()
	clear_records()
	repository.tree = AFTER_FIX
	repository.base = BASE
})

afterEach(clear_records)

async function run_gate(): Promise<number> {
	mocked_execa.mockImplementation(as_execa_implementation(async () => fake_result(PASS, '')))

	return await verification_gate.run_verification_gate({
		stamp_path: STAMP_PATH,
		marker_path: MARKER_PATH,
	})
}

// The exact shape joshuafolkken/kit#1437 refused: a green record taken on this base over the same
// work, and a tree that has moved since, with no `package.json` anywhere in it. Under the old rule
// nothing ran and the gate exited non-zero. It is now a child's ordinary second gate.
describe('the bump→gate ordering refusal is gone', () => {
	it('runs all four checks over a moved tree that carries no version bump', async () => {
		review_stamps.gate_stamp.write(BEFORE_FIX, STAMP_PATH, BASE)

		const code = await run_gate()

		expect(code).toBe(PASS)
		expect(mocked_execa.mock.calls).toHaveLength(CHECK_COUNT)
	})
})

const REMOVED_FILES: ReadonlyArray<string> = [
	'scripts/gate-bump-order.ts',
	'scripts/gate-bump-order.test.ts',
]

describe('the module that enforced the order is removed', () => {
	it.each(REMOVED_FILES)('%s is gone', (relative_path) => {
		expect(existsSync(package_file(relative_path))).toBe(false)
	})

	it('the gate no longer reaches for it', () => {
		expect(read_unwrapped(GATE_SOURCE)).not.toContain('gate_bump_order')
	})
})

// Every document a run reads at the point it would have bumped. `docs/josh-commands.md` is
// deliberately absent: `josh bump` itself still exists and is still documented there — it is what
// `josh release` uses — and only the child flow is what this change removes.
const CHILD_FLOW_DOCUMENTS: ReadonlyArray<string> = [
	'CLAUDE.md',
	REVIEW_PROMPT,
	'prompts/collaboration-workflow/plan-comment.md',
	'prompts/collaboration-workflow/cross-repo-epic.md',
	'.claude/skills/workflow-commands/SKILL.md',
	CHAIN_RULE,
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/halfrun.md',
	'.claude/skills/workflow-commands/queue.md',
	'.claude/skills/workflow-commands/epicrun.md',
	'.claude/skills/workflow-commands/eval-gate.md',
]

describe('no document still puts a version bump in the child flow', () => {
	it.each(CHILD_FLOW_DOCUMENTS)('%s never tells a child to bump', (relative_path) => {
		expect(read_unwrapped(relative_path)).not.toContain('josh bump minor')
	})
})

// The instruction a run follows when it writes its completion report. It is the one place that told
// an agent to quote a version at the reader, so a stale copy here reproduces the false claim the code
// no longer makes.
describe('the completion instruction reports a count, not a version', () => {
	const content = read_unwrapped('.claude/skills/workflow-commands/followup.md')

	it('no longer tells the run to surface a project version', () => {
		expect(content).not.toContain('📦 project version')
	})

	it('names the count that replaced it', () => {
		expect(content).toContain('unreleased merges on main')
	})
})

// The replacement has to be named somewhere a run reads, or a child that no longer bumps looks like
// a version that never moves.
describe('the documents name what raises the version instead', () => {
	it.each([REVIEW_PROMPT, CHAIN_RULE])('%s names `pnpm josh release`', (relative_path) => {
		expect(read_unwrapped(relative_path)).toContain('pnpm josh release')
	})
})
