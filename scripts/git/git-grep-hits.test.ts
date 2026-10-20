import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_mock = vi.hoisted(() => vi.fn<(argv: ReadonlyArray<string>) => Promise<string>>())

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: read_mock } }))

const { git_grep_hits } = await import('./git-grep-hits')

const MAX_EXCERPT = 80
const LONG_TEXT_LENGTH = 200
const GIT_USAGE_EXIT = 129

function exit_error(code: number): Error {
	return Object.assign(new Error(`git exited ${String(code)}`), { exitCode: code })
}

beforeEach(() => {
	read_mock.mockReset()
})

describe('git_grep_hits.parse', () => {
	it('splits path and line off, keeping colons in the text', () => {
		expect(git_grep_hits.parse('a/b.ts:4:x: y\nnot a hit\n')).toStrictEqual([
			{ path: 'a/b.ts', line: '4', excerpt: 'x: y' },
		])
	})

	it('shortens a long excerpt with an ellipsis', () => {
		const [hit] = git_grep_hits.parse(`a.ts:1:${'x'.repeat(LONG_TEXT_LENGTH)}`)

		expect(hit?.excerpt).toBe(`${'x'.repeat(MAX_EXCERPT)}…`)
	})
})

describe('git_grep_hits.search', () => {
	it('runs a fixed-string grep with the flags before the pattern and the pathspec after', async () => {
		read_mock.mockResolvedValue('a.ts:1:x')

		const result = await git_grep_hits.search('run:prep', ['-m', '1'], ['*.ts'])

		expect(read_mock).toHaveBeenCalledWith([
			'grep',
			'-n',
			'-I',
			'-F',
			'-m',
			'1',
			'-e',
			'run:prep',
			'--',
			'*.ts',
		])
		expect(result).toStrictEqual({
			hits: [{ path: 'a.ts', line: '1', excerpt: 'x' }],
			has_failed: false,
		})
	})

	it('reads exit 1 as no match and any other exit as a failed search', async () => {
		read_mock.mockRejectedValueOnce(exit_error(1))
		read_mock.mockRejectedValueOnce(exit_error(GIT_USAGE_EXIT))

		expect(await git_grep_hits.search('x', [], [])).toStrictEqual({ hits: [], has_failed: false })
		expect(await git_grep_hits.search('x', [], [])).toStrictEqual({ hits: [], has_failed: true })
	})
})
