import { beforeEach, describe, expect, it, vi } from 'vitest'

const changed_mock = vi.hoisted(() => vi.fn())
const repository_mock = vi.hoisted(() => vi.fn())
const replace_mock = vi.hoisted(() => vi.fn())
const read_log_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: changed_mock },
}))
vi.mock('#scripts/git/git-common-directory', () => ({
	git_common_directory: { read_repository: repository_mock },
}))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		stamp_path: (prefix: string): string => `/tmp/${prefix}key.log`,
		replace_text_stamp: replace_mock,
	},
}))
vi.mock('#scripts/review/review-stop-log', () => ({ review_stop_log: { read: read_log_mock } }))

const { run_ship_stop_context } = await import('./run-ship-stop-context')
const { agent_role_profile } = await import('#scripts/agent/agent-role-profile')

// joshuafolkken/kit#3923: a relaunched child's prompt carries the failed output's tail and the changed
// files, bounded, so the session starts at the fix rather than at `josh ship --log` and `git diff`.

const ISSUE = '3923'
const { EXCERPT_LINE_LIMIT, CHANGED_PATH_LIMIT } = run_ship_stop_context
const FULL_OUTPUT_PATH = `/tmp/josh-ship-stop-${ISSUE}-key.log`
const EXTRA_LINES = 5
const CHANGED_FILE = 'scripts/a.ts'
const RED = '\u{1B}[31m'
const RESET = '\u{1B}[0m'
const LINE_PADDING = 100
const BUDGET = 1000
// Room for the tail line, the heading and two padded earlier findings, not three.
const PRIOR_BUDGET = 450
const PRIOR_ENTRY = 'a.ts:3 — reads EPERM as dead. (bug-risks:medium, stopped in the review stage)'
const STOP_FINDING = { kind: 'performance:medium', location: 'a.ts:3', sentence: 'a sync ps.' }
const PRIOR_LINE = {
	at: '2026-10-25T00:00:00.000Z',
	issue: Number(ISSUE),
	stage: 'review',
	kind: 'bug-risks:medium',
	location: 'a.ts:2',
	sentence: 'reads EPERM as dead.',
}

function numbered(count: number, prefix: string): Array<string> {
	return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1)}`)
}

function padded(label: string): string {
	return `${label} ${'p'.repeat(LINE_PADDING)}`
}

function long_output(): Array<string> {
	return numbered(EXCERPT_LINE_LIMIT + EXTRA_LINES, 'line ')
}

beforeEach(() => {
	changed_mock.mockReset().mockResolvedValue([CHANGED_FILE])
	repository_mock.mockReset().mockResolvedValue('/repo')
	replace_mock.mockReset().mockImplementation((target: string) => target)
	read_log_mock.mockReset().mockReturnValue([])
})

describe('run_ship_stop_context.build — the failed output', () => {
	it('keeps every line of an output within the bound and writes no file', async () => {
		const context = await run_ship_stop_context.build(ISSUE, `${RED}error${RESET} one\ntwo\n`)

		expect(context.excerpt).toStrictEqual(['error one', 'two'])
		expect(context.omitted).toBeUndefined()
		expect(replace_mock).not.toHaveBeenCalled()
	})

	it('keeps only the frame a spinner left and the text of a CRLF line', async () => {
		const context = await run_ship_stop_context.build(ISSUE, '- lint\r✅ lint\r\nFAIL gate\r\n')

		expect(context.excerpt).toStrictEqual(['✅ lint', 'FAIL gate'])
	})

	it('keeps the tail of a long output and names the file and range the rest is in', async () => {
		const lines = long_output()
		const context = await run_ship_stop_context.build(ISSUE, lines.join('\n'))

		expect(context.excerpt).toStrictEqual(lines.slice(-EXCERPT_LINE_LIMIT))
		expect(context.omitted).toStrictEqual({ path: FULL_OUTPUT_PATH, last_line: EXTRA_LINES })
		expect(replace_mock).toHaveBeenCalledWith(FULL_OUTPUT_PATH, lines.join('\n'))
	})

	it('still reports the cut, with no path, when the full output cannot be written', async () => {
		replace_mock.mockImplementation(() => {
			throw new Error('refused')
		})
		const context = await run_ship_stop_context.build(ISSUE, long_output().join('\n'))

		expect(context.excerpt).toHaveLength(EXCERPT_LINE_LIMIT)
		expect(context.omitted).toStrictEqual({ last_line: EXTRA_LINES })
	})

	it('still reports the cut, with no path, outside a repository', async () => {
		repository_mock.mockResolvedValue(undefined)
		const context = await run_ship_stop_context.build(ISSUE, long_output().join('\n'))

		expect(context.omitted).toStrictEqual({ last_line: EXTRA_LINES })
		expect(replace_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_stop_context.build — the changed files', () => {
	it('bounds the changed files and counts the rest', async () => {
		const paths = numbered(CHANGED_PATH_LIMIT + EXTRA_LINES, 'file-')

		changed_mock.mockResolvedValue(paths)
		const context = await run_ship_stop_context.build(ISSUE, '')

		expect(context.changed).toStrictEqual(paths.slice(0, CHANGED_PATH_LIMIT))
		expect(context.more_changed).toBe(EXTRA_LINES)
		expect(context.excerpt).toStrictEqual([])
	})

	it('leaves the changed files out, never empty, when git cannot answer', async () => {
		changed_mock.mockRejectedValue(new Error('no git'))
		const context = await run_ship_stop_context.build(ISSUE, 'x')

		expect(context.changed).toBeUndefined()
		expect(run_ship_stop_context.describe(ISSUE, context)).toContain(
			'The changed files could not be read from git.',
		)
	})
})

describe('run_ship_stop_context.build — the earlier findings', () => {
	it('carries the earlier findings on the files the stop cites', async () => {
		read_log_mock.mockReturnValue([PRIOR_LINE])
		const context = await run_ship_stop_context.build(ISSUE, 'x', [STOP_FINDING])

		expect(context.prior).toStrictEqual([expect.stringContaining('a.ts:2 — reads EPERM as dead.')])
	})

	it('leaves the field out, and the block as it was, when none applies', async () => {
		read_log_mock.mockReturnValue([PRIOR_LINE])
		const context = await run_ship_stop_context.build(ISSUE, 'x', [
			{ ...STOP_FINDING, location: 'b.ts:1' },
		])

		expect(context).not.toHaveProperty('prior')
		expect(run_ship_stop_context.describe(ISSUE, context)).toBe(
			`The failed stage output:\nx\nChanged files on the branch: ${CHANGED_FILE}.`,
		)
	})
})

describe('run_ship_stop_context.describe', () => {
	it('puts the excerpt and the changed files in the prompt block', () => {
		const text = run_ship_stop_context.describe(ISSUE, {
			excerpt: ['FAIL scripts/a.test.ts'],
			changed: [CHANGED_FILE],
			more_changed: 2,
		})

		expect(text).toBe(
			`The failed stage output:\nFAIL scripts/a.test.ts\nChanged files on the branch: ${CHANGED_FILE} (and 2 more).`,
		)
	})

	it('appends the earlier findings on the same files after the changed files', () => {
		const text = run_ship_stop_context.describe(ISSUE, {
			excerpt: ['bug-risks:medium:a.ts:3 — a sync ps per redraw.'],
			changed: [CHANGED_FILE],
			more_changed: 0,
			prior: [PRIOR_ENTRY],
		})

		expect(text.split('\n').slice(-2)).toStrictEqual([
			expect.stringContaining('confirm the fix still meets each'),
			`- ${PRIOR_ENTRY}`,
		])
	})

	it('carries only the changed files when the stage printed nothing', () => {
		const context = { excerpt: [], changed: [CHANGED_FILE], more_changed: 0 }

		expect(run_ship_stop_context.describe(ISSUE, context)).toBe(
			`Changed files on the branch: ${CHANGED_FILE}.`,
		)
		expect(run_ship_stop_context.has_excerpt(context)).toBe(false)
	})
})

describe('run_ship_stop_context.describe — an omitted head', () => {
	it('names the file and line range of an omitted head', () => {
		const text = run_ship_stop_context.describe(ISSUE, {
			excerpt: ['tail'],
			omitted: { path: FULL_OUTPUT_PATH, last_line: EXTRA_LINES },
			changed: [],
			more_changed: 0,
		})

		expect(text).toContain(`lines 1-${String(EXTRA_LINES)} are in ${FULL_OUTPUT_PATH}`)
		expect(text).toContain('No files changed against the default branch.')
	})

	it('points an omitted head with no file at the stopped report', () => {
		const text = run_ship_stop_context.describe(ISSUE, {
			excerpt: ['tail'],
			omitted: { last_line: EXTRA_LINES },
			changed: [],
			more_changed: 0,
		})

		expect(text).toContain(`are in the stopped report (\`pnpm josh ship --log ${ISSUE}\`)`)
	})
})

// joshuafolkken/kit#3964: the prompt is one argv element — refused past its cap and on any control
// character but a line break — so the excerpt is made printable and fitted to the budget it is given.
describe('run_ship_stop_context — fit for one argv element', () => {
	it('turns control characters a check printed into spaces and cuts an overlong line', async () => {
		const wide = 'w'.repeat(agent_role_profile.MAX_VALUE_LENGTH)
		const context = await run_ship_stop_context.build(ISSUE, `FAIL\tgate\u{7}\n${wide}\n`)

		expect(context.excerpt[0]).toBe('FAIL gate ')
		expect(context.excerpt[1]?.length).toBeLessThan(wide.length)
	})

	it('drops the head of the excerpt to fit the budget and widens the omitted range', async () => {
		const lines = long_output().map((line) => `${line} ${'x'.repeat(LINE_PADDING)}`)
		const context = await run_ship_stop_context.build(ISSUE, lines.join('\n'))
		const text = run_ship_stop_context.describe(ISSUE, context, BUDGET)
		const shown = text.split('\n').filter((line) => line.startsWith('line '))

		expect(text.length).toBeLessThanOrEqual(BUDGET)
		expect(shown.at(-1)).toBe(lines.at(-1))
		expect(text).toContain(`its last ${String(shown.length)} lines`)
		expect(text).toContain(`lines 1-${String(lines.length - shown.length)} are in`)
	})

	it('drops the earlier findings oldest first once only the tail line is left', () => {
		const prior = [padded('oldest'), padded('middle'), padded('newest')]
		const context = { excerpt: ['tail'], changed: [], more_changed: 0, prior }
		const text = run_ship_stop_context.describe(ISSUE, context, PRIOR_BUDGET)

		expect(text.length).toBeLessThanOrEqual(PRIOR_BUDGET)
		expect(text).toContain('tail')
		expect(text).toContain('middle')
		expect(text).toContain('newest')
		expect(text).not.toContain('oldest')
	})
})
