import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cost_audit_cli } from './cost-audit-cli'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_read, type AuditSession } from './cost-audit-read'
import { cost_audit_read_chars } from './cost-audit-read-chars'

vi.mock(import('./cost-audit-read'), async (import_original) => {
	const actual = await import_original()

	return {
		cost_audit_read: {
			...actual.cost_audit_read,
			load: vi.fn(async () => []),
			load_lane_children: vi.fn(async () => []),
		},
	}
})

const { ms, day, request_line } = cost_audit_fixture
const { BRANCH, result_line } = time_transcript_fixture
const NOW_MS = ms(day(14))
const WINDOW = { start_ms: ms(day(7)), end_ms: NOW_MS }
const IN_PERIOD = day(10)
const TEMPLATE = 'prompts/collaboration-workflow/issue-template.md'
const TEMPLATE_PATH = `/Users/me/Development/kit/${TEMPLATE}`
const OTHER_PATH = '/Users/me/Development/kit/prompts/other.md'
const LANE_TEMPLATE_PATH = `/Users/me/Development/.kit-lanes/7/${TEMPLATE}`
const LABEL_PATTERN = /^Read chars of .+ \d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/u
const LANE_LABEL_PATTERN = /^lane-child Read chars per lane Issue \d{4}-/u
const REPO = '/repo'
const READ_CHARS_ARGV = ['--read-chars', TEMPLATE]
const LANE_FLAG = '--lane-read-chars'
const DENSITY_FLAG = '--density'

function read(path: string): { name: string; input: unknown } {
	return { name: 'Read', input: { file_path: path } }
}

// One session that reads `path` once at `minute`, its result `chars` long.
function reading(path: string, chars: number, minute: number, id: string): AuditSession {
	const lines = [
		request_line(minute, id, 1, [read(path)]),
		result_line(minute + 1, BRANCH, `${id}-Read`, 'x'.repeat(chars)),
	]

	return cost_audit_read.session_of(lines.join('\n'), false)
}

function lane(issue: number, session: AuditSession): AuditSession {
	return { ...session, is_lane: true, issue }
}

function printed_by(info: { mock: { calls: Array<Array<unknown>> } }): Array<string> {
	return info.mock.calls.map(([line]) => String(line))
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('cost_audit_read_chars.file_lines', () => {
	it('sums the Read chars of every path ending with the repository-relative path', () => {
		const sessions = [
			reading(TEMPLATE_PATH, 30, IN_PERIOD, 'a'),
			reading(LANE_TEMPLATE_PATH, 20, IN_PERIOD, 'b'),
			reading(OTHER_PATH, 500, IN_PERIOD, 'c'),
		]

		const lines = cost_audit_read_chars.file_lines(sessions, WINDOW, TEMPLATE)

		expect(lines).toStrictEqual([expect.stringMatching(LABEL_PATTERN), '50'])
	})

	it('counts no Read outside the period', () => {
		const sessions = [
			reading(TEMPLATE_PATH, 30, IN_PERIOD, 'a'),
			reading(TEMPLATE_PATH, 70, day(1), 'b'),
		]

		expect(cost_audit_read_chars.file_lines(sessions, WINDOW, TEMPLATE).at(-1)).toBe('30')
	})

	it('counts a key that is the path itself', () => {
		const sessions = [reading(TEMPLATE, 30, IN_PERIOD, 'a')]

		expect(cost_audit_read_chars.file_lines(sessions, WINDOW, TEMPLATE).at(-1)).toBe('30')
	})

	it('counts no key whose last segment only ends with the path file name', () => {
		const sessions = [reading('/Users/me/Development/kit/my-issue-template.md', 30, IN_PERIOD, 'a')]

		expect(cost_audit_read_chars.file_lines(sessions, WINDOW, 'issue-template.md')).toStrictEqual(
			[],
		)
	})

	it('prints nothing when no Read of the file ran in the period', () => {
		const sessions = [reading(OTHER_PATH, 30, IN_PERIOD, 'a')]

		expect(cost_audit_read_chars.file_lines(sessions, WINDOW, TEMPLATE)).toStrictEqual([])
	})
})

describe('cost_audit_read_chars.lane_lines', () => {
	it('divides the lane children Read chars by the distinct lane Issues', () => {
		const sessions = [
			lane(7, reading(TEMPLATE_PATH, 30, IN_PERIOD, 'a')),
			lane(7, reading(OTHER_PATH, 10, IN_PERIOD, 'b')),
			lane(8, reading(OTHER_PATH, 20, IN_PERIOD, 'c')),
		]

		const lines = cost_audit_read_chars.lane_lines(sessions, WINDOW)

		expect(lines).toStrictEqual([expect.stringMatching(LANE_LABEL_PATTERN), '30'])
	})

	it('counts no Issue whose session ran only before the period', () => {
		const sessions = [
			lane(7, reading(TEMPLATE_PATH, 30, IN_PERIOD, 'a')),
			lane(8, reading(OTHER_PATH, 90, day(1), 'b')),
		]

		expect(cost_audit_read_chars.lane_lines(sessions, WINDOW).at(-1)).toBe('30')
	})

	it('prints nothing when no lane-child session ran in the period', () => {
		expect(cost_audit_read_chars.lane_lines([], WINDOW)).toStrictEqual([])
	})
})

describe('cost:audit --read-chars and --lane-read-chars', () => {
	it('prints the file Read chars as the last line from every session of the period', async () => {
		vi.mocked(cost_audit_read.load).mockResolvedValue([reading(TEMPLATE_PATH, 30, IN_PERIOD, 'a')])
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const code = await cost_audit_cli.run(READ_CHARS_ARGV, REPO, NOW_MS)

		expect(code).toBe(0)
		expect(cost_audit_read.load).toHaveBeenCalledWith(REPO, WINDOW.start_ms)
		expect(printed_by(info).at(-1)).toBe('30')
	})

	it('prints the per-Issue figure from the lane children alone', async () => {
		const session = lane(7, reading(TEMPLATE_PATH, 40, IN_PERIOD, 'a'))

		vi.mocked(cost_audit_read.load_lane_children).mockResolvedValue([session])
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const code = await cost_audit_cli.run([LANE_FLAG], REPO, NOW_MS)

		expect(code).toBe(0)
		expect(cost_audit_read.load_lane_children).toHaveBeenCalledWith(REPO, WINDOW.start_ms)
		expect(printed_by(info).at(-1)).toBe('40')
	})

	it('exits 1 with nothing printed when the file was not read', async () => {
		vi.mocked(cost_audit_read.load).mockResolvedValue([])
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const code = await cost_audit_cli.run(READ_CHARS_ARGV, REPO, NOW_MS)

		expect(code).toBe(1)
		expect(info).not.toHaveBeenCalled()
	})
})

describe('cost_audit_cli.USAGE single-number modes', () => {
	it('names the two Read-chars modes beside --density', () => {
		expect(cost_audit_cli.USAGE).toContain('[--density | --read-chars <path> | --lane-read-chars]')
	})
})

describe('cost:audit single-number modes together', () => {
	it.each([
		[[...READ_CHARS_ARGV, LANE_FLAG]],
		[[...READ_CHARS_ARGV, DENSITY_FLAG]],
		[[LANE_FLAG, DENSITY_FLAG]],
	])('refuses more than one with the usage line: %j', async (argv) => {
		vi.mocked(cost_audit_read.load).mockClear()
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		const code = await cost_audit_cli.run(argv, REPO, NOW_MS)

		expect(code).toBe(1)
		expect(error).toHaveBeenCalledWith(cost_audit_cli.USAGE)
		expect(cost_audit_read.load).not.toHaveBeenCalled()
	})
})
