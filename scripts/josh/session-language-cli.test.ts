import { agent_session_role } from '#scripts/agent/agent-session-role'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { session_language_cli, type LivePorts } from './session-language-cli'

const {
	ENV_KEY,
	DEFAULT_SESSION_LANG,
	BOARD_LINE,
	resolve_session_lang,
	format_line,
	is_run_live,
	prompt_lines,
	print_prompt_lines,
} = session_language_cli

const DEFAULT_RESULT = { lang: DEFAULT_SESSION_LANG, is_default: true }
const ENGLISH_RESULT = { lang: 'en', is_default: false }
const ENGLISH_LINE = `Session language (${ENV_KEY}): en`
const SCOPE_LINE = agent_session_role.scope_line()
const GIT_DIRECTORY = '/repository/.git'
// Budget for the progress format and investigation scope, injected only while a run is live.
const BOARD_LINE_LIMIT = 300

function ports_of(
	git_directory: string | undefined,
	is_running: (git_directory: string) => boolean,
): LivePorts {
	return { repository_directory: async () => git_directory, is_running }
}

function set_environment(value: string | undefined): void {
	if (value === undefined) Reflect.deleteProperty(process.env, ENV_KEY)
	else process.env[ENV_KEY] = value
}

describe('resolve_session_lang', () => {
	let original: string | undefined

	beforeEach(() => {
		original = process.env[ENV_KEY]
	})

	afterEach(() => {
		set_environment(original)
	})

	// A set value is returned verbatim; because node's `.env` loader defers to the process
	// environment, a value present here is also the one that wins over any file value.
	it('returns the configured value, which wins over any .env file value', () => {
		set_environment('en')

		expect(resolve_session_lang()).toStrictEqual({ lang: 'en', is_default: false })
	})

	// Unset (no `.env` value), empty and whitespace-only all resolve to the ja default.
	it.each([undefined, '', ' '.repeat(3)])('falls back to ja when the variable is %o', (value) => {
		set_environment(value)

		expect(resolve_session_lang()).toStrictEqual(DEFAULT_RESULT)
	})
})

describe('format_line', () => {
	it('states only the language, with no default marker, when set', () => {
		expect(format_line({ lang: 'en', is_default: false })).toBe(`Session language (${ENV_KEY}): en`)
	})

	// The resident `CLAUDE.md` line already names the default, so the hook adds nothing per prompt.
	it('prints nothing for the ja default', () => {
		expect(format_line({ lang: DEFAULT_SESSION_LANG, is_default: true })).toBe('')
	})
})

// joshuafolkken/kit#3636: the board rule lived only in a document an implementing run reads, so a
// session asked about a run it was not driving never saw it.
describe('prompt_lines', () => {
	it('adds the run:board line while a backlogrun is live', () => {
		expect(prompt_lines(ENGLISH_RESULT, true)).toStrictEqual([SCOPE_LINE, ENGLISH_LINE, BOARD_LINE])
	})

	it('names the command to answer a progress question with', () => {
		expect(BOARD_LINE).toContain('run `pnpm josh run:board --chat`; relay output')
	})

	it('prints the scope and language when no backlogrun is live', () => {
		expect(prompt_lines(ENGLISH_RESULT, false)).toStrictEqual([SCOPE_LINE, ENGLISH_LINE])
	})

	it('still prints the session scope for the ja default', () => {
		expect(prompt_lines(DEFAULT_RESULT, false)).toStrictEqual([SCOPE_LINE])
	})

	it('appends the run:handoff line when the payload asked for one', () => {
		expect(prompt_lines(DEFAULT_RESULT, false, 'handoff')).toStrictEqual([SCOPE_LINE, 'handoff'])
	})

	it('prints the run:handoff line the hook payload asks for', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const payload = '{"prompt":"fullrun #1","model":"claude-fable-5-1"}'

		await print_prompt_lines(async () => payload)

		expect(info.mock.calls.flat().join('\n')).toContain('pnpm josh run:handoff fullrun')
		info.mockRestore()
	})
})

describe('lane child prompt guidance', () => {
	it.each(['claude-fable-5-1', 'gpt-6.1-astra'])(
		'omits consultation handoff guidance for a lane child on %s',
		async (model) => {
			const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
			const child = vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)

			try {
				await print_prompt_lines(async () => JSON.stringify({ prompt: 'fullrun #1', model }))

				expect(info.mock.calls.flat().join('\n')).not.toContain('Consultation model:')
			} finally {
				child.mockRestore()
				info.mockRestore()
			}
		},
	)
})

// Wording contracts only; actual model responses are checked separately.
describe('board line bound', () => {
	it('limits board-only replies to progress-only questions', () => {
		expect(BOARD_LINE).toContain('for progress-only questions')
		expect(BOARD_LINE).toContain('verbatim in one code block')
	})

	it('requires evidence for cause and improvement questions, including quoted board lines', () => {
		expect(BOARD_LINE).toContain(
			'For cause or improvement questions, investigate state, logs and code',
		)
		expect(BOARD_LINE).toContain('cite evidence and uncertainty, even with quoted board lines')
	})

	it('requires progress and explanation for mixed questions', () => {
		expect(BOARD_LINE).toContain('For mixed questions, do both')
	})

	it('keeps the board line within its bound', () => {
		expect(BOARD_LINE.length).toBeLessThanOrEqual(BOARD_LINE_LIMIT)
	})
})

describe('is_run_live', () => {
	it('asks the existing liveness check about the common git directory', async () => {
		const is_running = vi.fn<(git_directory: string) => boolean>(() => true)

		expect(await is_run_live(ports_of(GIT_DIRECTORY, is_running))).toBe(true)
		expect(is_running).toHaveBeenCalledExactlyOnceWith(GIT_DIRECTORY)
	})

	it('answers false when no run is recorded', async () => {
		expect(await is_run_live(ports_of(GIT_DIRECTORY, () => false))).toBe(false)
	})

	it('answers false outside a git repository', async () => {
		expect(await is_run_live(ports_of(undefined, () => true))).toBe(false)
	})

	// A hook that throws would cost the prompt its language line too.
	it('answers false when the check throws, so the language line still prints', async () => {
		const ports = ports_of(GIT_DIRECTORY, () => {
			throw new Error('unreadable stamp')
		})

		expect(prompt_lines(ENGLISH_RESULT, await is_run_live(ports))).toStrictEqual([
			SCOPE_LINE,
			ENGLISH_LINE,
		])
	})
})
