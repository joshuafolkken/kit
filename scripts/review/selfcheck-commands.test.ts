import path from 'node:path'
import type { Hunk } from '#scripts/test/test-pinned-logic'
import { describe, expect, it } from 'vitest'
import { selfcheck_commands, type ProbeResult, type Runner } from './selfcheck-commands'

const ROOT = '/lane/root'
const TREE = '/scratch/josh-selfcheck-x/tree'
const ROOT_PROBE = 'root'
const SUBDIRECTORY_PROBE = 'subdirectory cwd'
const DOC_PATH = 'prompts/review.md'
const SECTION_COMMAND = `doc:section ${DOC_PATH} "Before round 1"`
const OK: ProbeResult = { exit_code: 0, output: 'ok' }

function hunk(new_lines: Array<string>, old_lines: Array<string> = []): Hunk {
	return { file: 'docs/a.md', new_start: 1, new_count: new_lines.length, old_lines, new_lines }
}

interface Call {
	args: ReadonlyArray<string>
	cwd: string
}

function runner(answer: (args: ReadonlyArray<string>, cwd: string) => ProbeResult = () => OK): {
	runner: Runner
	calls: Array<Call>
} {
	const calls: Array<Call> = []

	return {
		calls,
		runner: {
			tree: TREE,
			is_path: (argument) => argument === DOC_PATH || argument.endsWith(DOC_PATH),
			exec: async (args, cwd) => {
				calls.push({ args, cwd })

				return answer(args, cwd)
			},
		},
	}
}

describe('selfcheck_commands.extract', () => {
	it('takes each backticked pnpm josh command an added line writes, once', () => {
		const added = hunk([
			`Run \`pnpm josh ${SECTION_COMMAND}\`.`,
			`again \`pnpm josh ${SECTION_COMMAND}\``,
		])

		expect(selfcheck_commands.extract([added])).toEqual([SECTION_COMMAND])
	})

	it.each([
		['a placeholder', '`pnpm josh run:step <N>`'],
		['an optional flag', '`pnpm josh help [command]`'],
		['an ellipsis', '`pnpm josh plan:consumers …`'],
		['a template expression', '`pnpm josh ship ${title}`'],
	])('skips %s the reader fills in', (_name, line) => {
		expect(selfcheck_commands.extract([hunk([line])])).toEqual([])
	})

	it('reads no removed line', () => {
		expect(selfcheck_commands.extract([hunk([], ['`pnpm josh prose:stale`'])])).toEqual([])
	})

	it('reads no test file, whose command is a fixture string', () => {
		const fixture = { ...hunk(['`pnpm josh a:b`']), file: 'scripts/a.test.ts' }

		expect(selfcheck_commands.extract([fixture])).toEqual([])
	})
})

describe('selfcheck_commands.tokenize', () => {
	it('keeps a quoted argument whole, without its quotes', () => {
		expect(selfcheck_commands.tokenize(SECTION_COMMAND)).toEqual([
			'doc:section',
			DOC_PATH,
			'Before round 1',
		])
	})
})

describe('selfcheck_commands.probes', () => {
	it('runs a command with a path from the root, a subdirectory, absolute and empty', () => {
		const tokens = selfcheck_commands.tokenize(SECTION_COMMAND)
		const found = selfcheck_commands.probes(tokens, runner().runner)
		const scripts = path.join(TREE, 'scripts')

		expect(found.map((probe) => [probe.label, probe.cwd, probe.args[1]])).toEqual([
			[ROOT_PROBE, TREE, DOC_PATH],
			[SUBDIRECTORY_PROBE, scripts, DOC_PATH],
			['absolute path', scripts, path.join(TREE, DOC_PATH)],
			['empty input', TREE, ''],
		])
	})

	it('gives a command with no argument only the two cwd probes', () => {
		const found = selfcheck_commands.probes(['prose:stale'], runner().runner)

		expect(found.map((probe) => probe.label)).toEqual([ROOT_PROBE, SUBDIRECTORY_PROBE])
	})
})

describe('selfcheck_commands.run', () => {
	it('runs every probe inside the scratch tree, never in the lane root', async () => {
		const { runner: fake, calls } = runner()

		await selfcheck_commands.run([SECTION_COMMAND], fake)

		expect(calls).toHaveLength(4)
		expect(calls.every((call) => call.cwd.startsWith(TREE) && !call.cwd.startsWith(ROOT))).toBe(
			true,
		)
	})

	it('lists a non-zero exit, a signal and a stack trace, and passes a clean empty-input refusal', async () => {
		const { runner: fake } = runner((args, cwd) => {
			if (args[1] === '') return { exit_code: 2, output: 'usage: josh doc:section' }
			if (args[1]?.startsWith('/') === true) return { exit_code: 1, output: 'no such file' }
			if (cwd !== TREE) return { exit_code: undefined, output: '' }

			return { exit_code: 0, output: 'Error\n    at main (a.ts:1:2)' }
		})
		const { lines, failed } = await selfcheck_commands.run([SECTION_COMMAND], fake)

		expect(failed).toBe(3)
		expect(lines[0]).toBe(`fail root: pnpm josh ${SECTION_COMMAND} → exit 0 — at main (a.ts:1:2)`)
		expect(lines.some((line) => line.startsWith('fail empty input'))).toBe(false)
	})

	it('skips a command whose side effects leave the tree, and fails an unknown one', async () => {
		const { runner: fake, calls } = runner()
		const { lines, failed } = await selfcheck_commands.run(
			['review:round2', 'no:such-command'],
			fake,
		)

		expect(calls).toEqual([])
		expect(lines).toEqual([
			'skipped: pnpm josh review:round2 (network)',
			'fail: pnpm josh no:such-command → unknown command',
		])
		expect(failed).toBe(1)
	})
})
