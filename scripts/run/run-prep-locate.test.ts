import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_mock = vi.hoisted(() => vi.fn<(argv: ReadonlyArray<string>) => Promise<string>>())

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: read_mock } }))

const { run_prep_locate } = await import('./run-prep-locate')

const MAX_TARGETS = 10
const MAX_FILES = 3
const MAX_EXCERPT = 80
const LONG_TEXT_LENGTH = 200
const GIT_USAGE_EXIT = 129
const LS_FILES = 'ls-files'
const PREP_PATH = 'scripts/run/run-prep.ts'
const RUN_PREP_SPAN = '`run:prep`'
const GREP_OUTPUT = [
	'scripts/josh/josh-commands-ai.ts:42:\t\'run:prep\': { script: "a:b:c" },',
	'scripts/run/run-entry-cli.ts:85:\tconst reads = await run_prep_cli.gather(issue_number)',
].join('\n')

// `ls-files` answers with the tracked files the target names; every other call is the grep.
function mock_git(grep: () => Promise<string>, files = ''): void {
	read_mock.mockImplementation(async (argv: ReadonlyArray<string>) =>
		argv[0] === LS_FILES ? files : await grep(),
	)
}

function grep_calls(): Array<[ReadonlyArray<string>]> {
	return read_mock.mock.calls.filter((call) => call[0][0] === 'grep')
}

beforeEach(() => {
	read_mock.mockReset()
})

describe('run_prep_locate.extract_targets', () => {
	it('keeps backticked paths, identifiers and commands', () => {
		const body = 'See `scripts/run/run-prep.ts`, `run_prep_cli` and `investigation:guard`.'

		expect(run_prep_locate.extract_targets(body)).toStrictEqual([
			PREP_PATH,
			'run_prep_cli',
			'investigation:guard',
		])
	})

	it('reads the subcommand out of a josh command line', () => {
		expect(
			run_prep_locate.extract_targets('run `pnpm josh run:prep 12` then `josh gate`'),
		).toStrictEqual(['run:prep'])
	})

	it('drops the line suffix off a file:line citation so the file itself is looked up', () => {
		expect(run_prep_locate.extract_targets(`see \`${PREP_PATH}:78\``)).toStrictEqual([PREP_PATH])
	})

	it('drops prose words, spaced spans, URLs and short tokens', () => {
		const body = '`Read` `jq -s .` `https://x.dev/a` `a:` `#2761` and plain run:prep'

		expect(run_prep_locate.extract_targets(body)).toStrictEqual([])
	})

	it('lists a repeated name once and caps the count', () => {
		const names = Array.from({ length: MAX_TARGETS + 2 }, (_, index) => `\`name_${String(index)}\``)

		const targets = run_prep_locate.extract_targets(`\`name_0\` ${names.join(' ')}`)

		expect(targets).toHaveLength(MAX_TARGETS)
		expect(new Set(targets).size).toBe(MAX_TARGETS)
	})
})

describe('run_prep_locate.parse_hits', () => {
	it('splits path and line off the first two colons only', () => {
		const [hit] = run_prep_locate.parse_hits(GREP_OUTPUT)

		expect(hit).toStrictEqual({
			path: 'scripts/josh/josh-commands-ai.ts',
			line: '42',
			excerpt: '\'run:prep\': { script: "a:b:c" },',
		})
	})

	it('shortens a long excerpt and caps the files per name', () => {
		const long_line = `a.ts:1:${'x'.repeat(LONG_TEXT_LENGTH)}`
		const output = Array.from({ length: MAX_FILES + 1 }, () => long_line).join('\n')

		const hits = run_prep_locate.parse_hits(output)

		expect(hits).toHaveLength(MAX_FILES)
		expect(hits[0]?.excerpt).toBe(`${'x'.repeat(MAX_EXCERPT)}…`)
	})
})

describe('run_prep_locate.locate', () => {
	it('prints file:line and an excerpt under each name', async () => {
		mock_git(async () => GREP_OUTPUT)

		const report = await run_prep_locate.locate('touch `run:prep`')

		expect(report).toBe(
			[
				'run:prep',
				'  scripts/josh/josh-commands-ai.ts:42  \'run:prep\': { script: "a:b:c" },',
				'  scripts/run/run-entry-cli.ts:85  const reads = await run_prep_cli.gather(issue_number)',
			].join('\n'),
		)
		expect(grep_calls()[0]).toStrictEqual([expect.arrayContaining(['run:prep'])])
	})

	it('reports a name git grep does not find instead of failing', async () => {
		mock_git(async () => {
			throw Object.assign(new Error('exit code 1'), { exitCode: 1 })
		})

		expect(await run_prep_locate.locate('`missing_name`')).toBe('missing_name — no match in code')
	})

	it('reports a search that could not run apart from a name that is absent', async () => {
		mock_git(async () => {
			throw Object.assign(new Error('unknown switch'), { exitCode: GIT_USAGE_EXIT })
		})

		expect(await run_prep_locate.locate(RUN_PREP_SPAN)).toBe(
			'run:prep — git grep failed; not searched',
		)
	})

	it('says so when the body names nothing', async () => {
		expect(await run_prep_locate.locate('no names here')).toContain('no backticked')
		expect(read_mock).not.toHaveBeenCalled()
	})
})

describe('run_prep_locate.locate on a named file', () => {
	it('points a named file path at the tracked file instead of grepping its text', async () => {
		mock_git(async () => '', `${PREP_PATH}\n`)

		expect(await run_prep_locate.locate(`edit \`${PREP_PATH}\``)).toBe(
			[PREP_PATH, `  ${PREP_PATH}:1  (file named in the issue)`].join('\n'),
		)
		expect(read_mock.mock.calls[0]?.[0]).toStrictEqual([LS_FILES, '--', `:(glob)**/${PREP_PATH}`])
		expect(grep_calls()).toHaveLength(0)
	})

	it('falls back to grep when listing the tracked files fails', async () => {
		read_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
			if (argv[0] === LS_FILES) throw new Error('not a git repository')

			return GREP_OUTPUT
		})

		expect(await run_prep_locate.locate(RUN_PREP_SPAN)).toContain('scripts/run/run-entry-cli.ts:85')
	})
})
