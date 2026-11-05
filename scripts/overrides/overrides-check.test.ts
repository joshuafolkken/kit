import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEFAULT_PACKAGE_JSON = '{"pnpm":{"overrides":{}}}'
const REACT_18_SNAPSHOT = '{"react":"^18.0.0"}'
const PROCESS_EXIT_CALLED = 'process.exit called'
const SVELTE_SNAPSHOT = '{"svelte":"^5.55.7"}'
const PACKAGE_JSON_WITHOUT_PNPM = '{"name":"app-kit"}'
const WORKSPACE_YAML_WITH_SVELTE = 'overrides:\n  svelte: ^5.55.7\n'
const USAGE = 'Usage: josh overrides [--save] [--diff <base>[...<head>]]'
const ADOPT_RANGE = 'main...5853-lane'
const DEV_ENGINES_KEPT = 'devEngines: kept'
const WORKSPACE_WITH_ESBUILD = 'overrides:\n  esbuild@<=0.24.2: ">=0.25.0"\n'
const KEPT_SOURCES = { package_json: '{}', workspace_yaml: WORKSPACE_WITH_ESBUILD }

const fs_mock = vi.hoisted(() => {
	const state: {
		package_json: string
		workspace_yaml: string
		snapshot_content?: string
		snapshot_save_error?: Error
	} = {
		package_json: '',
		workspace_yaml: '',
	}

	function read_snapshot_content(): string {
		if (state.snapshot_save_error !== undefined) throw state.snapshot_save_error

		if (state.snapshot_content === undefined) {
			throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
		}

		return state.snapshot_content
	}

	function mock_read_file_sync(path_argument: string): string {
		if (path_argument.includes('overrides-snapshot')) return read_snapshot_content()
		if (path_argument === 'pnpm-workspace.yaml') return state.workspace_yaml

		return state.package_json
	}

	return { state, mock_read_file_sync }
})

vi.mock('node:fs', () => ({
	readFileSync: fs_mock.mock_read_file_sync,
	writeFileSync: vi.fn(),
}))
vi.mock('#scripts/version/development-engines-verdict', () => ({
	development_engines_verdict: {
		report: vi.fn(),
		describe: vi.fn(() => DEV_ENGINES_KEPT),
		is_intact: vi.fn(() => true),
	},
}))
// Only the git read is replaced; which blocks changed is the real answer for the sources it returns.
vi.mock(import('./overrides-diff'), async (import_original) => {
	const { overrides_diff: actual } = await import_original()

	return { overrides_diff: { ...actual, read_sources: vi.fn() } }
})

const { writeFileSync: write_file_sync } = await import('node:fs')
const { development_engines_verdict } = await import('#scripts/version/development-engines-verdict')
const { overrides_diff } = await import('./overrides-diff')
const { run_overrides_check, main } = await import('./overrides-check')

// Every spy here is one mock for the whole file — uncleared, a call an earlier test made satisfies a
// later test's assertion before the code under test runs.
beforeEach(() => {
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error(PROCESS_EXIT_CALLED)
	})
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	delete fs_mock.state.snapshot_content
	delete fs_mock.state.snapshot_save_error
	fs_mock.state.package_json = DEFAULT_PACKAGE_JSON
	fs_mock.state.workspace_yaml = ''
})

describe('overrides-check — snapshot not found (ENOENT)', () => {
	it('throws when snapshot file does not exist', () => {
		expect(() => {
			run_overrides_check(false)
		}).toThrow()
	})
})

describe('overrides-check — invalid snapshot JSON', () => {
	it('throws when snapshot file contains invalid JSON', () => {
		fs_mock.state.snapshot_content = 'not valid json'

		expect(() => {
			run_overrides_check(false)
		}).toThrow()
	})
})

describe('overrides-check — valid snapshot matches current', () => {
	it('does not call process.exit when overrides match snapshot', () => {
		fs_mock.state.snapshot_content = REACT_18_SNAPSHOT
		fs_mock.state.workspace_yaml = 'overrides:\n  react: ^18.0.0\n'

		expect(() => {
			run_overrides_check(false)
		}).not.toThrow()
	})
})

describe('overrides-check — snapshot differs from current', () => {
	it('calls process.exit(1) when overrides do not match snapshot', () => {
		fs_mock.state.snapshot_content = REACT_18_SNAPSHOT
		fs_mock.state.workspace_yaml = 'overrides:\n  react: ^19.0.0\n'

		expect(() => {
			run_overrides_check(false)
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(console.error).toHaveBeenCalledWith(
			'✖ overrides changed unexpectedly (1 from pnpm-workspace.yaml):',
		)
	})
})

describe('overrides-check — ignored package.json field', () => {
	it('does not accept a package.json override as a replacement for a workspace override', () => {
		fs_mock.state.snapshot_content = REACT_18_SNAPSHOT
		fs_mock.state.package_json = '{"pnpm":{"overrides":{"react":"^18.0.0"}}}'

		expect(() => {
			run_overrides_check(false)
		}).toThrow(PROCESS_EXIT_CALLED)
	})
})

// kit #740: the check read package.json only, so a project whose overrides live in
// pnpm-workspace.yaml — kit and app-kit both do — reported "unchanged" against an empty record.
describe('overrides-check — overrides declared in pnpm-workspace.yaml', () => {
	// The exact false all-clear: kit's own snapshot held `{}` because the reader only ever saw
	// package.json, so a workspace override that was never snapshotted still reported "unchanged".
	it('reports a workspace override missing from an empty snapshot as a change', () => {
		fs_mock.state.snapshot_content = '{}'
		fs_mock.state.package_json = PACKAGE_JSON_WITHOUT_PNPM
		fs_mock.state.workspace_yaml = WORKSPACE_YAML_WITH_SVELTE

		expect(() => {
			run_overrides_check(false)
		}).toThrow(PROCESS_EXIT_CALLED)
	})

	it('detects a removed workspace override even when package.json has no pnpm field', () => {
		fs_mock.state.snapshot_content = SVELTE_SNAPSHOT
		fs_mock.state.package_json = PACKAGE_JSON_WITHOUT_PNPM
		fs_mock.state.workspace_yaml = 'allowBuilds:\n  esbuild: true\n'

		expect(() => {
			run_overrides_check(false)
		}).toThrow(PROCESS_EXIT_CALLED)
	})

	it('passes when the workspace override is intact', () => {
		fs_mock.state.snapshot_content = SVELTE_SNAPSHOT
		fs_mock.state.package_json = PACKAGE_JSON_WITHOUT_PNPM
		fs_mock.state.workspace_yaml = WORKSPACE_YAML_WITH_SVELTE

		expect(() => {
			run_overrides_check(false)
		}).not.toThrow()
	})

	it('names the file the overrides were read from', () => {
		fs_mock.state.snapshot_content = SVELTE_SNAPSHOT
		fs_mock.state.package_json = PACKAGE_JSON_WITHOUT_PNPM
		fs_mock.state.workspace_yaml = WORKSPACE_YAML_WITH_SVELTE
		run_overrides_check(false)

		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('1 from pnpm-workspace.yaml'))
	})
})

// joshuafolkken/kit#3592: the flags were read by a bare `parseArgs`, so an unknown one threw
// `ERR_PARSE_ARGS_UNKNOWN_OPTION` out of `main` instead of being refused.
describe('overrides-check — the argument line', () => {
	it('refuses an unknown flag with usage and exit 1, writing no snapshot', () => {
		expect(() => {
			main(['--bogus'])
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(console.error).toHaveBeenCalledWith(USAGE)
		expect(process.exit).toHaveBeenCalledWith(1)
		expect(write_file_sync).not.toHaveBeenCalled()
	})

	it('saves the snapshot on --save', () => {
		expect(() => {
			main(['--save'])
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(write_file_sync).toHaveBeenCalledOnce()
		expect(process.exit).toHaveBeenCalledWith(0)
	})

	it('compares against the snapshot when no flag is given', () => {
		fs_mock.state.snapshot_content = SVELTE_SNAPSHOT
		fs_mock.state.workspace_yaml = WORKSPACE_YAML_WITH_SVELTE
		main([])

		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('overrides unchanged'))
	})

	it('prints the devEngines verdict even when the overrides changed', () => {
		fs_mock.state.snapshot_content = REACT_18_SNAPSHOT

		expect(() => {
			main([])
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(development_engines_verdict.report).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#5853: the dependency-update check read `git diff` by eye, in another form after
// `josh adopt`; `--diff` answers both with the same two verdict lines.
describe('overrides-check — --diff against a git revision', () => {
	it('prints both verdicts for an update not yet committed (--diff HEAD)', () => {
		const bumped_manifest = '{"name":"bumped"}'
		const bumped = { ...KEPT_SOURCES, package_json: bumped_manifest }

		vi.mocked(overrides_diff.read_sources).mockReturnValue({ before: KEPT_SOURCES, after: bumped })
		main(['--diff', 'HEAD'])

		expect(overrides_diff.read_sources).toHaveBeenCalledWith('HEAD')
		expect(development_engines_verdict.describe).toHaveBeenCalledWith('{}', bumped_manifest)
		expect(console.info).toHaveBeenCalledWith(DEV_ENGINES_KEPT)
		expect(console.info).toHaveBeenCalledWith(
			'✔ overrides unchanged since HEAD (1 from pnpm-workspace.yaml).',
		)
		expect(development_engines_verdict.report).not.toHaveBeenCalled()
	})

	it('exits 1 naming the removed override after josh adopt (--diff <base>...<head>)', () => {
		const removed = { package_json: '{}', workspace_yaml: '' }

		vi.mocked(overrides_diff.read_sources).mockReturnValue({ before: KEPT_SOURCES, after: removed })

		expect(() => {
			main([`--diff=${ADOPT_RANGE}`])
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(console.info).toHaveBeenCalledWith(DEV_ENGINES_KEPT)
		expect(console.error).toHaveBeenCalledWith(
			`✖ pnpm-workspace.yaml overrides changed since ${ADOPT_RANGE}:`,
		)
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('- removed: esbuild@<=0.24.2'),
		)
		expect(process.exit).toHaveBeenCalledWith(1)
	})
})

describe('overrides-check — --diff refusals', () => {
	it('refuses a range that resolves to no commit', () => {
		vi.mocked(overrides_diff.read_sources).mockReturnValue(undefined)

		expect(() => {
			main(['--diff', 'no-such-ref'])
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('cannot resolve no-such-ref'),
		)
		expect(process.exit).toHaveBeenCalledWith(1)
	})

	it('refuses --save beside --diff with usage, writing no snapshot', () => {
		expect(() => {
			main(['--save', '--diff', 'HEAD'])
		}).toThrow(PROCESS_EXIT_CALLED)
		expect(console.error).toHaveBeenCalledWith(USAGE)
		expect(write_file_sync).not.toHaveBeenCalled()
		expect(overrides_diff.read_sources).not.toHaveBeenCalled()
	})
})
