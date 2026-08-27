import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { delegation_cli } from './delegation-cli'
import { delegation_policy } from './delegation-policy'

const GATE_FIX = 'gate-fix'
const UNLISTED = 'anything-nobody-listed'
const REVIEW = 'review'

// joshuafolkken/kit#969: which steps may run in a cheaper tier is decided by an enumeration, and
// everything not enumerated is kept. The direction of the default is the whole safety argument — a
// step nobody thought about costs money rather than correctness.

describe('delegation_policy.verdict_for', () => {
	it.each(delegation_policy.DELEGATABLE_STEPS.map((step) => step.name))(
		'delegates the enumerated %s',
		(name) => {
			expect(delegation_policy.verdict_for(name)).toBe(delegation_policy.DELEGATE_VERDICT)
		},
	)

	it.each(delegation_policy.REJECTED_STEPS.map((step) => step.name))(
		'keeps the deliberately rejected %s',
		(name) => {
			expect(delegation_policy.verdict_for(name)).toBe(delegation_policy.KEEP_VERDICT)
		},
	)

	// The default is the rule, not a fallback: a step nobody has classified must not be delegated
	// because nobody said it could not be.
	it.each(['', ' '.repeat(3), UNLISTED, 'GATE-FIX', 'gate fix'])(
		'keeps %j, which is not on the list',
		(name) => {
			expect(delegation_policy.verdict_for(name)).toBe(delegation_policy.KEEP_VERDICT)
		},
	)

	it('ignores surrounding whitespace on a listed step', () => {
		expect(delegation_policy.verdict_for(`  ${GATE_FIX}  `)).toBe(
			delegation_policy.DELEGATE_VERDICT,
		)
	})
})

// The condition that earns a step its place. Without a verifier the cheaper tier's mistakes ship,
// which is the failure this whole rule exists to avoid — so the enumeration cannot contain an entry
// that does not name one.
describe('every delegatable step names how a wrong result is caught', () => {
	it.each(delegation_policy.DELEGATABLE_STEPS)('$name names a verifier', (step) => {
		expect(step.verifier.trim()).not.toBe('')
	})

	it.each(delegation_policy.DELEGATABLE_STEPS)('$name says what it does', (step) => {
		expect(step.does.trim()).not.toBe('')
	})

	it.each(delegation_policy.REJECTED_STEPS)('$name says why it was rejected', (step) => {
		expect(step.because.trim()).not.toBe('')
	})

	// A name on both lists would make the answer depend on which is consulted first.
	it('lists no step as both delegatable and rejected', () => {
		const delegatable = new Set(delegation_policy.DELEGATABLE_STEPS.map((step) => step.name))

		for (const step of delegation_policy.REJECTED_STEPS) {
			expect(delegatable.has(step.name)).toBe(false)
		}
	})
})

describe('delegation_policy.reason_for', () => {
	it('gives the verifier as the reason for a delegatable step', () => {
		expect(delegation_policy.reason_for(GATE_FIX)).toContain('josh gate')
	})

	// The two kinds of `keep` are different answers: one was judged, the other was never considered.
	it('tells a deliberate rejection apart from an unlisted step', () => {
		expect(delegation_policy.reason_for(REVIEW)).toContain('kept deliberately')
		expect(delegation_policy.reason_for(UNLISTED)).toContain('kept by default')
	})
})

describe('josh delegate registration', () => {
	it('is registered as a josh command', () => {
		const { delegate } = COMMAND_MAP

		expect(delegate?.script).toBe('scripts/delegation/delegation-cli.ts')
	})

	it('has a short alias', () => {
		const { dg } = ALIASES

		expect(dg).toBe('delegate')
	})
})

describe('delegation_cli.run', () => {
	it('answers a single step', () => {
		expect(delegation_cli.run([GATE_FIX])).toBe(0)
	})

	it('prints the whole list on request', () => {
		expect(delegation_cli.run(['--list'])).toBe(0)
	})

	it('refuses no argument rather than guessing', () => {
		expect(delegation_cli.run([])).toBe(1)
	})

	// Two steps would need two verdicts, and a caller reading one token would take the first as the
	// answer for both.
	it('refuses more than one step', () => {
		expect(delegation_cli.run([GATE_FIX, REVIEW])).toBe(1)
	})

	// A step name never starts with a dash. Without this, `josh delegate --help` answered `keep` —
	// a mistyped invocation reading as a verdict about a step called `--help`.
	// The leading space is not decoration: the policy lookup trims, so an untrimmed guard let
	// `josh delegate ' --help'` through and answered `keep` for a step called ` --help`.
	it.each([['--help'], ['-l'], ['--lst'], [''], [' --help'], ['  -l  ']])(
		'refuses %j rather than answering keep',
		(bad) => {
			expect(delegation_cli.run([bad])).toBe(1)
		},
	)

	it('still accepts the one flag it has', () => {
		expect(delegation_cli.run(['--list'])).toBe(0)
	})
})
