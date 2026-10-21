import { describe, expect, it, vi } from 'vitest'
import { main_entry_fixture } from './main-entry-fixture'

const { run, load_environment_file } = vi.hoisted(() => ({
	run: vi.fn(),
	load_environment_file: vi.fn(),
}))

vi.mock('./session-language-cli', () => ({ session_language_cli: { print_prompt_lines: run } }))
vi.mock('./josh-environment-file', () => ({ josh_environment_file: { load_environment_file } }))

const ENTRY = 'scripts/josh/session-language-main.ts'

const CASES = main_entry_fixture.entry_cases({
	command: 'session:lang',
	entry: ENTRY,
	library: 'scripts/josh/session-language-cli.ts',
	run,
	called_with: [],
	has_own_exit_code: true,
})

describe('session-language-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})

	it('reads .env before it prints the prompt lines', async () => {
		const calls: Array<string> = []

		load_environment_file.mockReset().mockImplementation(() => {
			calls.push('load')
		})
		run.mockReset().mockImplementation(() => {
			calls.push('print')
		})

		await main_entry_fixture.run_entry(ENTRY, [])

		expect(calls).toStrictEqual(['load', 'print'])
	})
})
