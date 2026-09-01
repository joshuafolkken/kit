import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cost_cli } from './cost-cli'
import { cost_transcript } from './cost-transcript'

const CWD = '/Users/someone/Development/kit'
const FAILURE_EXIT_CODE = 1
const ISSUE_BRANCH = '962-report-the-token-and-credit-cost-of-a-run'
const MAIN = 'main'
const SESSION_A = 'session-a'
const SESSION_B = 'session-b'
const BAD_LINE = '{ not json'
const ISSUE_FLAG = '--issue'
const BAD_FLAG = '--nonsense'
const NO_TRANSCRIPTS = 'No transcripts found'
const ONE_REQUEST_FOR_962 = 'issue #962 — 1 request(s)'
const ISSUE_NUMBER = '962'
const MODEL = 'claude-opus-5'
const ALL_FLAG = '--all'
const RESIDENT_HEADING = 'Resident breakdown'
const COMPOSITION_HEADING = 'Context composition'
const THINKING_TOKENS = 7

function usage_line(request_id: string, branch: string, output_tokens: number): string {
	return JSON.stringify({
		type: 'assistant',
		requestId: request_id,
		gitBranch: branch,
		message: { model: MODEL, usage: { input_tokens: 1, output_tokens } },
	})
}

// A line carrying both a usage block and content, which is what the two decompositions read
// (joshuafolkken/kit#1151). `usage_line` deliberately carries no content, so the older suites keep
// exercising the usage reader on its own.
function content_line(command: string): string {
	return JSON.stringify({
		type: 'assistant',
		requestId: 'r2',
		gitBranch: ISSUE_BRANCH,
		message: {
			model: MODEL,
			usage: {
				input_tokens: 1,
				output_tokens: 5,
				output_tokens_details: { thinking_tokens: THINKING_TOKENS },
			},
			content: [{ type: 'tool_use', name: 'Bash', input: { command } }],
		},
	})
}

// Mutated properties rather than reassigned bindings, so `beforeEach` never assigns to a top-level
// variable from inside a function.
const state = { home: '', printed: [] as Array<string>, out: [] as Array<string> }

function capture(message: unknown): void {
	state.printed.push(String(message))
}

// stdout only. The `--over` verdict goes to stdout and its explanation to stderr, and the
// explanation contains the word "over" whatever the verdict is (`… per request over N request(s)`) —
// so a test reading both streams together passes on an inverted verdict.
function capture_out(message: unknown): void {
	state.out.push(String(message))
	state.printed.push(String(message))
}

beforeEach(() => {
	state.home = mkdtempSync(path.join(tmpdir(), 'cost-cli-'))
	state.printed = []
	state.out = []
	vi.spyOn(console, 'info').mockImplementation(capture_out)
	vi.spyOn(console, 'error').mockImplementation(capture)
	vi.spyOn(cost_transcript, 'transcript_directory').mockImplementation((cwd: string) =>
		path.join(state.home, cost_transcript.project_slug(cwd)),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function write_session(session_id: string, lines: ReadonlyArray<string>): void {
	const directory = path.join(state.home, cost_transcript.project_slug(CWD))

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, `${session_id}.jsonl`), lines.join('\n'))
}

function output(): string {
	return state.printed.join('\n')
}

function stdout(): string {
	return state.out.join('\n')
}

function write_populated(): void {
	write_session(SESSION_A, [usage_line('r1', MAIN, 10), content_line('git status --short')])
}

interface JsonReport {
	measurement?: { composition: { rows: Array<{ category: string; tokens: number }> } }
}

function thinking_row(json: string): { tokens: number } | undefined {
	const [report] = JSON.parse(json) as Array<JsonReport>

	return report?.measurement?.composition.rows.find((row) => row.category === 'thinking')
}

describe('josh cost registration', () => {
	it('is registered as a josh command', () => {
		const { cost } = COMMAND_MAP

		expect(cost?.script).toBe('scripts/cost/cost-cli.ts')
	})

	it('has a short alias', () => {
		const { co } = ALIASES

		expect(co).toBe('cost')
	})
})

describe('cost_cli.parse_options', () => {
	it('reads an issue number', () => {
		expect(cost_cli.parse_options([ISSUE_FLAG, ISSUE_NUMBER])?.issue).toBe(962)
	})

	it('refuses an issue that is not a number', () => {
		expect(cost_cli.parse_options([ISSUE_FLAG, 'abc'])).toBeUndefined()
	})

	it('refuses an unknown flag rather than ignoring it', () => {
		expect(cost_cli.parse_options([BAD_FLAG])).toBeUndefined()
	})

	it('defaults to the newest session with no flags', () => {
		expect(cost_cli.parse_options([])).toStrictEqual({ is_all: false, is_json: false })
	})
})

describe('cost_cli.run on one session', () => {
	it('reports the newest session by default', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run([], CWD)).toBe(0)
		expect(output()).toContain(`session ${SESSION_A}`)
	})

	// The failure this command exists to remove: reading nothing and reporting it as a free run.
	it('reports a missing transcript as an error, not as a zero-cost run', () => {
		expect(cost_cli.run([], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(NO_TRANSCRIPTS)
		expect(output()).not.toContain('$0.0000')
	})

	it('reports a named session that does not exist as missing', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--session', 'absent'], CWD)).toBe(FAILURE_EXIT_CODE)
	})

	it('prints the usage line for a bad invocation', () => {
		expect(cost_cli.run([BAD_FLAG], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(cost_cli.USAGE)
	})

	it('emits machine-readable output for --json', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--json'], CWD)).toBe(0)
		expect(JSON.parse(output())).toMatchObject([{ request_count: 1 }])
	})
})

describe('cost_cli.run across sessions', () => {
	it('rolls an issue up across every session that touched it', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10), usage_line('r2', ISSUE_BRANCH, 10)])
		write_session(SESSION_B, [usage_line('r3', ISSUE_BRANCH, 10)])

		expect(cost_cli.run([ISSUE_FLAG, ISSUE_NUMBER], CWD)).toBe(0)
		expect(output()).toContain('issue #962 — 3 request(s)')
	})

	it('lists every issue and a grand total under --all', () => {
		write_session(SESSION_A, [
			usage_line('r1', ISSUE_BRANCH, 10),
			usage_line('r2', '963-next-one', 10),
		])

		expect(cost_cli.run(['--all'], CWD)).toBe(0)
		expect(output()).toContain('issue #962')
		expect(output()).toContain('issue #963')
		expect(output()).toContain('Total across 2 scope(s)')
	})
})

// `--all` and `--issue` used to answer an absent transcript directory with an empty listing and a
// zero-cost issue — exit 0 either way, which is the silent zero this command exists to remove.
describe('cost_cli.run on an absent transcript directory', () => {
	it('exits non-zero for --all rather than printing nothing', () => {
		expect(cost_cli.run(['--all'], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(NO_TRANSCRIPTS)
	})

	it('exits non-zero for --issue rather than blaming attribution', () => {
		expect(cost_cli.run([ISSUE_FLAG, ISSUE_NUMBER], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).not.toContain('No requests are attributed')
	})

	it('names the session that was asked for when one was named', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--session', 'absent'], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain('No transcript named absent')
	})
})

// Resuming or forking a session copies the earlier lines into a new transcript file, so one billed
// request appears in several — 152 such request ids in this repository's own transcripts.
describe('cost_cli.run across sessions that share requests', () => {
	it('counts a request copied into a second transcript once', () => {
		write_session(SESSION_A, [usage_line('r1', ISSUE_BRANCH, 10)])
		write_session(SESSION_B, [usage_line('r1', ISSUE_BRANCH, 10)])

		expect(cost_cli.run([ISSUE_FLAG, ISSUE_NUMBER], CWD)).toBe(0)
		expect(output()).toContain(ONE_REQUEST_FOR_962)
	})

	it('keeps the attributed copy when the other copy has no branch to attribute it to', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])
		write_session(SESSION_B, [usage_line('r1', ISSUE_BRANCH, 10)])

		expect(cost_cli.run(['--all'], CWD)).toBe(0)
		expect(output()).toContain(ONE_REQUEST_FOR_962)
		expect(output()).not.toContain('unattributed')
	})
})

// A malformed line in an unrelated session is not missing data about the session being reported;
// summing the whole corpus into a single-session report blamed one run for another's defect.
describe('cost_cli.run missing-data scoping', () => {
	it("reports only the named session's own missing lines", () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])
		write_session(SESSION_B, [BAD_LINE, BAD_LINE])

		expect(cost_cli.run(['--session', SESSION_A], CWD)).toBe(0)
		expect(output()).not.toContain('Missing data')
	})

	// A line that could not be read carries no branch, so there is no way to rule out that it
	// belonged to the issue being rolled up.
	it('still reports the corpus-wide missing lines for an issue rollup', () => {
		write_session(SESSION_A, [usage_line('r1', ISSUE_BRANCH, 10)])
		write_session(SESSION_B, [BAD_LINE])

		expect(cost_cli.run([ISSUE_FLAG, ISSUE_NUMBER], CWD)).toBe(0)
		expect(output()).toContain('unparseable lines: 1')
	})
})

// joshuafolkken/kit#968: a session that runs several epic children pays for every earlier child on
// every later turn. Measured across one `epicrun` that ran six in one context: 222k billed input
// per request during the first child, 645k during the sixth — the same work at 2.9x the price. The
// hand-off is decided by that ratio, not by whether the run feels long.
describe('cost_cli.parse_options — the hand-off threshold', () => {
	it('reads a threshold', () => {
		expect(cost_cli.parse_options(['--over', '400000'])?.over).toBe(400_000)
	})

	it('refuses a threshold that is not a number', () => {
		expect(cost_cli.parse_options(['--over', 'lots'])).toBeUndefined()
	})

	// An unparsed flag must not read as an absent one, which would answer `under` to a caller that
	// asked for a limit and mistyped it.
	it('refuses rather than ignoring a mistyped threshold', () => {
		expect(cost_cli.parse_options(['--over', '-5'])).toBeUndefined()
	})
})

describe('cost_cli.run --over', () => {
	// The fixture request bills one input token, so zero is the only limit it exceeds. Chosen
	// deliberately: the first version of this test asserted against a limit the fixture did *not*
	// exceed and still passed, because it read stderr — where the word "over" always appears.
	it('answers over when the marginal cost exceeds the limit', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--over', '0'], CWD)).toBe(0)
		expect(stdout().trim()).toBe('over')
	})

	it('answers under when it does not', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--over', '99999999'], CWD)).toBe(0)
		expect(stdout().trim()).toBe('under')
	})

	it('says what the measured cost was, not only the verdict', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])
		cost_cli.run(['--over', '0'], CWD)

		expect(output()).toContain('per request')
	})

	// The word "under" appears in the missing-transcript message too, so the verdict is checked by
	// the exit code and the message, not by a substring that both share.
	it('reports a missing transcript rather than answering a verdict', () => {
		expect(cost_cli.run(['--over', '0'], CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(NO_TRANSCRIPTS)
	})
})

describe('cost_cli.per_request_cost', () => {
	it('divides the billed input by the requests that paid for it', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10), usage_line('r2', MAIN, 10)])
		const corpus = cost_cli.load_corpus(CWD)
		const reports = cost_cli.build_reports({ is_all: false, is_json: false }, corpus, CWD)
		const [report] = reports ?? []

		expect(report).toBeDefined()
		expect(cost_cli.per_request_cost(report as never)).toBeGreaterThan(0)
	})

	// Dividing by no requests would throw or answer Infinity; a session that has asked nothing has
	// nothing to hand off.
	it('answers zero for a session with no requests', () => {
		const empty = {
			scope: 'x',
			request_count: 0,
			breakdown: { billed_input_tokens: 0 },
		}

		expect(cost_cli.per_request_cost(empty as never)).toBe(0)
	})
})

// joshuafolkken/kit#1151. Both decompositions are read from one transcript's own lines, so they
// belong to the whole-session scope and to no other — an issue's slice and a `--all` corpus have no
// single session to read them from.
describe('cost_cli.run — the resident and context decompositions', () => {
	it('prints both on the session scope', () => {
		write_populated()

		expect(cost_cli.run([], CWD)).toBe(0)
		expect(output()).toContain(RESIDENT_HEADING)
		expect(output()).toContain(COMPOSITION_HEADING)
	})

	// The half another run consumes: joshuafolkken/kit#1159 has to read the Bash command-body share
	// from here rather than write its own script.
	it('carries them in --json under measurement', () => {
		write_populated()
		cost_cli.run(['--json'], CWD)

		const thinking = thinking_row(stdout())

		expect(thinking?.tokens).toBe(THINKING_TOKENS)
	})

	// A breakdown against a baseline of 0 is a table of estimates beside a measurement that was never
	// made — "this could not be read" dressed as a reading.
	it('omits them for a session with no readable request', () => {
		write_session(SESSION_A, [BAD_LINE])
		cost_cli.run(['--json'], CWD)

		expect(thinking_row(stdout())).toBeUndefined()
	})

	it.each([[ALL_FLAG], [ISSUE_FLAG]])('omits them from the %s scope', (flag) => {
		write_populated()

		const argv = flag === ALL_FLAG ? [ALL_FLAG] : [ISSUE_FLAG, ISSUE_NUMBER]

		expect(cost_cli.run(argv, CWD)).toBe(0)
		expect(output()).not.toContain(RESIDENT_HEADING)
		expect(output()).not.toContain(COMPOSITION_HEADING)
	})
})

describe('cost_cli.run --over — what it refuses', () => {
	// The verdict is about this session. Scoped to an issue it would answer for one slice, which is
	// a different number from the one the hand-off rule is written against.
	it.each([['--all'], [ISSUE_FLAG]])('refuses to combine the threshold with %s', (flag) => {
		const argv = flag === '--all' ? ['--over', '1', '--all'] : ['--over', '1', flag, ISSUE_NUMBER]

		expect(cost_cli.run(argv, CWD)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(cost_cli.USAGE)
	})

	it('refuses to combine the threshold with --json', () => {
		expect(cost_cli.run(['--over', '1', '--json'], CWD)).toBe(FAILURE_EXIT_CODE)
	})

	// A threshold of zero means "hand off after any request at all" — a limit, not a typo.
	it('accepts a threshold of zero', () => {
		expect(cost_cli.to_threshold('0')).toBe(0)
	})

	// `Number('')` is 0, and 0 is legitimate here — so an empty value would silently mean "hand off
	// after any request at all" and an unattended run would stop after its first child.
	it.each([[''], ['  ']])('refuses an empty threshold rather than reading it as zero', (raw) => {
		expect(cost_cli.to_threshold(raw)).toBeUndefined()
	})

	it('refuses a negative threshold', () => {
		expect(cost_cli.to_threshold('-1')).toBeUndefined()
	})
})
