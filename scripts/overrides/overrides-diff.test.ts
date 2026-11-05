import { beforeEach, describe, expect, it, vi } from 'vitest'

const BASE_COMMIT = 'b'.repeat(40)
const HEAD_COMMIT = 'h'.repeat(40)
const MERGE_BASE = 'm'.repeat(40)
const WORKSPACE_WITH_ESBUILD = 'overrides:\n  esbuild@<=0.24.2: ">=0.25.0"\n'
const PACKAGE_AT_BASE = '{"name":"base"}'
const PACKAGE_AT_HEAD = '{"name":"head"}'
const WORKTREE_SOURCES = { package_json: '{"name":"worktree"}', workspace_yaml: '' }
const ADOPT_RANGE = 'main...5853-lane'
const MERGE_BASE_COMMAND = 'merge-base'

const git_mock = vi.hoisted(() => {
	// `<ref>^{commit}` → the commit `rev-parse` answers; `<commit>:./<path>` → what `git show` prints.
	const state: { commits: Map<string, string>; files: Map<string, string>; merge_base?: string } = {
		commits: new Map(),
		files: new Map(),
	}

	// Each command's answer is keyed by its last argument; `merge-base` answers whatever it is asked.
	function read(args: ReadonlyArray<string>): string | undefined {
		const [command] = args
		const key = args.at(-1) ?? ''
		if (command === 'rev-parse') return state.commits.get(key)

		return command === 'show' ? state.files.get(key) : state.merge_base
	}

	return { state, read: vi.fn(read) }
})

vi.mock('#scripts/git/git-spawn-sync', () => ({ git_spawn_sync: { read: git_mock.read } }))
vi.mock('./overrides-files', () => ({
	overrides_files: { read_current_sources: vi.fn(() => WORKTREE_SOURCES) },
}))

const { overrides_diff } = await import('./overrides-diff')

beforeEach(() => {
	git_mock.state.commits = new Map([
		['main^{commit}', BASE_COMMIT],
		['HEAD^{commit}', BASE_COMMIT],
		['5853-lane^{commit}', HEAD_COMMIT],
	])
	git_mock.state.files = new Map([
		[`${BASE_COMMIT}:./package.json`, PACKAGE_AT_BASE],
		[`${BASE_COMMIT}:./pnpm-workspace.yaml`, WORKSPACE_WITH_ESBUILD],
		[`${MERGE_BASE}:./package.json`, PACKAGE_AT_BASE],
		[`${MERGE_BASE}:./pnpm-workspace.yaml`, WORKSPACE_WITH_ESBUILD],
		[`${HEAD_COMMIT}:./package.json`, PACKAGE_AT_HEAD],
	])
	git_mock.state.merge_base = MERGE_BASE
})

describe('overrides_diff.read_sources — an update not yet committed (<base>)', () => {
	it('reads the base commit against the working tree', () => {
		expect(overrides_diff.read_sources('HEAD')).toEqual({
			before: { package_json: PACKAGE_AT_BASE, workspace_yaml: WORKSPACE_WITH_ESBUILD },
			after: WORKTREE_SOURCES,
		})
	})

	it('answers undefined for a revision that is not a commit', () => {
		expect(overrides_diff.read_sources('no-such-ref')).toBeUndefined()
	})
})

describe('overrides_diff.read_sources — josh adopt (<base>...<head>)', () => {
	it('reads the merge-base against the branch tip, a file absent there as empty', () => {
		expect(overrides_diff.read_sources(ADOPT_RANGE)).toEqual({
			before: { package_json: PACKAGE_AT_BASE, workspace_yaml: WORKSPACE_WITH_ESBUILD },
			after: { package_json: PACKAGE_AT_HEAD, workspace_yaml: '' },
		})
		expect(git_mock.read).toHaveBeenCalledWith([MERGE_BASE_COMMAND, BASE_COMMIT, HEAD_COMMIT])
	})

	it('answers undefined when the head does not resolve', () => {
		expect(overrides_diff.read_sources('main...')).toBeUndefined()
	})

	it('answers undefined for an option-shaped base, never passing it to merge-base', () => {
		expect(overrides_diff.read_sources('--octopus...5853-lane')).toBeUndefined()
		expect(git_mock.read).not.toHaveBeenCalledWith(expect.arrayContaining([MERGE_BASE_COMMAND]))
	})

	it('answers undefined when the two ends share no merge-base', () => {
		delete git_mock.state.merge_base

		expect(overrides_diff.read_sources(ADOPT_RANGE)).toBeUndefined()
	})
})

describe('overrides_diff.changed_blocks — each overrides block, under its own file', () => {
	const with_package_block = '{"pnpm":{"overrides":{"esbuild":">=0.25.0"}}}'

	it('answers nothing when neither block moved', () => {
		const sources = { package_json: with_package_block, workspace_yaml: WORKSPACE_WITH_ESBUILD }

		expect(overrides_diff.changed_blocks({ before: sources, after: sources })).toEqual([])
	})

	it('names package.json when only its ignored block was stripped', () => {
		const before = { package_json: with_package_block, workspace_yaml: WORKSPACE_WITH_ESBUILD }
		const after = { package_json: '{}', workspace_yaml: WORKSPACE_WITH_ESBUILD }
		const changed = overrides_diff.changed_blocks({ before, after })

		expect(changed.map((block) => block.file)).toEqual(['package.json'])
		expect(changed[0]?.diff.removed).toEqual([{ key: 'esbuild', value: '>=0.25.0' }])
	})
})
