import { describe, expect, it, vi } from 'vitest'

const exists_sync_mock = vi.hoisted(() => vi.fn())
const write_sonar_file_mock = vi.hoisted(() => vi.fn())
const get_repo_name_with_owner_mock = vi.hoisted(() => vi.fn())
const SONAR_FILENAME = vi.hoisted(() => 'sonar-project.properties')

vi.mock('node:fs', () => ({ existsSync: exists_sync_mock }))
vi.mock('node:path', () => ({
	default: { join: (...parts: Array<string>) => parts.join('/') },
}))
vi.mock('./gh-spawn', () => ({
	gh_spawn: { get_repo_name_with_owner: get_repo_name_with_owner_mock },
}))
vi.mock('./init-logic', () => ({
	init_logic: {
		get_sonar_template_source: vi.fn().mockReturnValue(SONAR_FILENAME),
		get_sonar_template_destination: vi.fn().mockReturnValue(SONAR_FILENAME),
		derive_sonar_identifiers: vi
			.fn()
			.mockReturnValue({ project_key: 'owner_repo', organization: 'owner' }),
	},
}))
vi.mock('./init-paths', () => ({ PACKAGE_DIR: '/pkg', PROJECT_ROOT: '/project' }))
vi.mock('./sonar-file', () => ({ sonar_file: { write_sonar_file: write_sonar_file_mock } }))

const { init_sonar } = await import('./init-sonar')

const SONAR_DEST = `/project/${SONAR_FILENAME}`
const OWNER_REPO = 'owner/repo'

describe('init_sonar.copy_sonar_with_template — skips when gh fails', () => {
	it('does not write file when gh repo view returns undefined', () => {
		get_repo_name_with_owner_mock.mockReset()
		vi.spyOn(console, 'warn').mockImplementation(() => {
			/* suppress */
		})

		init_sonar.copy_sonar_with_template()

		expect(write_sonar_file_mock).not.toHaveBeenCalled()
		vi.restoreAllMocks()
	})
})

describe('init_sonar.copy_sonar_with_template — skips when file exists', () => {
	it('does not write file when destination already exists', () => {
		get_repo_name_with_owner_mock.mockReturnValue(OWNER_REPO)
		exists_sync_mock.mockReturnValue(true)
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})

		init_sonar.copy_sonar_with_template()

		expect(write_sonar_file_mock).not.toHaveBeenCalled()
		vi.restoreAllMocks()
	})
})

describe('init_sonar.copy_sonar_with_template — writes when file is missing', () => {
	it('calls write_sonar_file with correct destination when file does not exist', () => {
		get_repo_name_with_owner_mock.mockReturnValue(OWNER_REPO)
		exists_sync_mock.mockReturnValue(false)
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})

		init_sonar.copy_sonar_with_template()

		expect(write_sonar_file_mock).toHaveBeenCalledWith(
			expect.any(String),
			SONAR_DEST,
			expect.objectContaining({ project_key: 'owner_repo' }),
		)
		vi.restoreAllMocks()
	})
})
