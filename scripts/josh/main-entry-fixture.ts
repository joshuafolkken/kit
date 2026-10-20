import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, vi, type Mock } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { josh_in_process } from './josh-in-process'

// The shared cases for a `*-main.ts` entry split out of a module other modules import
// (joshuafolkken/kit#4186). Each entry's own test mocks the module it calls and hands the mock here,
// so the three facts are stated once: the command runs the entry, the imported module carries no
// main guard of its own, and the entry passes the command's arguments through and answers its code.
const MAIN_GUARD = 'process.argv[1]'
const ARGUMENTS: ReadonlyArray<string> = ['12', '--json']
const EXIT_CODE = 3
const ORIGINAL_ARGV = process.argv
const ORIGINAL_EXIT_CODE = process.exitCode

interface EntryCase {
	command: string
	entry: string
	library: string
	run: Mock
	// What `run` receives, when the entry hands it something other than the whole argument list.
	called_with?: ReadonlyArray<unknown>
}

type NamedCase = readonly [string, () => Promise<void> | void]

// Through the dispatcher's own in-process import, so the guard is exercised as `josh` runs it. The
// module cache is reset first: an entry evaluates once per import, and a case reruns it.
async function run_entry(entry: string, argv: ReadonlyArray<string>): Promise<number> {
	vi.resetModules()

	try {
		return await josh_in_process.run_in_process(path.resolve(entry), argv)
	} finally {
		process.argv = ORIGINAL_ARGV
		process.exitCode = ORIGINAL_EXIT_CODE
	}
}

async function expect_pass_through(entry_case: EntryCase): Promise<void> {
	const { entry, run, called_with = [ARGUMENTS] } = entry_case

	run.mockReset()
	// A plain value rather than a resolved one: an async entry awaits it the same, and a sync `run`
	// (`backlog:budget`) assigns it to `process.exitCode` as it is.
	run.mockReturnValue(EXIT_CODE)

	expect(await run_entry(entry, ARGUMENTS)).toBe(EXIT_CODE)
	expect(run).toHaveBeenCalledWith(...called_with)
}

// Named cases for the caller's `it.each`, so each entry's suite runs and is named in its own file.
function entry_cases(entry_case: EntryCase): ReadonlyArray<NamedCase> {
	const { command, entry, library } = entry_case

	return [
		[
			`is the script josh ${command} runs`,
			() => {
				expect(COMMAND_MAP[command]?.script).toBe(entry)
			},
		],
		[
			'leaves the module other files import without a main guard',
			() => {
				expect(readFileSync(library, 'utf8')).not.toContain(MAIN_GUARD)
			},
		],
		[
			'passes the command arguments through and answers their exit code',
			async () => {
				await expect_pass_through(entry_case)
			},
		],
	]
}

const main_entry_fixture = { ARGUMENTS, entry_cases, run_entry }

export { main_entry_fixture }
