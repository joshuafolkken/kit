import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#6502: which GitHub stop a child's transcript ends on, and the reset a rate limit
// holds launches until.

const transcript_mock = vi.hoisted(() => vi.fn<() => string | undefined>())
const resources_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())
const events_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/run-ending', () => ({
	run_ending: { read_transcript: transcript_mock },
}))
vi.mock('#scripts/gh/gh-core-rate-limit', () => ({
	gh_core_rate_limit: { read_resources: resources_mock },
}))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock, current_events: events_mock },
}))

const { run_merge_github_limit } = await import('./run-merge-github-limit')
const { run_merge_usage_limit } = await import('./run-merge-usage-limit')
const { api_usage_limit } = await import('#scripts/agent/api-usage-limit')

const NOW_MS = Date.parse('2026-11-05T17:00:00.000Z')
const RESET_MS = Date.parse('2026-11-05T17:40:00.000Z')
const EXIT_LINE = '{"type":"result","subtype":"success","is_error":false,"result":"Stopped."}'
const FILLER_LINES = 30
const RATE_LIMIT = 'rate-limit'
const CHILD = '6465'
const OUTPUT = 'child.jsonl'
const REST_LIMIT =
	'Exit code 1\nHTTP 403: API rate limit exceeded for user ID 1. (https://api.github.com/)'
const BAD_CREDENTIALS = 'HTTP 401: Bad credentials (https://api.github.com/graphql)'

// A tool result's line, as Claude Code writes it into the stream-json log.
function result_line(content: unknown, is_error = true): string {
	const block = { type: 'tool_result', tool_use_id: 't1', content, is_error }

	return JSON.stringify({ type: 'user', message: { content: [block] } })
}

function ended_on(content: unknown, is_error = true): string {
	return `{"type":"system"}\n${result_line(content, is_error)}\n${EXIT_LINE}\n`
}

const RATE_LIMITED = ended_on(REST_LIMIT)

function limit(remaining: number): unknown {
	return { remaining, limit: 5000, reset_ms: RESET_MS }
}

describe('run_merge_github_limit.stop_of', () => {
	it('reads a REST, GraphQL or secondary rate limit', () => {
		const graphql = ended_on([{ type: 'text', text: 'GraphQL: API rate limit already exceeded' }])
		const secondary = ended_on('gh: You have exceeded a secondary rate limit.')

		expect(run_merge_github_limit.stop_of(RATE_LIMITED)).toBe(RATE_LIMIT)
		expect(run_merge_github_limit.stop_of(graphql)).toBe(RATE_LIMIT)
		expect(run_merge_github_limit.stop_of(secondary)).toBe(RATE_LIMIT)
	})

	it('reads an expired gh login', () => {
		const prompt = ended_on('To get started with GitHub CLI, please run:  gh auth login')

		expect(run_merge_github_limit.stop_of(ended_on(BAD_CREDENTIALS))).toBe('auth')
		expect(run_merge_github_limit.stop_of(prompt)).toBe('auth')
	})

	it('reads nothing from another stop, or from a log that does not end on an exit record', () => {
		expect(run_merge_github_limit.stop_of(ended_on('FAIL a.test.ts'))).toBeUndefined()
		expect(run_merge_github_limit.stop_of(`${result_line(REST_LIMIT)}\n`)).toBeUndefined()
		expect(run_merge_github_limit.stop_of(undefined)).toBeUndefined()
	})

	it('reads nothing from a file read, a test output or prose that quotes the words', () => {
		const file_read = ended_on(`  5\tconst text = '${REST_LIMIT}'`, false)
		const test_output = ended_on('AssertionError: expected 200, received HTTP 401: Bad credentials')
		const prose = `${JSON.stringify({ type: 'assistant', message: { content: REST_LIMIT } })}\n${EXIT_LINE}\n`

		expect(run_merge_github_limit.stop_of(file_read)).toBeUndefined()
		expect(run_merge_github_limit.stop_of(test_output)).toBeUndefined()
		expect(run_merge_github_limit.stop_of(prose)).toBeUndefined()
	})

	it('reads nothing from a limit the child recovered from before its last lines', () => {
		const filler = '{"type":"assistant"}\n'.repeat(FILLER_LINES)

		expect(run_merge_github_limit.stop_of(`${RATE_LIMITED}${filler}${EXIT_LINE}`)).toBeUndefined()
	})
})

describe('run_merge_github_limit.reset_ms', () => {
	it('names the reset of the exhausted resource', async () => {
		resources_mock.mockResolvedValue({ core: limit(4000), graphql: limit(0) })

		await expect(run_merge_github_limit.reset_ms(NOW_MS)).resolves.toBe(RESET_MS)
	})

	it('re-checks later when no resource is exhausted or the limit is unread', async () => {
		const later = NOW_MS + api_usage_limit.RECHECK_MS

		resources_mock.mockResolvedValue({ core: limit(4000), graphql: undefined })
		await expect(run_merge_github_limit.reset_ms(NOW_MS)).resolves.toBe(later)
		resources_mock.mockResolvedValue(undefined)
		await expect(run_merge_github_limit.reset_ms(NOW_MS)).resolves.toBe(later)
	})
})

describe('run_merge_github_limit.hold', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'], now: NOW_MS })
		resources_mock.mockResolvedValue({ core: limit(0), graphql: undefined })
		emit_mock.mockClear()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('holds launches until the rate limit resets', async () => {
		transcript_mock.mockReturnValue(RATE_LIMITED)

		await run_merge_github_limit.hold(CHILD, OUTPUT)
		const [kind, text] = emit_mock.mock.calls[0] as [string, string]

		events_mock.mockResolvedValue([{ pos: 1, at: '', kind, text }])
		expect(text).toBe('#6465 GitHub rate limit — resumes at 2026-11-05T17:40:00.000Z')
		await expect(run_merge_usage_limit.is_held(RESET_MS - 1)).resolves.toBe(true)
		await expect(run_merge_usage_limit.is_held(RESET_MS)).resolves.toBe(false)
	})

	it('holds nothing for an expired login or without a transcript', async () => {
		transcript_mock.mockReturnValue(ended_on(BAD_CREDENTIALS))

		await run_merge_github_limit.hold(CHILD, OUTPUT)
		await run_merge_github_limit.hold(CHILD, undefined)
		expect(emit_mock).not.toHaveBeenCalled()
	})
})
