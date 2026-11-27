import { run_headless_keys } from '#scripts/run/run-headless-keys'
import type { StageCommand } from '#scripts/run/run-stage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntryRequest } from './run-entry-children'
import { run_entry_handoff_root, type RootPorts } from './run-entry-handoff-root'

// joshuafolkken/kit#9103: a `fullrun new` hand-off child that has filed its issue hands the run into the
// lane rather than claiming the checkout it was typed in.

const ISSUE = '9096'
const ROOT = '/home/dev/kit'
const LANE = '/home/dev/.kit-lanes/9096'
const HANDOFF_CHILD = { [run_headless_keys.HANDOFF_CHILD_KEY]: '1' }

function request(command: StageCommand = 'fullrun'): EntryRequest {
	return { issue_number: ISSUE, command, is_adopt: false }
}

function ports(overrides: Partial<RootPorts> = {}): RootPorts {
	return { cwd: ROOT, environment: HANDOFF_CHILD, branch_at: async () => 'main', ...overrides }
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_entry_handoff_root.is_refused — a hand-off child outside the issue tree', () => {
	it.each(['fullrun', 'halfrun', 'prrun'] as const)(
		'refuses %s on the primary checkout off the issue branch and names the hand-off',
		async (command) => {
			expect(await run_entry_handoff_root.is_refused(request(command), ports())).toBe(true)
			expect(console.error).toHaveBeenCalledExactlyOnceWith(
				expect.stringContaining(`pnpm josh run:handoff ${command} ${ISSUE}`),
			)
		},
	)

	it('refuses on a branch of another issue', async () => {
		const other = ports({ branch_at: async () => '9093-lane' })

		expect(await run_entry_handoff_root.is_refused(request(), other)).toBe(true)
	})

	it('tells a child whose run:handoff refused to end rather than fall back to this checkout', async () => {
		await run_entry_handoff_root.is_refused(request(), ports())

		expect(console.error).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining('If run:handoff refuses, end with its note and the issue URL'),
		)
	})
})

describe('run_entry_handoff_root.is_refused — the entries that pass', () => {
	it('passes in the issue lane', async () => {
		const lane = ports({ cwd: LANE, branch_at: async () => 'unrelated' })

		expect(await run_entry_handoff_root.is_refused(request(), lane)).toBe(false)
	})

	it('passes on a checkout already on the issue branch', async () => {
		const own = ports({ branch_at: async () => `${ISSUE}-ship-the-themes` })

		expect(await run_entry_handoff_root.is_refused(request(), own)).toBe(false)
	})

	it('passes a session that run:handoff did not start', async () => {
		const outside = ports({ environment: {} })

		expect(await run_entry_handoff_root.is_refused(request(), outside)).toBe(false)
	})

	it('passes kickoff, which claims nothing', async () => {
		expect(await run_entry_handoff_root.is_refused(request('kickoff'), ports())).toBe(false)
		expect(console.error).not.toHaveBeenCalled()
	})
})
