import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	compute_max_attempts,
	DEFAULT_MAX_ATTEMPTS,
	DEFAULT_STABLE_READS,
	evaluate_pr_state,
	get_configured_max_attempts,
	parse_pr_state_snapshot,
	parse_repo_name_from_package,
	wait_for_pr_success,
	type PrStateSnapshot,
	type RollupCheck,
} from './git-pr-checks'

const REPO_NAME = 'joshuafolkken-com'
const CODE_RABBIT = 'CodeRabbit'
const SONAR_QUBE = 'SonarQube'
const NO_SNAPSHOT_ERROR = 'No snapshot available for test.'

const PASSING_ROLLUP: ReadonlyArray<RollupCheck> = [
	{ name: CODE_RABBIT, status: 'pass' },
	{ name: SONAR_QUBE, status: 'pass' },
]

function make_snapshot(overrides: Partial<PrStateSnapshot> = {}): PrStateSnapshot {
	return {
		rollup: [...PASSING_ROLLUP],
		merge_state_status: 'CLEAN',
		review_decision: 'APPROVED',
		...overrides,
	}
}

function pending_rollup_snapshot(): PrStateSnapshot {
	return make_snapshot({ merge_state_status: 'UNKNOWN', rollup: [] })
}

function make_sequence_fetcher(snapshots: ReadonlyArray<PrStateSnapshot>): {
	count: () => number
	fetch: () => Promise<PrStateSnapshot>
} {
	let index = 0

	async function fetch(): Promise<PrStateSnapshot> {
		const snapshot = snapshots[index] ?? snapshots.at(-1)

		index += 1

		if (snapshot === undefined) throw new Error(NO_SNAPSHOT_ERROR)

		return await Promise.resolve(snapshot)
	}

	return { count: () => index, fetch }
}

describe('parse_repo_name_from_package', () => {
	it('returns the name field from package.json content', () => {
		expect(parse_repo_name_from_package('{"name":"joshuafolkken-com"}')).toBe(REPO_NAME)
	})

	it('throws when the name field is missing', () => {
		expect(() => parse_repo_name_from_package('{}')).toThrow()
	})

	it('throws when the name field is not a non-empty string', () => {
		expect(() => parse_repo_name_from_package('{"name":""}')).toThrow()
	})
})

describe('evaluate_pr_state — success paths', () => {
	it('success when merge state is CLEAN and every required rollup entry passes', () => {
		expect(evaluate_pr_state(make_snapshot())).toBe('success')
	})

	it('success when a non-required check is pending but required checks pass and merge is CLEAN', () => {
		const snapshot = make_snapshot({
			rollup: [...PASSING_ROLLUP, { name: 'Lighthouse', status: 'pending' }],
		})

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})
})

describe('evaluate_pr_state — failure paths', () => {
	it('failure when a required check has failed', () => {
		const snapshot = make_snapshot({
			rollup: [
				{ name: CODE_RABBIT, status: 'fail' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('failure')
	})

	it('failure when the review decision is CHANGES_REQUESTED even with a CLEAN merge', () => {
		expect(evaluate_pr_state(make_snapshot({ review_decision: 'CHANGES_REQUESTED' }))).toBe(
			'failure',
		)
	})
})

describe('evaluate_pr_state — pending: CLEAN merge but rollup incomplete', () => {
	it('pending when a required rollup entry is still pending', () => {
		const snapshot = make_snapshot({
			rollup: [
				{ name: CODE_RABBIT, status: 'pending' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})

	it('pending when a required rollup entry is missing', () => {
		const snapshot = make_snapshot({
			rollup: [{ name: CODE_RABBIT, status: 'pass' }],
		})

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})

	it('success when Workers Builds check is absent (not a required check for this repo)', () => {
		const snapshot = make_snapshot({
			rollup: [
				{ name: 'Workers Builds: @joshuafolkken/kit', status: 'missing' },
				{ name: CODE_RABBIT, status: 'pass' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('success')
	})
})

describe('evaluate_pr_state — pending: merge state not CLEAN', () => {
	it('pending when aggregator is UNKNOWN even if every required check is green', () => {
		expect(evaluate_pr_state(make_snapshot({ merge_state_status: 'UNKNOWN' }))).toBe('pending')
	})

	it('pending when merge state is BLOCKED and required checks are all green', () => {
		expect(evaluate_pr_state(make_snapshot({ merge_state_status: 'BLOCKED' }))).toBe('pending')
	})

	it('pending when merge state is UNKNOWN and a required check is still pending', () => {
		const snapshot = make_snapshot({
			merge_state_status: 'UNKNOWN',
			rollup: [
				{ name: CODE_RABBIT, status: 'pending' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
		})

		expect(evaluate_pr_state(snapshot)).toBe('pending')
	})
})

function check_run(name: string): Record<string, string> {
	return {
		// eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API uses `__typename` as the discriminator
		__typename: 'CheckRun',
		name,
		status: 'completed',
		conclusion: 'success',
	}
}

describe('parse_pr_state_snapshot', () => {
	it('parses mergeStateStatus, reviewDecision, and rollup from a gh pr view JSON payload', () => {
		const raw = JSON.stringify({
			mergeStateStatus: 'CLEAN',
			reviewDecision: 'APPROVED',
			statusCheckRollup: [check_run(CODE_RABBIT), check_run(SONAR_QUBE)],
		})

		expect(parse_pr_state_snapshot(raw)).toStrictEqual({
			rollup: [
				{ name: CODE_RABBIT, status: 'pass' },
				{ name: SONAR_QUBE, status: 'pass' },
			],
			merge_state_status: 'CLEAN',
			review_decision: 'APPROVED',
		})
	})

	it('returns undefined fields when JSON is empty', () => {
		expect(parse_pr_state_snapshot('')).toStrictEqual({
			rollup: [],
			merge_state_status: undefined,
			review_decision: undefined,
		})
	})
})

describe('wait_for_pr_success — stable-read window', () => {
	it('returns only after two consecutive success reads', async () => {
		const sequence = make_sequence_fetcher([
			pending_rollup_snapshot(),
			make_snapshot(),
			make_snapshot(),
		])

		const result = await wait_for_pr_success({
			branch_name: 'feature/x',
			fetcher: sequence.fetch,
			interval_ms: 0,
			max_attempts: 10,
			required_stable_reads: DEFAULT_STABLE_READS,
		})

		expect(result.merge_state_status).toBe('CLEAN')
		expect(sequence.count()).toBe(3)
	})

	it('resets the stable counter when a pending read interrupts the run', async () => {
		const sequence = make_sequence_fetcher([
			make_snapshot(),
			pending_rollup_snapshot(),
			make_snapshot(),
			make_snapshot(),
		])

		await wait_for_pr_success({
			branch_name: 'feature/x',
			fetcher: sequence.fetch,
			interval_ms: 0,
			max_attempts: 10,
			required_stable_reads: DEFAULT_STABLE_READS,
		})

		expect(sequence.count()).toBe(4)
	})
})

describe('wait_for_pr_success — failure and timeout', () => {
	it('throws immediately when the evaluator reports failure', async () => {
		const sequence = make_sequence_fetcher([
			make_snapshot({ review_decision: 'CHANGES_REQUESTED' }),
		])

		await expect(
			wait_for_pr_success({
				branch_name: 'feature/x',
				fetcher: sequence.fetch,
				interval_ms: 0,
				max_attempts: 5,
				required_stable_reads: DEFAULT_STABLE_READS,
			}),
		).rejects.toThrow(/failed|CHANGES/u)
	})

	it('throws when max_attempts is exhausted while the state remains pending', async () => {
		const sequence = make_sequence_fetcher([pending_rollup_snapshot()])

		await expect(
			wait_for_pr_success({
				branch_name: 'feature/x',
				fetcher: sequence.fetch,
				interval_ms: 0,
				max_attempts: 3,
				required_stable_reads: DEFAULT_STABLE_READS,
			}),
		).rejects.toThrow(/Timed out/u)
	})
})

describe('compute_max_attempts', () => {
	it('returns 18 for 180s timeout and 10s interval', () => {
		expect(compute_max_attempts(180, 10_000)).toBe(18)
	})

	it('rounds up when timeout does not divide evenly', () => {
		expect(compute_max_attempts(181, 10_000)).toBe(19)
	})

	it('returns 3 for 30s timeout and 10s interval', () => {
		expect(compute_max_attempts(30, 10_000)).toBe(3)
	})
})

describe('get_configured_max_attempts', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('returns DEFAULT_MAX_ATTEMPTS when env var is not set', () => {
		expect(get_configured_max_attempts()).toBe(DEFAULT_MAX_ATTEMPTS)
	})

	it('returns computed value when env var is a valid positive number', () => {
		vi.stubEnv('JOSH_CI_TIMEOUT_SECONDS', '60')
		expect(get_configured_max_attempts()).toBe(6)
	})

	it('returns DEFAULT_MAX_ATTEMPTS when env var is zero', () => {
		vi.stubEnv('JOSH_CI_TIMEOUT_SECONDS', '0')
		expect(get_configured_max_attempts()).toBe(DEFAULT_MAX_ATTEMPTS)
	})

	it('returns DEFAULT_MAX_ATTEMPTS when env var is negative', () => {
		vi.stubEnv('JOSH_CI_TIMEOUT_SECONDS', '-30')
		expect(get_configured_max_attempts()).toBe(DEFAULT_MAX_ATTEMPTS)
	})

	it('returns DEFAULT_MAX_ATTEMPTS when env var is not a number', () => {
		vi.stubEnv('JOSH_CI_TIMEOUT_SECONDS', 'abc')
		expect(get_configured_max_attempts()).toBe(DEFAULT_MAX_ATTEMPTS)
	})
})
