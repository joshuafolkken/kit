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
} = session_language_cli

const DEFAULT_RESULT = { lang: DEFAULT_SESSION_LANG, is_default: true }
const ENGLISH_RESULT = { lang: 'en', is_default: false }
const ENGLISH_LINE = `Session language (${ENV_KEY}): en`
const GIT_DIRECTORY = '/repository/.git'
// Characters, a little above the line as written: it is injected on every prompt while a run is live.
const BOARD_LINE_LIMIT = 130

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
		expect(prompt_lines(ENGLISH_RESULT, true)).toStrictEqual([ENGLISH_LINE, BOARD_LINE])
	})

	it('names the command to answer a progress question with', () => {
		expect(BOARD_LINE).toContain('pnpm josh run:board --chat')
	})

	it('prints the language line alone when no backlogrun is live', () => {
		expect(prompt_lines(ENGLISH_RESULT, false)).toStrictEqual([ENGLISH_LINE])
	})

	it('prints nothing for the ja default when no backlogrun is live', () => {
		expect(prompt_lines(DEFAULT_RESULT, false)).toStrictEqual([])
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

		expect(prompt_lines(ENGLISH_RESULT, await is_run_live(ports))).toStrictEqual([ENGLISH_LINE])
	})
})
