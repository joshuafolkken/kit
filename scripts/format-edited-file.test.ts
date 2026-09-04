import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolve_local_bin } from '#scripts/local-bin'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
	density_envelope,
	ESLINT_DAEMON,
	format_edited_file,
	is_start_failure,
	parse_edited_path,
	plan_commands,
	plan_daemon_restart,
	relative_to_root,
	resolve_invocations,
	select_invocation,
	type CommandRunner,
	type FormatCommand,
} from './format-edited-file'
import { time_density_hook } from './time/time-density-hook'
import { time_transcript_fixture } from './time/time-transcript-fixture'

// Under the OS temp directory for the reason yaml-config-fixture.test.ts gives: several suites here
// assert on the repository's own file listing, so a fixture left at the package root would break
// them rather than merely leave litter. mkdtempSync rather than a fixed name so a watch-mode run
// and a lefthook-triggered run cannot delete each other's directory.
const TEST_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'format-edited-'))
const PRETTIER = 'prettier'
const ESLINT = 'eslint'

function write_fixture(...segments: ReadonlyArray<string>): string {
	const file_path = path.join(TEST_DIRECTORY, ...segments)

	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, '\n', 'utf8')

	return file_path
}

function plan_commands_in(file_path: string): ReadonlyArray<FormatCommand> {
	return plan_commands(file_path, TEST_DIRECTORY)
}

function payload_for(file_path: string): string {
	return JSON.stringify({
		hook_event_name: 'PostToolUse',
		tool_input: { file_path },
		tool_name: 'Edit',
	})
}

// What a formatter that ran and had nothing to say returns, so a test runner reads as "this route
// worked" and no fallback is attempted.
const RAN_CLEANLY = { exit_code: 0, did_write_stdout: false }

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

// The density hook's throttle records, which live in the shared temp directory rather than under
// `TEST_DIRECTORY` — so removing that directory does not take them with it.
const DENSITY_TRANSCRIPTS = new Set<string>()

afterAll(() => {
	for (const transcript of DENSITY_TRANSCRIPTS) {
		rmSync(time_density_hook.notice_path(transcript), { force: true })
	}

	rmSync(TEST_DIRECTORY, { recursive: true, force: true })
})

describe('parse_edited_path', () => {
	it('reads the path out of a PostToolUse payload', () => {
		const file_path = path.join(TEST_DIRECTORY, 'app.ts')

		expect(parse_edited_path(payload_for(file_path))).toBe(file_path)
	})

	// The hook cannot undo the edit that already happened, so an input it does not understand has to
	// leave without doing anything rather than throwing.
	it.each([
		['malformed JSON', '{ not json'],
		['an empty body', ''],
		['a payload with no tool input', '{"tool_name":"Bash"}'],
		['a payload with no path', '{"tool_input":{}}'],
		['an empty path', '{"tool_input":{"file_path":""}}'],
		['a path of the wrong type', '{"tool_input":{"file_path":42}}'],
	])('returns nothing for %s', (_label, raw_payload) => {
		expect(parse_edited_path(raw_payload)).toBeUndefined()
	})
})

describe('plan_commands', () => {
	// prettier last: eslint's `--fix` can leave whitespace that prettier then rejects, so the order
	// is what keeps the hook's own output passing `pnpm josh lint`.
	it('fixes a TypeScript file with eslint and formats it with prettier last', () => {
		const file_path = write_fixture('app.ts')
		const commands = plan_commands(file_path, TEST_DIRECTORY)

		expect(commands).toHaveLength(2)
		expect(commands[0]?.bin).toBe(ESLINT)
		expect(commands[1]?.bin).toBe(PRETTIER)
		expect(commands.every((command) => command.command_arguments.includes(file_path))).toBe(true)
	})

	it('formats a markdown file without running eslint on it', () => {
		const commands = plan_commands_in(write_fixture('notes.md'))

		expect(commands).toHaveLength(1)
		expect(commands[0]?.bin).toBe(PRETTIER)
	})

	it.each(['styles.css', 'data.json', 'config.yml', 'page.svelte'])('formats %s', (file_name) => {
		expect(plan_commands_in(write_fixture(file_name)).length).toBeGreaterThan(0)
	})

	it('plans nothing for an extension nothing here formats', () => {
		expect(plan_commands_in(write_fixture('logo.png'))).toStrictEqual([])
	})

	it('plans nothing for a path that no longer exists', () => {
		expect(plan_commands(path.join(TEST_DIRECTORY, 'deleted.ts'), TEST_DIRECTORY)).toStrictEqual([])
	})

	// A session can carry additional working directories, so an edit outside the project is a real
	// case — and this project's prettier and eslint config has no authority over that tree.
	it('plans nothing for a file outside the project root', () => {
		const outsider = write_fixture('outside.ts')

		expect(plan_commands(outsider, path.join(TEST_DIRECTORY, 'inner'))).toStrictEqual([])
	})
})

describe('plan_commands — excluded directories', () => {
	// The file is written first: with nothing there the existence check alone would answer, and the
	// exclusion could be deleted without this failing.
	it.each([
		['node_modules', 'pkg', 'index.ts'],
		['.git', 'hooks', 'index.ts'],
		['dist', 'index.ts'],
		['build', 'index.ts'],
		['src', 'node_modules', 'index.ts'],
	])('plans nothing under %s/%s', (...segments) => {
		expect(plan_commands(write_fixture(...segments), TEST_DIRECTORY)).toStrictEqual([])
	})

	// `dist` and `build` name build output at the top level only; nested they are ordinary source,
	// and excluding them by name would switch the hook off for a real part of the tree.
	it.each([
		['src', 'routes', 'build', 'page.ts'],
		['src', 'lib', 'dist', 'index.ts'],
	])('formats %s/%s/%s', (...segments) => {
		expect(plan_commands(write_fixture(...segments), TEST_DIRECTORY).length).toBeGreaterThan(0)
	})
})

describe('relative_to_root', () => {
	it.each([
		['a nested file', path.join(TEST_DIRECTORY, 'src', 'app.ts'), true],
		// A name that opens with two dots is a file in the root, not a step above it.
		['a file whose name starts with dots', path.join(TEST_DIRECTORY, '..config.ts'), true],
		['the root itself', TEST_DIRECTORY, false],
		['a sibling directory', path.join(TEST_DIRECTORY, '..', 'elsewhere', 'app.ts'), false],
		['an unrelated absolute path', path.join(path.sep, 'etc', 'hosts'), false],
	])('answers %s', (_label, candidate, is_expected_inside) => {
		const relative = relative_to_root(TEST_DIRECTORY, candidate)

		expect(relative !== undefined).toBe(is_expected_inside)
	})
})

// The startup route is where this hook's time went: one cold `eslint --fix` on a single TypeScript
// file measured 1.70s of a 2.50s hook, against 0.08s through the warm daemon. These assert the
// choice itself — which of the three routes is taken, and that the two slower ones still answer for
// a project that has no daemon installed (joshuafolkken/kit#1259).
describe('select_invocation — the startup route', () => {
	const eslint_command = { bin: ESLINT, command_arguments: ['--fix', 'app.ts'] }
	const daemon_cli = path.join(path.sep, 'pkg', 'eslint_d', 'bin', 'eslint_d.js')
	const shim = path.join(path.sep, 'repo', 'node_modules', '.bin', ESLINT)

	// Run with this process's own node rather than the CLI file directly: the daemon entry is a
	// plain `.js` with no execute bit of its own.
	it('runs the daemon CLI with the current node binary when one is installed', () => {
		expect(select_invocation(eslint_command, { daemon_cli, shim })).toStrictEqual({
			bin: process.execPath,
			command_arguments: [daemon_cli, '--fix', 'app.ts'],
		})
	})

	it('falls back to the local shim when no daemon is installed', () => {
		expect(select_invocation(eslint_command, { daemon_cli: undefined, shim })).toStrictEqual({
			bin: shim,
			command_arguments: ['--fix', 'app.ts'],
		})
	})

	it('falls back to pnpm exec when neither route resolves', () => {
		const routes = { daemon_cli: undefined, shim: undefined }

		expect(select_invocation(eslint_command, routes)).toStrictEqual({
			bin: 'pnpm',
			command_arguments: ['exec', ESLINT, '--fix', 'app.ts'],
		})
	})
})

// Resolving the daemon on disk is not the same as it starting: a blocked loopback bind or a store
// it cannot write into leaves it exiting non-zero with nothing on stdout. The slower route has to
// stay reachable, or the hook stops fixing anything with eslint wherever the daemon cannot run.
describe('resolve_invocations — the fallback behind the daemon', () => {
	const eslint_command = { bin: ESLINT, command_arguments: ['--fix', 'app.ts'] }

	it('offers the slower route behind the daemon one', () => {
		const invocations = resolve_invocations(eslint_command, TEST_DIRECTORY)

		expect(invocations.length).toBeGreaterThanOrEqual(1)
		expect(invocations.at(-1)?.bin).not.toBe(process.execPath)
	})

	it.each([
		['a formatter reporting problems it could not fix', { exit_code: 1, did_write_stdout: true }],
		['a formatter that had nothing to say', { exit_code: 0, did_write_stdout: false }],
	])('does not read %s as a start failure', (_label, outcome) => {
		expect(is_start_failure(outcome)).toBe(false)
	})

	it('reads a non-zero exit with no output as a start failure', () => {
		expect(is_start_failure({ exit_code: 1, did_write_stdout: false })).toBe(true)
	})
})

describe('resolve_invocations', () => {
	const command = { bin: PRETTIER, command_arguments: ['--write', 'app.ts'] }

	// prettier costs a fraction of what eslint does, so it has no daemon route to take — a second
	// warm process would buy little and double what can go stale.
	it('never takes the daemon route for prettier', () => {
		const invocations = resolve_invocations(command, path.join(TEST_DIRECTORY, 'no-bins'))

		expect(invocations).toHaveLength(1)
		expect(invocations[0]?.bin).not.toBe(process.execPath)
	})

	// Written under the name the resolver asks for rather than a literal: on Windows the shim carries
	// a `.cmd` suffix, and a fixture hard-coding the bare name would fail there for no real reason.
	it('spawns the local shim when the project has one', () => {
		const shim_name = path.basename(resolve_local_bin(TEST_DIRECTORY, command.bin))
		const shim = write_fixture('node_modules', '.bin', shim_name)

		expect(resolve_invocations(command, TEST_DIRECTORY)[0]?.bin).toBe(shim)
	})

	// Output is ignored, so a missing shim would make the hook a silent no-op rather than a slow one.
	it('falls back to pnpm exec when the shim is missing', () => {
		const [invocation] = resolve_invocations(command, path.join(TEST_DIRECTORY, 'no-bins'))

		expect(invocation?.bin).toBe('pnpm')
		expect(invocation?.command_arguments).toStrictEqual(['exec', PRETTIER, '--write', 'app.ts'])
	})
})

// ESLint cache-busts the config entry file alone; the rule modules it imports stay in the daemon's
// module registry, so an edit to one of them would be linted against for as long as the daemon lives.
describe('plan_daemon_restart', () => {
	const CONFIG_ENTRY = 'eslint.config.js'

	it.each([
		['a rule module the config imports', ['eslint', 'rules', 'naming.js']],
		['the flat config entry itself', [CONFIG_ENTRY]],
	])('restarts the daemon after an edit to %s', (_label, segments) => {
		const plan = plan_daemon_restart(path.join(TEST_DIRECTORY, ...segments), TEST_DIRECTORY)

		expect(plan).toStrictEqual([{ bin: ESLINT_DAEMON, command_arguments: ['restart'] }])
	})

	it.each([
		['an ordinary source file', ['src', 'app.ts']],
		['a file whose name merely starts the same way', ['eslint.config.backup.js']],
		// A session can carry additional working directories, and another checkout's config belongs
		// to that tree's daemon rather than this one's.
		['a config in another checkout', ['..', 'elsewhere', CONFIG_ENTRY]],
	])('leaves the daemon alone after an edit to %s', (_label, segments) => {
		expect(
			plan_daemon_restart(path.join(TEST_DIRECTORY, ...segments), TEST_DIRECTORY),
		).toStrictEqual([])
	})
})

describe('format_edited_file', () => {
	it('runs the planned commands for an edited file', async () => {
		const runs: Array<string> = []

		await format_edited_file(
			payload_for(write_fixture('run.ts')),
			recording_runner(runs),
			TEST_DIRECTORY,
		)

		expect(runs).toStrictEqual([ESLINT, PRETTIER])
	})

	// The second row is the one the widened matcher added (joshuafolkken/kit#1337): this hook now runs
	// after every shell call too, and a shell payload names a command rather than a file. Formatting
	// has nothing to do there, and doing it anyway would mean guessing which path a `sed` line
	// rewrote.
	it.each([
		['the payload carries no path', '{}'],
		['the payload is a shell call', shell_payload()],
	])('runs nothing when %s', async (_label, raw_payload) => {
		const runs: Array<string> = []

		await format_edited_file(raw_payload, recording_runner(runs), TEST_DIRECTORY)

		expect(runs).toStrictEqual([])
	})

	// prettier is the one whose output `pnpm josh lint` checks, so an eslint that cannot start must
	// not take it down with it.
	it('still runs prettier when eslint fails to start', async () => {
		const runs: Array<string> = []
		const payload = payload_for(write_fixture('partial.ts'))

		await format_edited_file(payload, eslint_failing_runner(runs), TEST_DIRECTORY)

		expect(runs).toStrictEqual([PRETTIER])
	})

	// A formatter that cannot parse the file — an edit left mid-syntax — must not surface as a failed
	// hook on a turn whose write already succeeded.
	it('returns quietly when a formatter throws', async () => {
		const file_path = write_fixture('broken.ts')

		await expect(
			format_edited_file(payload_for(file_path), failing_runner, TEST_DIRECTORY),
		).resolves.toBeUndefined()
	})
})

// The live round-trip density line rides this hook rather than one of its own
// (joshuafolkken/kit#1329). A `PostToolUse` hook's plain stdout never reaches the model, so the line
// has to leave through the documented envelope — and an ordinary edit must still write nothing.
describe('density_envelope', () => {
	const ONE_CALL = 1
	// Parsed rather than string-matched, and through a schema rather than a type assertion: what the
	// harness reads is JSON, so a test that only found the words in the text would pass on output the
	// harness could not parse at all.
	const envelope_schema = z.object({
		hookSpecificOutput: z.object({
			hookEventName: z.string(),
			additionalContext: z.string(),
		}),
	})

	// The throttle record is keyed on the transcript and lands outside `TEST_DIRECTORY`, so it is
	// removed by name here rather than left to the suite's own teardown.
	function transcript_for(name: string): string {
		const target = path.join(TEST_DIRECTORY, `${name}.jsonl`)
		const turns = time_transcript_fixture.DENSITY_TURNS

		writeFileSync(target, time_transcript_fixture.density_text(turns, ONE_CALL), 'utf8')
		DENSITY_TRANSCRIPTS.add(target)

		return target
	}

	it('wraps the line in the PostToolUse envelope the harness reads', () => {
		const payload = JSON.stringify({ transcript_path: transcript_for('density') })
		const written = density_envelope(payload)

		expect(written).toBeDefined()

		const envelope = envelope_schema.parse(JSON.parse(written ?? ''))

		expect(envelope.hookSpecificOutput.hookEventName).toBe('PostToolUse')
		expect(envelope.hookSpecificOutput.additionalContext).toContain('calls per round trip')
	})

	it('writes nothing for the edit payload that carries no transcript', () => {
		const payload = payload_for(write_fixture('plain.ts'))

		expect(density_envelope(payload)).toBeUndefined()
	})

	// The reach joshuafolkken/kit#1337 bought: 7 of the 10 most recent sessions in this checkout never
	// called `Edit` or `Write` once, so widening the matcher to `Bash` is what puts the line in front
	// of them. It works only because the reading takes `transcript_path` and never the edited path —
	// which is a claim about this file, and so is asserted here rather than left to be inferred.
	it('writes the line for a shell payload naming no edited file', () => {
		const payload = shell_payload(transcript_for('shell-density'))

		expect(density_envelope(payload)).toBeDefined()
	})
})
