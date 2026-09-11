import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_test_fixture } from './gate-test-fixture'
import type { GateTree } from './gate-tree'
import { OBSERVATION_LEDGER_PATH } from './observations/observation-ledger'
import { review_stamps } from './review/review-stamps'

// joshuafolkken/kit#1381: the pre-push hook (joshuafolkken/kit#1334) and the pre-commit type check read
// one record through one decision. This suite pins the part they share, so neither hook's own suite is
// the only place a change to it would show up.

interface Repo {
	status: string
	unreadable: boolean
}

const repository = vi.hoisted((): Repo => ({ status: '', unreadable: false }))

vi.mock('./git/git-command', () => ({
	git_command: {
		status: async (): Promise<string> => {
			if (repository.unreadable) throw new Error('git status is unavailable')

			return repository.status
		},
	},
}))

const { hook_gate_reuse } = await import('./hook-gate-reuse')

const PATH = 'scripts/hook-gate-reuse.ts'
const STAGED_ONLY = `M  ${PATH}`
const RENAMED = `R  old.ts -> ${PATH}`
const UNSTAGED = ` M ${PATH}`
const PARTIALLY_STAGED = `MM ${PATH}`
const UNTRACKED = `?? ${PATH}`
const UNSTAGED_LEDGER = ` M ${OBSERVATION_LEDGER_PATH}`
const FORCE_ENV = 'JOSH_TEST_HOOK_FORCE'
const BASE = 'a1b2c3d4'
const TREE: GateTree = { files: { [PATH]: 'digest-one' }, base: BASE }
const NO_ARGUMENTS: ReadonlyArray<string> = []
const AN_ARGUMENT: ReadonlyArray<string> = ['--project=unit']

const { stamp_path, clear } = gate_test_fixture.suite_records('hook-gate-reuse')

function reusable(
	extra_arguments: ReadonlyArray<string> = NO_ARGUMENTS,
	is_tree_carried = true,
): ReturnType<typeof hook_gate_reuse.reusable_green_hook> {
	return hook_gate_reuse.reusable_green_hook({
		tree: TREE,
		is_tree_carried,
		extra_arguments,
		force_env: FORCE_ENV,
		source: stamp_path,
	})
}

beforeEach(() => {
	clear()
	repository.status = ''
	repository.unreadable = false
	vi.stubEnv(FORCE_ENV, '')
})

afterEach(() => {
	clear()
	vi.unstubAllEnvs()
})

// Read from a shell, where `=1` and `=true` are the two spellings a person reaches for and neither
// should be the one that silently does nothing.
describe('hook_gate_reuse.is_force_requested', () => {
	it.each(['1', 'true', 'off'])('is requested by any non-empty value (%s)', (value) => {
		vi.stubEnv(FORCE_ENV, value)

		expect(hook_gate_reuse.is_force_requested(FORCE_ENV)).toBe(true)
	})

	it('is not requested when the variable is empty', () => {
		expect(hook_gate_reuse.is_force_requested(FORCE_ENV)).toBe(false)
	})
})

// `undefined` rather than an empty list when the reading failed, so no caller can mistake "git said
// nothing" for "git could not be asked".
describe('hook_gate_reuse.read_status_lines', () => {
	it('drops the trailing blank line git leaves behind', async () => {
		repository.status = `${STAGED_ONLY}\n`

		expect(await hook_gate_reuse.read_status_lines()).toStrictEqual([STAGED_ONLY])
	})

	it('answers undefined rather than an empty list when git could not be read', async () => {
		repository.unreadable = true

		expect(await hook_gate_reuse.read_status_lines()).toBeUndefined()
	})

	// joshuafolkken/kit#1756: `pnpm josh git` no longer stages the observation ledger, so a parent's
	// appended line sits unstaged for the whole interval between the append and the next
	// `pnpm josh observations:flush`. Read as a difference, one such line would send every commit and
	// every push in the primary checkout back to the full gate for days — and nothing can carry it,
	// since the exclusion keeps it out of both the index and the push.
	it('drops the observation ledger, which no commit or push can carry', async () => {
		repository.status = `${UNSTAGED_LEDGER}\n${STAGED_ONLY}\n`

		expect(await hook_gate_reuse.read_status_lines()).toStrictEqual([STAGED_ONLY])
	})

	it('reads a tree holding only the ledger as clean', async () => {
		repository.status = `${UNSTAGED_LEDGER}\n`

		expect(hook_gate_reuse.is_worktree_clean(await hook_gate_reuse.read_status_lines())).toBe(true)
	})
})

describe('hook_gate_reuse.is_worktree_clean — what a push carries', () => {
	it('is clean only when nothing differs from HEAD at all', () => {
		expect(hook_gate_reuse.is_worktree_clean([])).toBe(true)
		expect(hook_gate_reuse.is_worktree_clean([STAGED_ONLY])).toBe(false)
	})

	it('is not clean when the status could not be read', () => {
		expect(hook_gate_reuse.is_worktree_clean(undefined)).toBe(false)
	})
})

describe('hook_gate_reuse.is_index_matching_worktree — what a commit carries', () => {
	it.each([STAGED_ONLY, RENAMED])('matches when the change is staged in full (%s)', (line) => {
		expect(hook_gate_reuse.is_index_matching_worktree([line])).toBe(true)
	})

	it.each([UNSTAGED, PARTIALLY_STAGED, UNTRACKED])(
		'does not match when the working tree holds content the index does not (%s)',
		(line) => {
			expect(hook_gate_reuse.is_index_matching_worktree([line])).toBe(false)
		},
	)

	it('does not match when the status could not be read', () => {
		expect(hook_gate_reuse.is_index_matching_worktree(undefined)).toBe(false)
	})
})

// Every condition here only ever narrows: the gate's three are necessary and never sufficient for a
// hook, so each of these refuses a record that the gate itself would have reused.
describe('hook_gate_reuse.reusable_green_hook', () => {
	beforeEach(() => {
		review_stamps.gate_stamp.write(TREE.files, stamp_path, BASE)
	})

	it('reuses a record covering a tree the git operation carries', () => {
		expect(reusable()).toBeDefined()
	})

	it('refuses when the git operation carries something else', () => {
		expect(reusable(NO_ARGUMENTS, false)).toBeUndefined()
	})

	it('refuses when any argument at all was passed', () => {
		expect(reusable(AN_ARGUMENT)).toBeUndefined()
	})

	it('refuses when the escape hatch is set', () => {
		vi.stubEnv(FORCE_ENV, '1')

		expect(reusable()).toBeUndefined()
	})
})
