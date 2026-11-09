import { gh_request_tally } from '#scripts/gh/gh-request-tally'
import { gh_usage_event, type GhUsageContext, type GhUsageLine } from '#scripts/gh/gh-usage-event'
import { GH_REQUEST_TIMEOUT_MS, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { josh_gh_usage } from './josh-gh-usage'

// joshuafolkken/kit#6707: the josh entry writes one gh usage line as a command ends, and the
// command's exit code is returned untouched.

const STARTED_MS = 1_792_999_000_000
const EXIT_CODE = 3
const ISSUE = 6707

function recording_write(): {
	lines: Array<GhUsageLine>
	write: (context: GhUsageContext) => Promise<void>
} {
	const lines: Array<GhUsageLine> = []

	return {
		lines,
		write: async (context) => {
			await gh_usage_event.write(context, async (line) => {
				lines.push(line)
			})
		},
	}
}

beforeEach(() => {
	gh_request_tally.reset()
	gh_usage_event.reset()
	vi.spyOn(Date, 'now').mockReturnValue(STARTED_MS)
	vi.spyOn(gh_request_tally, 'watch_core').mockReturnValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh_gh_usage.recorded — the entry record', () => {
	it('writes one gh usage line for a command that called gh, and returns its exit code', async () => {
		const { lines, write } = recording_write()

		const exit_code = await josh_gh_usage.recorded(
			'run:step',
			[String(ISSUE)],
			async () => {
				gh_request_tally.count_call('graphql')

				return EXIT_CODE
			},
			write,
		)

		await write({ command: 'run:step', started_ms: STARTED_MS })

		expect(exit_code).toBe(EXIT_CODE)
		expect(lines).toHaveLength(1)
		expect(lines[0]).toMatchObject({
			command: 'run:step',
			issue: ISSUE,
			calls: 1,
		})
	})

	it('writes nothing for a command that sent no gh call', async () => {
		const { lines, write } = recording_write()

		expect(await josh_gh_usage.recorded('help', [], async () => 0, write)).toBe(0)
		expect(lines).toHaveLength(0)
	})
})

describe('josh_gh_usage.recorded — a throwing command and the watch', () => {
	it('still writes when the command throws, and rethrows its error', async () => {
		const { lines, write } = recording_write()
		const failing = josh_gh_usage.recorded(
			'run:board',
			['--chat'],
			async () => {
				gh_request_tally.count_call('graphql')
				throw new Error('boom')
			},
			write,
		)

		await expect(failing).rejects.toThrow('boom')
		expect(lines).toHaveLength(1)
		expect(lines[0]?.issue).toBeUndefined()
	})

	it('starts watching the core allowance before the command runs', async () => {
		const order: Array<string> = []

		vi.mocked(gh_request_tally.watch_core).mockImplementation(() => {
			order.push('watch')
		})
		await josh_gh_usage.recorded(
			'run:step',
			[],
			async () => {
				order.push('run')
			},
			vi.fn(),
		)

		expect(order).toStrictEqual(['watch', 'run'])
	})
})

describe('josh_gh_usage.read_usage_bounded — the exit-time reading', () => {
	it('sends the rate_limit reading with a short budget rather than the default request timeout', async () => {
		const requests: Array<GhApiRequest> = []

		await josh_gh_usage.read_usage_bounded(async (request) => {
			requests.push(request)

			return '{"used":7,"remaining":4993,"limit":5000,"reset":1792999999}'
		})

		expect(requests).toHaveLength(1)
		expect(requests[0]?.timeout_ms).toBeGreaterThan(0)
		expect(requests[0]?.timeout_ms).toBeLessThan(GH_REQUEST_TIMEOUT_MS)
	})

	it('reads as none when the reading times out', async () => {
		const reading = await josh_gh_usage.read_usage_bounded(async () => {
			throw new Error('timed out')
		})

		expect(reading).toBeUndefined()
	})
})
