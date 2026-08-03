import { beforeEach, describe, expect, it, vi } from 'vitest'

// A supply-chain guard that suppresses versions younger than a minimum age makes `pnpm update
// --latest` resolve to a version *older* than the installed one. These tests drive that shape: the
// mocked update rewrites package.json downwards, and the orchestration has to notice and undo it.

const PACKAGE_JSON_PATH = 'package.json'
const LOCKFILE_PATH = 'pnpm-lock.yaml'

const INSTALLED = JSON.stringify({ dependencies: { tsx: '^4.23.5' }, devDependencies: {} })
const DOWNGRADED = JSON.stringify({ dependencies: { tsx: '^4.23.1' }, devDependencies: {} })
const UPGRADED = JSON.stringify({ dependencies: { tsx: '^4.24.0' }, devDependencies: {} })
const ORIGINAL_LOCK = 'lockfile: installed'
const REWRITTEN_LOCK = 'lockfile: downgraded'

const tree = { package_json: INSTALLED, lockfile: ORIGINAL_LOCK }

const read_mock = vi.hoisted(() => vi.fn())
const write_mock = vi.hoisted(() => vi.fn())
const execa_sync_mock = vi.hoisted(() => vi.fn())
const sync_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
vi.mock('node:fs', () => ({ readFileSync: read_mock, writeFileSync: write_mock }))
vi.mock('./preinstall-version-update', () => ({
	preinstall_version_update: { sync: sync_mock },
}))
vi.mock('#scripts/overrides/overrides-logic', () => ({
	overrides_check: {
		read_overrides_from_package: vi.fn().mockReturnValue({}),
		list_excluded_package_names: vi.fn().mockReturnValue([]),
		build_update_command: vi.fn().mockReturnValue(['pnpm', 'update', '--latest', 'tsx']),
	},
}))

const { latest_update } = await import('./latest-update')
const { overrides_check } = await import('#scripts/overrides/overrides-logic')
const mocked_build = vi.mocked(overrides_check.build_update_command)

function rewrite_package_json(content: string): void {
	tree.package_json = content
	tree.lockfile = REWRITTEN_LOCK
}

beforeEach(() => {
	vi.clearAllMocks()
	tree.package_json = INSTALLED
	tree.lockfile = ORIGINAL_LOCK
	read_mock.mockImplementation((path: string) =>
		path === LOCKFILE_PATH ? tree.lockfile : tree.package_json,
	)
	write_mock.mockImplementation((path: string, content: string) => {
		if (path === LOCKFILE_PATH) tree.lockfile = content
		else tree.package_json = content
	})
	mocked_build.mockReturnValue(['pnpm', 'update', '--latest', 'tsx'])
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
})

describe('latest_update.main — an update that would downgrade', () => {
	beforeEach(() => {
		execa_sync_mock.mockImplementation(() => {
			rewrite_package_json(DOWNGRADED)

			return { exitCode: 0 }
		})
	})

	it('leaves the installed version in package.json', () => {
		latest_update.main()

		expect(tree.package_json).toBe(INSTALLED)
	})

	// Restoring the lockfile is the whole recovery: while the newer version is suppressed it is also
	// unresolvable, so a re-install cannot put it back — only the captured entry can.
	it('restores the lockfile the update rewrote', () => {
		latest_update.main()

		expect(tree.lockfile).toBe(ORIGINAL_LOCK)
	})

	it('reports which package was kept back and what was offered', () => {
		latest_update.main()

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(expect.stringContaining('tsx@^4.23.5'))
		expect(vi.mocked(console.info)).toHaveBeenCalledWith(
			expect.stringContaining('newest allowed is ^4.23.1'),
		)
	})

	it('says the whole update was rolled back, not just that one package was kept', () => {
		latest_update.main()

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(
			expect.stringContaining('rolled back and no dependency changed'),
		)
	})
})

describe('latest_update.main — what a rollback must not do', () => {
	beforeEach(() => {
		execa_sync_mock.mockImplementation(() => {
			rewrite_package_json(DOWNGRADED)

			return { exitCode: 0 }
		})
	})

	// Excluding the offender from the update targets does not exclude it from resolution — while its
	// installed version sits above the newest allowed one, pnpm cannot resolve the tree at all, so a
	// retry could only fail. Verified against the real registry during #736.
	it('does not retry the update', () => {
		latest_update.main()

		expect(execa_sync_mock).toHaveBeenCalledOnce()
	})

	// The notice claims the tree was left exactly as found, so this sync — which rewrites
	// package.json to advance the pinned safe-chain version — must not run and contradict it.
	it('skips the preinstall sync so nothing is written after the rollback', () => {
		latest_update.main()

		expect(sync_mock).not.toHaveBeenCalled()
	})

	it('exits without failing, since the tree is intact and the condition is transient', () => {
		expect(() => {
			latest_update.main()
		}).not.toThrow()
	})
})

describe('latest_update.main — an update that moves forward', () => {
	beforeEach(() => {
		execa_sync_mock.mockImplementation(() => {
			rewrite_package_json(UPGRADED)

			return { exitCode: 0 }
		})
	})

	it('keeps the upgraded version', () => {
		latest_update.main()

		expect(tree.package_json).toBe(UPGRADED)
	})

	it('runs the update once, without a retry', () => {
		latest_update.main()

		expect(execa_sync_mock).toHaveBeenCalledOnce()
	})

	it('builds the update command from the overrides alone', () => {
		latest_update.main()

		expect(mocked_build).toHaveBeenCalledWith({}, expect.any(String))
	})

	it('syncs the preinstall version', () => {
		latest_update.main()

		expect(sync_mock).toHaveBeenCalled()
	})
})

describe('latest_update.main — a failing update', () => {
	beforeEach(() => {
		execa_sync_mock.mockImplementation(() => ({ exitCode: 1 }))
	})

	it('does not retry a failure', () => {
		latest_update.main()

		expect(execa_sync_mock).toHaveBeenCalledOnce()
	})

	it('skips the preinstall sync', () => {
		latest_update.main()

		expect(sync_mock).not.toHaveBeenCalled()
	})

	it('leaves the tree untouched', () => {
		latest_update.main()

		expect(tree.package_json).toBe(INSTALLED)
	})
})

describe('latest_update.take_snapshot', () => {
	it('reads both files that an update can rewrite', () => {
		const snapshot = latest_update.take_snapshot()

		expect(snapshot.package_json).toBe(INSTALLED)
		expect(snapshot.lockfile).toBe(ORIGINAL_LOCK)
	})

	// A project without a lockfile still has to snapshot cleanly; there is simply nothing to restore.
	it('tolerates a missing lockfile', () => {
		read_mock.mockImplementation((path: string) => {
			if (path === LOCKFILE_PATH) throw new Error('ENOENT')

			return tree.package_json
		})

		expect(latest_update.take_snapshot().lockfile).toBe('')
	})
})

describe('latest_update.restore_snapshot', () => {
	it('writes package.json back', () => {
		latest_update.restore_snapshot({ package_json: INSTALLED, lockfile: ORIGINAL_LOCK })

		expect(write_mock).toHaveBeenCalledWith(PACKAGE_JSON_PATH, INSTALLED)
	})

	it('does not create a lockfile that never existed', () => {
		latest_update.restore_snapshot({ package_json: INSTALLED, lockfile: '' })

		expect(write_mock).not.toHaveBeenCalledWith(LOCKFILE_PATH, expect.any(String))
	})
})
