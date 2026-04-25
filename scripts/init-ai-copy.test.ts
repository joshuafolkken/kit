import { describe, expect, it, vi } from 'vitest'

const read_file_mock = vi.hoisted(() => vi.fn().mockReturnValue('content'))
const mkdir_mock = vi.hoisted(() => vi.fn())
const write_file_mock = vi.hoisted(() => vi.fn())
const exists_sync_mock = vi.hoisted(() => vi.fn())
const cp_sync_mock = vi.hoisted(() => vi.fn())
const copy_sonar_mock = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({
	cpSync: cp_sync_mock,
	existsSync: exists_sync_mock,
	mkdirSync: mkdir_mock,
	readFileSync: read_file_mock,
	writeFileSync: write_file_mock,
}))
vi.mock('node:path', () => ({
	default: {
		join: (...parts: Array<string>) => parts.join('/'),
		dirname: (path_: string) => path_.split('/').slice(0, -1).join('/'),
	},
}))
vi.mock('./init-logic', () => ({
	init_logic: {
		transform_prompt_paths: vi.fn().mockImplementation((content: string) => content),
		get_ai_copy_files: vi.fn().mockReturnValue(['CLAUDE.md']),
		get_ai_copy_directories: vi.fn().mockReturnValue(['prompts']),
	},
}))
vi.mock('./init-paths', () => ({
	PROJECT_ROOT: '/project',
	package_path: (name: string) => `/pkg/${name}`,
}))
vi.mock('./init-sonar', () => ({
	init_sonar: { copy_sonar_with_template: copy_sonar_mock },
}))

const { init_ai_copy } = await import('./init-ai-copy')

const SRC_PATH = '/pkg/CLAUDE.md'
const DEST_PATH = '/project/CLAUDE.md'
const RAW_CONTENT = 'raw content'

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
})

describe('init_ai_copy.run_ai_copies — skip behavior', () => {
	it('does not write when destination file already exists', () => {
		exists_sync_mock.mockReturnValue(true)
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})
		write_file_mock.mockClear()

		init_ai_copy.run_ai_copies()

		expect(write_file_mock).not.toHaveBeenCalled()
		vi.restoreAllMocks()
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
		vi.restoreAllMocks()
	})

	it('calls init_sonar.copy_sonar_with_template during run', () => {
		exists_sync_mock.mockReturnValue(false)
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})
		copy_sonar_mock.mockClear()

		init_ai_copy.run_ai_copies()

		expect(copy_sonar_mock).toHaveBeenCalled()
		vi.restoreAllMocks()
	})
})
