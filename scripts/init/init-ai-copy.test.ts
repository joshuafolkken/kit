import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const WORKFLOW_MAPPING_DEST = vi.hoisted(() => '.github/workflows/ci.yml')
const PROMPT_FILE_NAME = vi.hoisted(() => 'CLAUDE.md')
const read_file_mock = vi.hoisted(() => vi.fn().mockReturnValue('content'))
const mkdir_mock = vi.hoisted(() => vi.fn())
const write_file_mock = vi.hoisted(() => vi.fn())
const exists_sync_mock = vi.hoisted(() => vi.fn())
const lstat_sync_mock = vi.hoisted(() => vi.fn())

const cp_sync_mock = vi.hoisted(() => vi.fn())
const copy_sonar_mock = vi.hoisted(() => vi.fn())
const OWNER_REPO = vi.hoisted(() => 'owner/repo')
const get_repo_name_mock = vi.hoisted(() => vi.fn())
const get_ai_copy_files_mock = vi.hoisted(() => vi.fn().mockReturnValue([PROMPT_FILE_NAME]))
const merge_workspace_mock = vi.hoisted(() =>
	vi.fn().mockImplementation((existing: string) => existing),
)
const transform_copied_content_mock = vi.hoisted(() =>
	vi.fn().mockImplementation((_destination: string, content: string) => content),
)

vi.mock('#scripts/gh-spawn', () => ({
	gh_spawn: { get_repo_name_with_owner: get_repo_name_mock },
}))
vi.mock('node:fs', () => ({
	cpSync: cp_sync_mock,
	existsSync: exists_sync_mock,
	lstatSync: lstat_sync_mock,
	mkdirSync: mkdir_mock,
	// The directory copy rewrites the copied markdown afterwards, which walks the source listing. An
	// absent export here does not fail loudly — `copy_directory_failure` catches the missing-export
	// throw and returns it as `copy failed`, so the success path would quietly stop being exercised.
	readdirSync: vi.fn(() => []),
	readFileSync: read_file_mock,
	writeFileSync: write_file_mock,
}))
vi.mock('node:path', () => ({
	default: {
		join: (...parts: Array<string>) => parts.join('/'),
		dirname: (path_: string) => path_.split('/').slice(0, -1).join('/'),
		// The directory-copy guard compares the two ends of the copy through `resolve`; these paths are
		// already absolute in this suite, so returning them unchanged is the honest stub.
		resolve: (path_: string) => path_,
	},
}))
vi.mock('./init-copy-content', () => ({
	transform_copied_content: transform_copied_content_mock,
}))
vi.mock('./init-logic', () => ({
	init_logic: {
		transform_prompt_paths: vi.fn().mockImplementation((content: string) => content),
		get_ai_copy_files: get_ai_copy_files_mock,
		get_ai_copy_file_mappings: vi
			.fn()
			.mockReturnValue([{ src: 'templates/workflows/ci.yml', dest: WORKFLOW_MAPPING_DEST }]),
		get_ai_copy_directories: vi.fn().mockReturnValue(['prompts']),
		merge_workspace_yaml: merge_workspace_mock,
	},
}))
vi.mock('./init-paths', () => ({
	PROJECT_ROOT: '/project',
	package_path: (name: string) => `/pkg/${name}`,
}))
vi.mock('./init-sonar', () => ({
	init_sonar: { copy_sonar_with_template: copy_sonar_mock },
}))

const { managed_marker_logic } = await import('#scripts/managed-marker/managed-marker-logic')
const { KIT_PACKAGE_NAME } = await import('#scripts/version/kit-descriptor')
const { init_ai_copy } = await import('./init-ai-copy')

// The guard behind the directory copy reads `lstat` and treats only an ENOENT-coded error as
// "nothing there", so a mocked absence has to carry the code — a bare throw reads as a path that
// could not be inspected, which is a blocked copy rather than a missing one.
function missing_path_error(): Error {
	return Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
}

const SRC_PATH = `/pkg/${PROMPT_FILE_NAME}`
const DEST_PATH = `/project/${PROMPT_FILE_NAME}`
const RAW_CONTENT = 'raw content'
const MAPPING_DEST_PATH = `/project/${WORKFLOW_MAPPING_DEST}`
const READ_FAILURE = 'EACCES'
const WORKSPACE_YAML = 'pnpm-workspace.yaml'

// A `console` spy left in place accumulates calls into the next test, and a mock implementation left
// throwing fails one. Reset once here rather than at the end of each test, where a failing assertion
// skips the cleanup and cascades into every test after it.
afterEach(() => {
	vi.restoreAllMocks()
	read_file_mock.mockReturnValue(RAW_CONTENT)
	exists_sync_mock.mockReturnValue(false)
	// The guard reads `lstat` and treats only an ENOENT-coded error as "nothing there", so the default
	// has to carry the code: a bare throw reads as an unreadable path and turns every unrelated test
	// in this file into a blocked copy that prints a warning.
	lstat_sync_mock.mockReset()
	lstat_sync_mock.mockImplementation(() => {
		throw missing_path_error()
	})
	write_file_mock.mockClear()
	transform_copied_content_mock.mockClear()
})

describe('init_ai_copy.copy_ai_file — write behavior', () => {
	it('writes transformed content to destination path', () => {
		read_file_mock.mockReturnValue(RAW_CONTENT)
		init_ai_copy.copy_ai_file(SRC_PATH, DEST_PATH)

		expect(write_file_mock).toHaveBeenCalledWith(DEST_PATH, RAW_CONTENT)
	})

	it('creates destination directory before writing', () => {
		init_ai_copy.copy_ai_file(SRC_PATH, DEST_PATH)

		expect(mkdir_mock).toHaveBeenCalledWith('/project', { recursive: true })
	})

	// The destination decides whether workflow action pins get resolved, so it has to reach
	// the transform — a content-only call would ship the template refs verbatim.
	it('passes the destination path to the content transform', () => {
		read_file_mock.mockReturnValue(RAW_CONTENT)
		init_ai_copy.copy_ai_file(SRC_PATH, DEST_PATH)

		expect(transform_copied_content_mock).toHaveBeenCalledWith(DEST_PATH, RAW_CONTENT)
	})
})

// `josh init` declines to overwrite a file that already exists — with one deliberate exception. An
// existing workflow is stamped in place, because an unstamped one is not merely out of date: the
// consumer's auto-merge workflow reads the stamp to decide whether an upstream package overwrites
// the file, so a skipped `ci.yml` would read as consumer-owned and merge bumps the next `josh sync`
// reverts — the loop joshuafolkken/kit#836 closed, reachable again through `init`
// (joshuafolkken/kit#844). The header changes nothing else about the file it is added to.
// `init` leaves an existing file alone — it does not stamp one, because the destination may hold a
// workflow the consumer wrote themselves and a header claiming this package owns it would hold every
// bump to it back on a false premise. What it does instead is name the consequence: until `sync`
// writes a header, the consumer's auto-merge workflow reads that workflow as consumer-owned
// (joshuafolkken/kit#844).
function run_over_existing_files(existing_content: string = RAW_CONTENT): Array<string> {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
		/* suppress */
	})

	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
	exists_sync_mock.mockReturnValue(true)
	// Everything already exists in this fixture, the distributed directory included: `init` declines
	// to overwrite it, which is an ordinary skip and not a warning.
	lstat_sync_mock.mockReturnValue({ isDirectory: () => true })
	write_file_mock.mockClear()
	transform_copied_content_mock.mockClear()
	read_file_mock.mockReturnValue(existing_content)

	init_ai_copy.run_ai_copies()

	return warn.mock.calls.map((args) => String(args[0]))
}

function did_warn_about(label: string): boolean {
	return run_over_existing_files().some((line) => line.includes(label))
}

describe('init_ai_copy.run_ai_copies — skip behavior', () => {
	it('writes nothing when every destination already exists', () => {
		run_over_existing_files()

		expect(write_file_mock).not.toHaveBeenCalled()
	})

	it('does not copy the template over an existing destination', () => {
		run_over_existing_files()

		expect(transform_copied_content_mock).not.toHaveBeenCalled()
	})
})

describe('init_ai_copy.run_ai_copies — unstamped workflow warning', () => {
	it('warns about an existing workflow that carries no header', () => {
		expect(did_warn_about(WORKFLOW_MAPPING_DEST)).toBe(true)
	})

	// The header is what the auto-merge workflow reads, so a stamped file needs no warning.
	it('stays quiet once the workflow carries a header', () => {
		const stamped = managed_marker_logic.apply_marker_for_destination(
			MAPPING_DEST_PATH,
			RAW_CONTENT,
			KIT_PACKAGE_NAME,
		)

		expect(run_over_existing_files(stamped)).toEqual([])
	})

	// Only workflows are read at all: nothing else is opened, and nothing else is warned about.
	it('says nothing about a file that is not a workflow', () => {
		expect(did_warn_about(PROMPT_FILE_NAME)).toBe(false)
	})

	// A permissions problem on the one file kind `init` now opens must not take the command down.
	it('does not abort when a workflow cannot be read', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {
			/* suppress */
		})
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})
		exists_sync_mock.mockReturnValue(true)
		read_file_mock.mockImplementation(() => {
			throw new Error(READ_FAILURE)
		})

		expect(() => init_ai_copy.run_ai_copies()).not.toThrow()
	})
})

describe('init_ai_copy.run_ai_copies — file mapping behavior', () => {
	it('writes mapping destination when it does not exist', () => {
		exists_sync_mock.mockReturnValue(false)
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})
		write_file_mock.mockClear()

		init_ai_copy.run_ai_copies()

		expect(write_file_mock).toHaveBeenCalledWith(MAPPING_DEST_PATH, expect.any(String))
	})

	it('does not write the mapping destination when it already exists', () => {
		run_over_existing_files()

		expect(write_file_mock).not.toHaveBeenCalledWith(MAPPING_DEST_PATH, expect.any(String))
	})
})

describe('init_ai_copy.run_ai_copies — copy behavior', () => {
	it('writes file when destination does not exist', () => {
		exists_sync_mock.mockReturnValue(false)
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})
		write_file_mock.mockClear()

		init_ai_copy.run_ai_copies()

		expect(write_file_mock).toHaveBeenCalled()
	})

	it('calls init_sonar.copy_sonar_with_template during run', () => {
		exists_sync_mock.mockReturnValue(false)
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})
		copy_sonar_mock.mockClear()

		init_ai_copy.run_ai_copies()

		expect(copy_sonar_mock).toHaveBeenCalled()
	})
})

// #853 made the directory list non-empty for the first time, so this copy runs on every `josh init`.
// `cpSync` throws ENOENT on a source the installed package does not carry — which the list and the
// packed files coming from one install makes a packing regression rather than a version mismatch —
// and the throw would end `josh init` before the sonar config and the repository-settings report.
function silence_console(): void {
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
	vi.spyOn(console, 'warn').mockImplementation(() => {
		/* suppress */
	})
}

describe('init_ai_copy.run_ai_copies — directory copy', () => {
	it('copies the directory when the package carries it', () => {
		exists_sync_mock.mockReturnValue(false)
		lstat_sync_mock.mockImplementation((candidate: string) => {
			if (candidate.startsWith('/pkg/')) return { isDirectory: () => true }

			throw missing_path_error()
		})
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		cp_sync_mock.mockClear()

		init_ai_copy.run_ai_copies()

		expect(cp_sync_mock).toHaveBeenCalledWith('/pkg/prompts', '/project/prompts', {
			recursive: true,
		})
		// `cpSync` having been called is not the success path: the copy is followed by a transform
		// pass, and a failure there is caught and reported as a skip with `cpSync` still recorded. A
		// mock missing an export the pass calls looked exactly like that (kit#854), so the reported
		// line is what the assertion reads.
		expect(info.mock.calls.map((call) => String(call[0])).join('\n')).toContain('✔ created')
		expect(warn).not.toHaveBeenCalled()
	})

	it('skips without throwing when the package does not carry it', () => {
		exists_sync_mock.mockReturnValue(false)
		lstat_sync_mock.mockImplementation(() => {
			throw missing_path_error()
		})
		silence_console()
		cp_sync_mock.mockClear()

		expect(() => init_ai_copy.run_ai_copies()).not.toThrow()
		expect(cp_sync_mock).not.toHaveBeenCalled()
	})
})

// The closing hint offers `josh sync` as the way to overwrite what `init` declined to touch, and
// `sync` refuses a blocked copy for the same reason `init` did — so raising it here would send the
// user around a loop instead of at the cause.
describe('init_ai_copy.run_ai_copies — closing hint', () => {
	it('does not offer josh sync as the fix for a blocked copy', () => {
		exists_sync_mock.mockReturnValue(false)
		lstat_sync_mock.mockImplementation(() => {
			throw missing_path_error()
		})

		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		init_ai_copy.run_ai_copies()

		const lines = info.mock.calls.map((call) => String(call[0])).join('\n')

		expect(lines).not.toContain('Run `josh sync`')
	})
})

describe('init_ai_copy.run_ai_copies — pnpm-workspace.yaml merge when exists', () => {
	it('calls merge_workspace_yaml when pnpm-workspace.yaml exists', () => {
		get_ai_copy_files_mock.mockReturnValueOnce([WORKSPACE_YAML])
		exists_sync_mock.mockReturnValue(true)
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})
		merge_workspace_mock.mockClear()

		init_ai_copy.run_ai_copies()

		expect(merge_workspace_mock).toHaveBeenCalled()
	})

	it('creates pnpm-workspace.yaml when file does not exist', () => {
		get_ai_copy_files_mock.mockReturnValueOnce([WORKSPACE_YAML])
		exists_sync_mock.mockReturnValue(false)
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})
		write_file_mock.mockClear()

		init_ai_copy.run_ai_copies()

		expect(write_file_mock).toHaveBeenCalled()
	})
})

// `run_ai_copies` resolves the repository name once for the Sonar config and hands it back so
// `josh init` can reuse it for the security-updates report instead of spawning a second
// `gh repo view` (joshuafolkken/kit#805).
describe('init_ai_copy.run_ai_copies — repository name', () => {
	beforeEach(() => {
		get_repo_name_mock.mockReturnValue(OWNER_REPO)
	})

	it('returns the resolved repository name', () => {
		expect(init_ai_copy.run_ai_copies()).toBe(OWNER_REPO)
	})

	it('forwards the resolved name to the sonar copy', () => {
		copy_sonar_mock.mockClear()

		init_ai_copy.run_ai_copies()

		expect(copy_sonar_mock).toHaveBeenCalledWith(OWNER_REPO)
	})

	it('resolves the repository name only once per run', () => {
		get_repo_name_mock.mockClear()
		get_repo_name_mock.mockReturnValue(OWNER_REPO)

		init_ai_copy.run_ai_copies()

		expect(get_repo_name_mock).toHaveBeenCalledTimes(1)
	})

	it('returns undefined when the repository cannot be resolved', () => {
		get_repo_name_mock.mockReturnValue(undefined)

		expect(init_ai_copy.run_ai_copies()).toBeUndefined()
	})
})
