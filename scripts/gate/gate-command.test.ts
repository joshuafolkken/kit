import { afterEach, describe, expect, it, vi } from 'vitest'
import { gate_command } from './gate-command'
import { gate_skip } from './gate-skip'
import { gate_static_group } from './gate-static-group'
import { gate_test_fixture } from './gate-test-fixture'
import { verification_gate, type GateOptions } from './verification-gate'

// The argument reading alone: the gate it starts is stubbed, so each case asserts what `josh gate`
// asks of the gate. The real fan-out behind the flags is `verification-gate.test.ts`'s.
const REFUSAL_MESSAGE = 'josh gate takes no extra arguments'
const GATE_EXIT_CODE = 3
const [STATIC_GROUP = ''] = Object.keys(gate_static_group.STATIC_GROUPS)
const STATIC_GROUP_FLAG = `${gate_static_group.STATIC_GROUP_FLAG_PREFIX}${STATIC_GROUP}`
const { FORWARDED_FLAG } = gate_test_fixture

const BARE: GateOptions = {
	is_verbose: false,
	is_forced: false,
	is_unit_included: true,
	is_whole_tree_included: false,
}
const NO_UNIT: GateOptions = { is_unit_included: false, is_whole_tree_included: true }

const STARTED_GATES: ReadonlyArray<readonly [string, ReadonlyArray<string>, GateOptions]> = [
	['no argument', [], BARE],
	['--verbose', [gate_command.VERBOSE_FLAG], { is_verbose: true }],
	['--force', [gate_skip.FORCE_FLAG], { is_forced: true }],
	['--no-unit', [gate_command.NO_UNIT_FLAG], NO_UNIT],
	['--whole-tree', [gate_command.WHOLE_TREE_FLAG], { is_whole_tree_included: true }],
	['a static group', [STATIC_GROUP_FLAG], { ...NO_UNIT, static_group: STATIC_GROUP }],
]

const run_gate = vi.spyOn(verification_gate, 'run_verification_gate')

afterEach(() => {
	run_gate.mockReset()
})

describe('gate_command.run_gate_command — refusals', () => {
	// `gate` forwards nothing to its four sub-commands, so an appended flag would vanish silently —
	// the hole the composite-argument guard closes for `sh -c` entries.
	it.each([
		['alone', [FORWARDED_FLAG]],
		['beside a flag the gate consumes', [gate_command.VERBOSE_FLAG, FORWARDED_FLAG]],
	])('refuses an argument it would forward %s, runs nothing and exits 1', async (_case, argv) => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		try {
			expect(await gate_command.run_gate_command(argv)).toBe(1)
			expect(error).toHaveBeenCalledWith(expect.stringContaining(REFUSAL_MESSAGE))
			// A refusal that named only `--verbose` would send a reader to drop the flag they need.
			expect(error).toHaveBeenCalledWith(
				expect.stringContaining(gate_command.ACCEPTED_FLAGS.join(' ')),
			)
			expect(run_gate).not.toHaveBeenCalled()
		} finally {
			error.mockRestore()
		}
	})

	// joshuafolkken/kit#7612: a help request is answered, not refused, and runs nothing.
	it.each(['--help', '-h'])('prints the usage and exits 0 on %s', async (flag) => {
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		try {
			expect(await gate_command.run_gate_command([flag])).toBe(0)
			expect(info).toHaveBeenCalledWith(expect.stringMatching(/^Usage: josh gate \[--verbose\]/u))
			expect(run_gate).not.toHaveBeenCalled()
		} finally {
			info.mockRestore()
		}
	})
})

describe('gate_command.run_gate_command — the gate it starts', () => {
	it.each(STARTED_GATES)('answers the gate exit code on %s', async (_case, argv, expected) => {
		run_gate.mockResolvedValue(GATE_EXIT_CODE)

		expect(await gate_command.run_gate_command(argv)).toBe(GATE_EXIT_CODE)
		expect(run_gate).toHaveBeenCalledWith(
			expect.objectContaining({ is_scoped_enforced: true, ...expected }),
		)
	})

	// The caller's destinations ride along, but a flag the user typed is never overridden by them.
	it('passes the caller options through beneath the flags', async () => {
		run_gate.mockResolvedValue(0)

		await gate_command.run_gate_command([gate_command.VERBOSE_FLAG], {
			is_verbose: false,
			is_scoped_enforced: false,
			log_path: 'gate.log',
		})

		expect(run_gate).toHaveBeenCalledWith(
			expect.objectContaining({
				is_verbose: true,
				is_scoped_enforced: false,
				log_path: 'gate.log',
			}),
		)
	})
})
