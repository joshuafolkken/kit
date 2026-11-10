import { delivered_rules_harness } from '#tools/rules/delivered-rules-harness'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { direct_vitest_run } from './direct-vitest-run'
import { poll_loop } from './poll-loop'

// joshuafolkken/kit#7144: a hand-typed `vitest run` that `pnpm josh test:related` can carry is pointed
// there on every occurrence; a value-taking flag, another subcommand, help and a reserved run stay
// silent.

const harness = delivered_rules_harness.create_harness('rule-guard-vitest-run-')
const { payload_of } = harness
const NOW_MS = 1_700_000_000_000
const LATER_MS = NOW_MS + 1000
const ROW_ID = 'direct-vitest-run'
const PNPM_VITEST_RUN = 'pnpm vitest run'

beforeEach(() => {
	process.env[delivered_rules.SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	harness.cleanup()
})

describe('direct_vitest_run.is_direct_vitest_run — refuses', () => {
	it.each([
		'vitest',
		'vitest run',
		'vitest run scripts/rules/poll-loop.test.ts',
		'vitest scripts/rules/poll-loop.test.ts',
		PNPM_VITEST_RUN,
		'pnpm exec vitest run -t "a title"',
		'npx vitest run --reporter=dot',
		'node_modules/.bin/vitest run',
		"sh -c 'pnpm vitest run'",
		'pnpm josh ms && pnpm vitest run',
	])('refuses %j', (command) => {
		expect(direct_vitest_run.is_direct_vitest_run(command)).toBe(true)
	})
})

describe('direct_vitest_run.is_direct_vitest_run — is silent on', () => {
	it.each([
		'pnpm josh test:related scripts/rules/poll-loop.test.ts',
		'pnpm vitest run --project unit',
		'pnpm vitest run --project=unit',
		'vitest run --config vitest.harness.config.ts',
		'vitest run -c vitest.harness.config.ts',
		'vitest bench',
		'vitest list',
		'vitest --help',
		'vitest --version',
		'pnpm josh reserved-run 4 -- pnpm vitest run',
		'echo "pnpm vitest run"',
		"git commit -m 'vitest run'",
	])('is silent on %j', (command) => {
		expect(direct_vitest_run.is_direct_vitest_run(command)).toBe(false)
	})
})

describe('direct-vitest-run — delivered through the guard', () => {
	it('refuses every occurrence, the reissue included', () => {
		const payload = payload_of('vitest-run-every', PNPM_VITEST_RUN)

		expect(delivered_rules.delivery(payload, NOW_MS)).toBe(
			direct_vitest_run.DIRECT_VITEST_RUN_REASON,
		)
		expect(delivered_rules.delivery(payload, LATER_MS)).toBe(
			direct_vitest_run.DIRECT_VITEST_RUN_REASON,
		)
	})

	it('leaves a polling loop over a vitest run to poll-loop alone', () => {
		const command = 'while ! pnpm vitest run; do sleep 5; done'

		expect(delivered_rules.delivery(payload_of('vitest-run-poll', command), NOW_MS)).toBe(
			poll_loop.POLL_LOOP_REASON,
		)
	})

	it('is registered ahead of timed-rerun and lane-direct-tool', () => {
		const ids = delivered_rules.DELIVERED_RULES.map((row) => row.id)

		expect(ids.indexOf(ROW_ID)).toBeLessThan(ids.indexOf('timed-rerun'))
		expect(ids.indexOf(ROW_ID)).toBeLessThan(ids.indexOf('lane-direct-tool'))
	})

	it('points the refusal at test:related', () => {
		expect(direct_vitest_run.DIRECT_VITEST_RUN_REASON).toContain('pnpm josh test:related')
	})
})
