import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { GATE_STEPS } from '#scripts/verification-gate'
import { describe, expect, it } from 'vitest'
import { propagate_run } from './propagate-run'
import { propagate_steps } from './propagate-steps'
import type { PropagateTarget } from './propagate-targets'

const KIT = '@joshuafolkken/kit'
const VERSION = '1.111.0'
const TARGET: PropagateTarget = {
	repo: 'joshuafolkken/app-kit',
	path: '/Users/example/Development/app-kit',
	state: 'ready',
}

describe('propagate_steps.parse_issue_number', () => {
	it('reads the number gh prints as the new issue URL', () => {
		expect(
			propagate_steps.parse_issue_number('https://github.com/joshuafolkken/app-kit/issues/42\n'),
		).toBe('42')
	})

	it('returns nothing when gh printed something else', () => {
		expect(propagate_steps.parse_issue_number('could not create issue')).toBeUndefined()
	})

	it('returns nothing for empty output', () => {
		expect(propagate_steps.parse_issue_number('')).toBeUndefined()
	})
})

describe('propagate_steps.issue_title', () => {
	// `josh git` derives the branch name and the `closes #N` line from this argument, so the title
	// has to be a plain one-line English string.
	it('names the package and the exact version being carried', () => {
		expect(propagate_steps.issue_title(KIT, VERSION)).toBe(`Upgrade ${KIT} to ${VERSION}`)
	})

	it('produces a single line', () => {
		expect(propagate_steps.issue_title(KIT, VERSION)).not.toContain('\n')
	})
})

describe('propagate_steps.describe_step', () => {
	it('touches nothing and reports the step as describable', () => {
		expect(propagate_steps.describe_step(TARGET, propagate_run.STEP_SYNC).is_ok).toBe(true)
	})
})

describe('propagate_steps.STEP_COMMANDS', () => {
	it('runs the consumer own CLI, never this checkout', () => {
		expect(propagate_steps.STEP_COMMANDS[propagate_run.STEP_SYNC]?.slice(0, 2)).toEqual([
			'pnpm',
			'josh',
		])
	})

	// The four checks used to be re-chained here as a string. They are now single-sourced in
	// `josh gate` (joshuafolkken/kit#914), so the coverage is asserted against that definition —
	// a check added to the gate reaches the consumer-side verification without a second edit.
	it('runs the whole gate, not only the type check', () => {
		expect(propagate_steps.VERIFY_SCRIPT).toBe(`pnpm josh ${GATE_COMMAND}`)

		const gate_commands = GATE_STEPS.map((step) => step.command_args.at(-1))

		expect(gate_commands).toEqual(['lint', 'check', 'cspell:dot', 'test:unit'])
	})

	// A step that failed the gate must never reach the pull request, so the verification has to be
	// one command whose failure ends the sequence. `josh gate` runs every check even when one fails
	// — reporting all of them — and still exits non-zero, which is what stops the sequence.
	it('verifies with a single command whose failure stops the sequence', () => {
		expect(propagate_steps.VERIFY_SCRIPT).not.toContain('&&')
	})
})

// The exact version is the whole point of the publish wait: `josh version:upgrade` installs the
// registry's latest, so a release published while the run was in flight would be the one every
// consumer received instead.
describe('propagate_steps.upgrade_command', () => {
	it('pins the exact version that was waited for', () => {
		expect(propagate_steps.upgrade_command(KIT, VERSION).join(' ')).toContain(`${KIT}@${VERSION}`)
	})

	it('never asks for latest', () => {
		expect(propagate_steps.upgrade_command(KIT, VERSION).join(' ')).not.toContain('latest')
	})

	it('installs into the consumer own dev dependencies', () => {
		expect(propagate_steps.upgrade_command(KIT, VERSION).join(' ')).toContain('pnpm add -D')
	})

	it('repairs the lockfile the way kit own upgrade does', () => {
		expect(propagate_steps.upgrade_command(KIT, VERSION).join(' ')).toContain('fix-gh-packages')
	})
})

describe('propagate_steps.precheck_step', () => {
	it('refuses a consumer whose checkout is not a git repository', () => {
		const result = propagate_steps.precheck_step(
			{ ...TARGET, path: '/nonexistent-propagate-consumer' },
			propagate_run.STEP_PRECHECK,
		)

		expect(result.is_ok).toBe(false)
	})
})

describe('propagate_run.STEP_ORDER', () => {
	// Everything after the pre-check writes: the upgrade rewrites the lockfile, the sync overwrites
	// managed files. Refusing a dirty consumer afterwards would be refusing it too late.
	it('checks the working tree before anything writes to it', () => {
		expect(propagate_run.STEP_ORDER[0]).toBe(propagate_run.STEP_PRECHECK)
	})

	it('opens the issue before the pull request that closes it', () => {
		const order = propagate_run.STEP_ORDER

		expect(order.indexOf(propagate_run.STEP_ISSUE)).toBeLessThan(
			order.indexOf(propagate_run.STEP_PR),
		)
	})

	it('verifies before opening anything at all', () => {
		const order = propagate_run.STEP_ORDER

		expect(order.indexOf(propagate_run.STEP_VERIFY)).toBeLessThan(
			order.indexOf(propagate_run.STEP_ISSUE),
		)
	})

	// `josh git` leaves the consumer on the feature branch; the next run's pre-check would refuse it
	// for that, and the consumer would silently stop receiving releases.
	it('returns the consumer to its default branch last', () => {
		expect(propagate_run.STEP_ORDER.at(-1)).toBe(propagate_run.STEP_RETURN)
	})
})
