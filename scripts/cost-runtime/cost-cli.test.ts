import { describe, expect, it, vi } from 'vitest'
import { codex_usage } from './codex-usage'
import { CONTEXT_CUT_THRESHOLD } from './context-cut-threshold'
import { cost_cli } from './cost-cli'
import { cost_cli_fixture } from './cost-cli-fixture'
import { cost_corpus } from './cost-corpus'

// The console capture, the temporary transcript home and the transcript writers are
// `cost-cli-fixture.ts`'s, shared with the `--path` suite (joshuafolkken/kit#1987).
const { CWD, MAIN, SESSION_A, usage_line, write_session, output, stdout } = cost_cli_fixture

cost_cli_fixture.capture_console()

const FAILURE_EXIT_CODE = 1
const ANTHROPIC_ENV = { JOSH_AGENT_PROVIDER: 'anthropic' }
const OPENAI_ENV = { CODEX_THREAD_ID: 'thread', JOSH_AGENT_PROVIDER: 'openai' }
const BAD_FLAG = '--nonsense'
const NO_TRANSCRIPTS = 'No transcripts found'
// The readerless report scopes retired in #2016: now unknown flags, so each is refused rather than
// silently parsed into a report that no longer exists.
const RETIRED_FLAGS: ReadonlyArray<ReadonlyArray<string>> = [
	['--session', 'x'],
	['--issue', '962'],
	['--all'],
	['--run'],
	['--json'],
	['--cap', '1'],
]

describe('cost_cli.parse_options', () => {
	it('reads a threshold', () => {
		expect(cost_cli.parse_options(['--over', '123456'])?.over).toBe(123_456)
	})

	it('reads the shared context-cut threshold', () => {
		expect(cost_cli.parse_options(['--cut'])?.over).toBe(CONTEXT_CUT_THRESHOLD)
	})

	it('refuses two threshold sources', () => {
		expect(cost_cli.parse_options(['--cut', '--over', '1'])).toBeUndefined()
	})

	it('reads a target path', () => {
		const target = '/Users/someone/Development/other-project'

		expect(cost_cli.parse_options(['--over', '1', '--path', target])?.path).toBe(target)
	})

	it('refuses a threshold that is not a number', () => {
		expect(cost_cli.parse_options(['--over', 'lots'])).toBeUndefined()
	})

	// An unparsed flag must not read as an absent one, which would answer `under` to a caller that
	// asked for a limit and mistyped it.
	it('refuses rather than ignoring a mistyped threshold', () => {
		expect(cost_cli.parse_options(['--over', '-5'])).toBeUndefined()
	})

	it('refuses an unknown flag rather than ignoring it', () => {
		expect(cost_cli.parse_options([BAD_FLAG])).toBeUndefined()
	})

	it.each(RETIRED_FLAGS)('refuses the retired report flag %s', (...argv) => {
		expect(cost_cli.parse_options(argv)).toBeUndefined()
	})

	it('reads no scope from an empty argv', () => {
		expect(cost_cli.parse_options([])).toStrictEqual({})
	})
})

describe('cost_cli.to_threshold', () => {
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

describe('cost_cli.run --over', () => {
	// The fixture request bills one input token, so zero is the only limit it exceeds. Chosen
	// deliberately: an earlier test asserted against a limit the fixture did *not* exceed and still
	// passed, because it read stderr — where the word "over" always appears.
	it('answers over when the marginal cost exceeds the limit', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--over', '0'], CWD, ANTHROPIC_ENV)).toBe(0)
		expect(stdout().trim()).toBe('over')
	})

	it('answers under when it does not', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run(['--over', '99999999'], CWD, ANTHROPIC_ENV)).toBe(0)
		expect(stdout().trim()).toBe('under')
	})

	it('says what the measured cost was, not only the verdict', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])
		cost_cli.run(['--over', '0'], CWD, ANTHROPIC_ENV)

		expect(output()).toContain('per request')
	})

	// The word "under" appears in the missing-transcript message too, so the verdict is checked by the
	// exit code and the message, not by a substring that both share.
	it('reports a missing transcript rather than answering a verdict', () => {
		expect(cost_cli.run(['--over', '0'], CWD, ANTHROPIC_ENV)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(NO_TRANSCRIPTS)
	})

	it('prints the usage line for a bad invocation', () => {
		expect(cost_cli.run([BAD_FLAG], CWD, ANTHROPIC_ENV)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(cost_cli.USAGE)
	})

	// With the report scopes gone, an invocation that names no threshold has nothing to do and prints
	// the usage rather than a report.
	it('prints the usage line when no threshold is given', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])

		expect(cost_cli.run([], CWD, ANTHROPIC_ENV)).toBe(FAILURE_EXIT_CODE)
		expect(output()).toContain(cost_cli.USAGE)
	})
})

describe('cost_cli.run --cut provider source', () => {
	it('uses Codex usage for OpenAI without reading Claude transcripts', () => {
		vi.spyOn(codex_usage, 'measurement').mockReturnValue({
			request_count: 1,
			billed_input_tokens: CONTEXT_CUT_THRESHOLD + 1,
		})
		const claude = vi.spyOn(cost_corpus, 'load_corpus')

		expect(cost_cli.run(['--cut'], CWD, OPENAI_ENV)).toBe(0)
		expect(stdout().trim()).toBe('over')
		expect(claude).not.toHaveBeenCalled()
	})

	it('keeps the Anthropic transcript path', () => {
		write_session(SESSION_A, [usage_line('r1', MAIN, 10)])
		const codex = vi.spyOn(codex_usage, 'measurement')

		expect(cost_cli.run(['--cut'], CWD, ANTHROPIC_ENV)).toBe(0)
		expect(codex).not.toHaveBeenCalled()
	})
})
