import { describe, expect, it } from 'vitest'
import { time_ci, type CiInput } from './time-ci'
import { time_github, type CheckRunList, type PullSummary } from './time-github'
import { time_phase_fixture } from './time-phase-fixture'

// joshuafolkken/kit#1384: the CI windows a run's wall clock is attributed from. The reads are faked
// here rather than reached over the network — a test that has to call GitHub to prove the head
// commit is not read twice is a test nobody runs.

const { MINUTE_MS, span } = time_phase_fixture

const HEAD_SHA = 'aaaa1111'
const OTHER_SHA = 'bbbb2222'
const PULL_NUMBER = 7

const RATE_LIMIT_BODY = '{"message":"rate limited"}'

const OPENED_MS = 0
const MERGED_MS = 60 * MINUTE_MS

const PULL: PullSummary = {
	number: PULL_NUMBER,
	branch: '1384-ci',
	head_sha: HEAD_SHA,
	created_ms: OPENED_MS,
	merged_ms: MERGED_MS,
	updated_ms: MERGED_MS,
}

function run(name: string, started_ms: number, completed_ms: number): CheckRunList['runs'][number] {
	return { name, conclusion: 'success', started_ms, completed_ms }
}

function list(...runs: ReadonlyArray<CheckRunList['runs'][number]>): CheckRunList {
	return { runs, is_failed: false }
}

const HEAD_CHECKS = list(run('unit', 40 * MINUTE_MS, 45 * MINUTE_MS))

// What each faked read answered, so a test can assert the head commit cost no request at all.
interface Faked {
	paths: Array<string>
	// **How many reads were open at once, at the most.** The recorded order says nothing about this:
	// `Promise.all` over the same shas records the same order, because each read reaches its request
	// before its first suspension — so a guard written on `paths` alone passes on the fan-out it was
	// written to reject.
	flight: { open: number; peak: number }
	input: CiInput
}

function checks_body(started_minute: number, ended_minute: number): string {
	return JSON.stringify({
		check_runs: [
			{
				name: 'unit',
				conclusion: 'success',
				started_at: new Date(started_minute * MINUTE_MS).toISOString(),
				completed_at: new Date(ended_minute * MINUTE_MS).toISOString(),
			},
		],
	})
}

function faked(bodies: Record<string, string>, shas: ReadonlyArray<string> = [HEAD_SHA]): Faked {
	const paths: Array<string> = []
	const flight = { open: 0, peak: 0 }
	const commits = JSON.stringify(shas.map((sha) => ({ sha })))

	return {
		paths,
		flight,
		input: {
			pull: PULL,
			merged_ms: MERGED_MS,
			spans: [],
			head: HEAD_CHECKS,
			// The `await` is what makes the counter mean something: it suspends, so a second read
			// issued before this one resolves is visible as a peak of two.
			read: async (path: string) => {
				paths.push(path)
				flight.open += 1
				flight.peak = Math.max(flight.peak, flight.open)

				const body = await Promise.resolve(
					path.includes('/commits?') ? commits : (bodies[path] ?? ''),
				)

				flight.open -= 1

				return body
			},
		},
	}
}

// The two request paths, built from one prefix so a test cannot assert against a path the module
// never asks for. Concatenated rather than interpolated: `{owner}` inside a template literal reads
// as a mistyped placeholder.
const REPO_PATH = 'repos/{owner}/{repo}'
const COMMITS_PATH = `${REPO_PATH}/pulls/${String(PULL_NUMBER)}/commits?per_page=100`

function checks_path(sha: string): string {
	return `${REPO_PATH}/commits/${sha}/check-runs?per_page=100`
}

describe('time_ci.build_facts — one window per commit', () => {
	it('reads a window for every commit, not only the head one', async () => {
		const fake = faked({ [checks_path(OTHER_SHA)]: checks_body(10, 12) }, [OTHER_SHA, HEAD_SHA])
		const facts = await time_ci.build_facts(fake.input)

		expect(facts.windows).toEqual([
			{ started_ms: 10 * MINUTE_MS, ended_ms: 12 * MINUTE_MS },
			{ started_ms: 40 * MINUTE_MS, ended_ms: 45 * MINUTE_MS },
		])
	})

	// The head commit's checks were already read for the per-check table. Fetching them again spends a
	// request to produce a second reading that could disagree with the first.
	it('reuses the head commit list the caller already read', async () => {
		const fake = faked({})

		await time_ci.build_facts(fake.input)

		expect(fake.paths).toEqual([COMMITS_PATH])
	})

	// The jobs of one cycle run in parallel, so the cycle is as long as its slowest job rather than as
	// long as all of them put together.
	it('spans a cycle from its first start to its last finish', () => {
		const window = time_ci.cycle_window([run('a', 4, 9), run('b', 2, 6)], {
			started_ms: 0,
			ended_ms: 20,
		})

		expect(window).toEqual({ started_ms: 2, ended_ms: 9 })
	})

	it('clamps a window to the open→merge bounds', () => {
		const window = time_ci.cycle_window([run('a', 0, 30)], { started_ms: 5, ended_ms: 20 })

		expect(window).toEqual({ started_ms: 5, ended_ms: 20 })
	})

	it('yields no window for a commit that ran no check', () => {
		expect(time_ci.cycle_window([], { started_ms: 0, ended_ms: 20 })).toBeUndefined()
	})
})

describe('time_ci.build_facts — the category share', () => {
	// Unchanged by joshuafolkken/kit#1384: the part of the open→merge window that no span covers is
	// what a run left unattended spends, and the cycles are a separate figure.
	it('measures the part of the open→merge window no span covers', async () => {
		const fake = faked({})
		const facts = await time_ci.build_facts({ ...fake.input, spans: [span(0, 50)] })

		expect(facts.ci_ms).toBe(10 * MINUTE_MS)
	})
})

// Every read refused, which is what a rate limit looks like from here.
function refusing(): CiInput {
	return {
		pull: PULL,
		merged_ms: MERGED_MS,
		spans: [],
		head: HEAD_CHECKS,
		read: async () => {
			throw new Error('rate limited')
		},
	}
}

// The acceptance criterion of the issue's fourth box: a read nobody got an answer from is reported as
// unmeasured rather than as a run that waited no time at all.
describe('time_ci.build_facts — a read that could not answer', () => {
	it('reports unmeasured where the commit listing could not be read', async () => {
		const facts = await time_ci.build_facts(refusing())

		expect(facts.has_windows).toBe(false)
	})

	it('reports unmeasured where one commit check read was refused', async () => {
		const fake = faked({ [checks_path(OTHER_SHA)]: RATE_LIMIT_BODY }, [OTHER_SHA, HEAD_SHA])
		const facts = await time_ci.build_facts(fake.input)

		expect(facts.has_windows).toBe(false)
	})

	// A subset of the cycles is not the wait, so a pull request past the cap is reported as unmeasured
	// rather than measured from the commits that happened to fit.
	it('reports unmeasured where the pull request has more commits than the cap', async () => {
		const many = Array.from({ length: time_ci.MAX_COMMITS + 1 }, () => HEAD_SHA)
		const fake = faked({}, many)
		const facts = await time_ci.build_facts(fake.input)

		expect(facts.has_windows).toBe(false)
	})

	it('reports measured where every read answered', async () => {
		const facts = await time_ci.build_facts(faked({}).input)

		expect([facts.has_windows, facts.has_ci_data]).toEqual([true, true])
	})
})

// joshuafolkken/kit#1384's review: the cap existed to stop a pull request with fifty commits spending
// fifty requests, and applying it after the reads spent ten of them on an answer already discarded.
describe('time_ci.build_facts — the request budget', () => {
	it('reads no check-runs at all for a listing past the cap', async () => {
		const many = Array.from({ length: time_ci.MAX_COMMITS + 1 }, () => OTHER_SHA)
		const fake = faked({}, many)

		await time_ci.build_facts(fake.input)

		expect(fake.paths).toEqual([COMMITS_PATH])
	})

	// One read open at a time — the fan-out that would otherwise sit inside `time-batch.ts`'s pool of
	// eight run reports and multiply its bound by the commit count. **The peak is what proves it**: the
	// recorded order is the same either way.
	it('reads the commits one at a time', async () => {
		const fake = faked({}, [OTHER_SHA, HEAD_SHA])

		await time_ci.build_facts(fake.input)

		expect(fake.flight.peak).toBe(1)
		expect(fake.paths).toEqual([COMMITS_PATH, checks_path(OTHER_SHA)])
	})

	// One unread commit already fixes the answer at "could not measure", and the read that failed is
	// usually a rate limit — which every further request would deepen for the siblings still to come.
	it('stops reading at the first refusal', async () => {
		const shas = [OTHER_SHA, HEAD_SHA, OTHER_SHA]
		const fake = faked({ [checks_path(OTHER_SHA)]: RATE_LIMIT_BODY }, shas)

		await time_ci.build_facts(fake.input)

		expect(fake.paths).toEqual([COMMITS_PATH, checks_path(OTHER_SHA)])
	})
})

// The single-page commit listing cannot tell a full page from a truncated one, and what saves it is
// that a truncated page holds `PAGE_SIZE` rows — past the cap, so such a listing is reported
// unmeasured. That safety is a relation between two constants, so it is asserted rather than implied.
describe('time_ci.MAX_COMMITS', () => {
	it('stays under the page size the commit listing is read with', () => {
		expect(time_ci.MAX_COMMITS).toBeLessThan(time_github.PAGE_SIZE)
	})
})
