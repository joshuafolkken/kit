import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_preflight, type PreflightDecision } from './run-preflight'
import { run_preflight_cli } from './run-preflight-cli'

// `check` is spied rather than the module mocked: `parse_issue` reads the issue-number pattern from
// this same module, and a mock factory listing `check` alone would leave that constant `undefined`.

const SUCCESS = 0
const FAILURE = 1

const DECISION: PreflightDecision = {
	advice: 'Start the child.',
	reason: 'Nothing was left behind.',
	verdict: 'clean',
}

const out: Array<string> = []
const errors: Array<string> = []

function arrange_decision(decision: PreflightDecision): void {
	vi.spyOn(run_preflight, 'check').mockResolvedValue(decision)
}

beforeEach(() => {
	out.length = 0
	errors.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		errors.push(line)
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('the verdict is the only thing on standard output', () => {
	it.each(['clean', 'reclaim', 'resume', 'park'] as const)('prints %j alone', async (verdict) => {
		arrange_decision({ ...DECISION, verdict })

		expect(await run_preflight_cli.run(['926'])).toBe(SUCCESS)
		expect(out).toStrictEqual([verdict])
	})

	it('sends the reason and the advice to standard error', async () => {
		arrange_decision({ advice: 'do this', reason: 'found that', verdict: 'reclaim' })

		await run_preflight_cli.run(['926'])

		expect(errors).toStrictEqual(['found that\ndo this'])
	})
})

describe('a tree that cannot be read is unknown, never clean', () => {
	it('prints the unknown token and exits non-zero', async () => {
		vi.spyOn(run_preflight, 'check').mockRejectedValue(new Error('no git directory'))

		expect(await run_preflight_cli.run(['926'])).toBe(FAILURE)
		expect(out).toStrictEqual([run_preflight_cli.UNKNOWN_VERDICT])
	})
})

describe('the issue number is required', () => {
	it.each([[[]], [['0']], [['abc']], [['926', '927']]])(
		'refuses %j with the usage line',
		async (argv) => {
			const check = vi.spyOn(run_preflight, 'check')

			expect(await run_preflight_cli.run(argv)).toBe(FAILURE)
			expect(errors).toStrictEqual([run_preflight_cli.USAGE])
			expect(check).not.toHaveBeenCalled()
		},
	)

	it('accepts a plain issue number', () => {
		expect(run_preflight_cli.parse_issue(['926'])).toBe('926')
	})
})
