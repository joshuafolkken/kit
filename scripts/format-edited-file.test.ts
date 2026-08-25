import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolve_local_bin } from '#scripts/local-bin'
import { afterAll, describe, expect, it } from 'vitest'
import {
	format_edited_file,
	parse_edited_path,
	plan_commands,
	relative_to_root,
	resolve_invocation,
	type CommandRunner,
	type FormatCommand,
} from './format-edited-file'

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

function eslint_failing_runner(runs: Array<string>): CommandRunner {
	return async (command) => {
		await Promise.resolve()

		if (command.bin === ESLINT) throw new Error('spawn ENOENT')

		runs.push(command.bin)
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
	}
}

afterAll(() => {
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

describe('resolve_invocation', () => {
	const command = { bin: 'prettier', command_arguments: ['--write', 'app.ts'] }

	// Written under the name the resolver asks for rather than a literal: on Windows the shim carries
	// a `.cmd` suffix, and a fixture hard-coding the bare name would fail there for no real reason.
	it('spawns the local shim when the project has one', () => {
		const shim_name = path.basename(resolve_local_bin(TEST_DIRECTORY, command.bin))
		const shim = write_fixture('node_modules', '.bin', shim_name)

		expect(resolve_invocation(command, TEST_DIRECTORY).bin).toBe(shim)
	})

	// Output is ignored, so a missing shim would make the hook a silent no-op rather than a slow one.
	it('falls back to pnpm exec when the shim is missing', () => {
		const invocation = resolve_invocation(command, path.join(TEST_DIRECTORY, 'no-bins'))

		expect(invocation.bin).toBe('pnpm')
		expect(invocation.command_arguments).toStrictEqual(['exec', 'prettier', '--write', 'app.ts'])
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

	it('runs nothing when the payload carries no path', async () => {
		const runs: Array<string> = []

		await format_edited_file('{}', recording_runner(runs), TEST_DIRECTORY)

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
