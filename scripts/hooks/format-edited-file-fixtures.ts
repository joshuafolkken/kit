import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { plan_commands, type CommandRunner, type FormatCommand } from './format-edited-file'

// Shared across the two `format-edited-file` suites so neither redefines the other's fixtures. The
// per-suite temp directory stays in each test file — vitest isolates the files, so each evaluates
// this module and its own `afterAll` teardown of its own `mkdtemp`.
const PRETTIER = 'prettier'
const ESLINT = 'eslint'

// What a formatter that ran and had nothing to say returns, so a test runner reads as "this route
// worked" and no fallback is attempted.
const RAN_CLEANLY = { exit_code: 0, stdout: '' }

function payload_for(file_path: string): string {
	return JSON.stringify({
		hook_event_name: 'PostToolUse',
		tool_input: { file_path },
		tool_name: 'Edit',
	})
}

// What Claude Code hands this hook after a shell call, which the matcher covers since
// joshuafolkken/kit#1337: a command, and no edited path anywhere in the payload. The command edits a
// file on purpose — an agent working through `sed` is the mode the widening was measured against,
// and nothing here may start formatting a path it had to guess at.
function shell_payload(transcript_path?: string): string {
	return JSON.stringify({
		tool_name: 'Bash',
		tool_input: { command: `sed -i '' s/a/b/ app.ts` },
		transcript_path,
	})
}

function eslint_failing_runner(runs: Array<string>): CommandRunner {
	return async (command) => {
		await Promise.resolve()

		if (command.bin === ESLINT) throw new Error('spawn ENOENT')

		runs.push(command.bin)

		return RAN_CLEANLY
	}
}

const failing_runner: CommandRunner = async () => {
	await Promise.resolve()
	throw new Error('the formatter failed to start')
}

function recording_runner(runs: Array<string>): CommandRunner {
	return async (command) => {
		runs.push(command.bin)

		await Promise.resolve()

		return RAN_CLEANLY
	}
}

// eslint exits non-zero with its problems on stdout when a `--fix` pass leaves something it could
// not fix; prettier runs cleanly. This is the shape the hook has to lift the diagnostics out of.
function eslint_reporting_runner(stdout: string): CommandRunner {
	return async (command) => {
		await Promise.resolve()

		if (command.bin === ESLINT) return { exit_code: 1, stdout }

		return RAN_CLEANLY
	}
}

interface DirectoryHelpers {
	write_fixture: (...segments: ReadonlyArray<string>) => string
	plan_commands_in: (file_path: string) => ReadonlyArray<FormatCommand>
}

// Bound to a suite's own temp directory so the call sites stay `write_fixture('app.ts')`. The nested
// functions close over `directory`, so they cannot be hoisted to module scope.
function make_directory_helpers(directory: string): DirectoryHelpers {
	function write_fixture(...segments: ReadonlyArray<string>): string {
		const file_path = path.join(directory, ...segments)

		mkdirSync(path.dirname(file_path), { recursive: true })
		writeFileSync(file_path, '\n', 'utf8')

		return file_path
	}

	function plan_commands_in(file_path: string): ReadonlyArray<FormatCommand> {
		return plan_commands(file_path, directory)
	}

	return { write_fixture, plan_commands_in }
}

export {
	eslint_failing_runner,
	eslint_reporting_runner,
	failing_runner,
	make_directory_helpers,
	payload_for,
	recording_runner,
	shell_payload,
	ESLINT,
	PRETTIER,
	RAN_CLEANLY,
}
