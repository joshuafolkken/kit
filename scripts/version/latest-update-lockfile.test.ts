import { lockfile_fixture } from '#scripts/overrides/lockfile-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logged_lines } from './logged-lines-fixture'

// kit #744: `josh latest` printed `✔ overrides unchanged` while the lockfile it had just written
// recorded the raw package.json range for an overridden dependency, so CI's frozen-lockfile install
// failed on a tree every local gate called green. These tests run the real readers over a mocked
// filesystem and assert the run now fails locally instead.

const WORKSPACE_YAML_PATH = 'pnpm-workspace.yaml'
const LOCKFILE_PATH = 'pnpm-lock.yaml'
const MISMATCH_NOTICE = 'no longer honours the overrides'

const { make_lockfile, OVERRIDDEN_NAME, OVERRIDE_RANGE, RAW_MANIFEST_RANGE } = lockfile_fixture

const PACKAGE_JSON = JSON.stringify({
	name: 'joshuafolkken-com',
	devDependencies: { [OVERRIDDEN_NAME]: RAW_MANIFEST_RANGE, vitest: '^4.0.0' },
})
const WORKSPACE_WITH_OVERRIDE = `overrides:\n  ${OVERRIDDEN_NAME}: ${OVERRIDE_RANGE}\n`

const tree = {
	package_json: PACKAGE_JSON,
	workspace_yaml: WORKSPACE_WITH_OVERRIDE,
	lockfile: make_lockfile(OVERRIDE_RANGE),
}

const execa_sync_mock = vi.hoisted(() => vi.fn().mockReturnValue({ exitCode: 0 }))
const read_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
vi.mock('node:fs', () => ({ readFileSync: read_mock, writeFileSync: vi.fn() }))
vi.mock('./preinstall-version-update', () => ({
	preinstall_version_update: { sync: vi.fn() },
}))

const { latest_update } = await import('./latest-update')

function read_tree_file(path: string): string {
	if (path === WORKSPACE_YAML_PATH) return tree.workspace_yaml
	if (path === LOCKFILE_PATH) return tree.lockfile

	return tree.package_json
}

beforeEach(() => {
	vi.clearAllMocks()
	tree.package_json = PACKAGE_JSON
	tree.workspace_yaml = WORKSPACE_WITH_OVERRIDE
	tree.lockfile = make_lockfile(OVERRIDE_RANGE)
	read_mock.mockImplementation(read_tree_file)
	execa_sync_mock.mockReturnValue({ exitCode: 0 })
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'warn').mockImplementation(vi.fn())
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	process.exitCode = undefined
})

afterEach(() => {
	process.exitCode = undefined
})

describe('latest_update.main — lockfile still honours the overrides', () => {
	it('says nothing and leaves the exit code alone', () => {
		latest_update.main()

		expect(logged_lines.find_logged(console.error, MISMATCH_NOTICE)).toBeUndefined()
		expect(process.exitCode).toBeUndefined()
	})
})

describe('latest_update.main — lockfile lost the override', () => {
	beforeEach(() => {
		execa_sync_mock.mockImplementation(() => {
			tree.lockfile = make_lockfile(RAW_MANIFEST_RANGE)

			return { exitCode: 0 }
		})
	})

	it('fails the run so the desync cannot reach CI', () => {
		latest_update.main()

		expect(process.exitCode).toBe(1)
	})

	it('names the package and both specifiers', () => {
		latest_update.main()

		expect(logged_lines.find_logged(console.error, OVERRIDDEN_NAME)).toContain(
			`lockfile ${RAW_MANIFEST_RANGE}, override ${OVERRIDE_RANGE}`,
		)
	})

	it('prints how to restore the lockfile', () => {
		latest_update.main()

		expect(logged_lines.find_logged(console.error, 'Restore it with')).toContain(
			`git checkout HEAD -- ${LOCKFILE_PATH} && pnpm install`,
		)
	})

	// The overrides file itself is untouched by the desync, so the existing guard reports a clean
	// bill — the exact pair of verdicts that made the failure invisible before this check existed.
	it('still reports the overrides file as unchanged', () => {
		latest_update.main()

		expect(logged_lines.find_logged(console.info, 'overrides unchanged')).toBeDefined()
	})
})

// CI resolves against the committed files, so the comparison has to use the overrides as they stand
// after the update — judging the new lockfile against the pre-update snapshot would report a
// mismatch for an override the tree no longer declares.
describe('latest_update.main — the override itself was dropped', () => {
	beforeEach(() => {
		execa_sync_mock.mockImplementation(() => {
			tree.workspace_yaml = ''
			tree.lockfile = make_lockfile(RAW_MANIFEST_RANGE)

			return { exitCode: 0 }
		})
	})

	it('does not report a mismatch against the removed override', () => {
		latest_update.main()

		expect(logged_lines.find_logged(console.error, MISMATCH_NOTICE)).toBeUndefined()
		expect(process.exitCode).toBeUndefined()
	})
})
