import { existsSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { describe, expect, it } from 'vitest'
import { migrate_files } from './migrate-files'

const make_directory = temporary_directory()
const APP_MANIFEST = 'packages/app/package.json'
const USER_CONFIG = 'user.npmrc'
const LOCKFILE = 'pnpm-lock.yaml'
const RENAME_ERROR = 'rename failed'

function fail_second_replace(source: string, target: string): void {
	if (path.basename(target) === LOCKFILE) throw new Error(RENAME_ERROR)
	renameSync(source, target)
}

function source_tree(): string {
	const root = make_directory('migration-copy-')

	write_file(root, 'package.json', '{}')
	write_file(root, APP_MANIFEST, '{}')
	write_file(root, 'node_modules/old-kit', 'installed')
	write_file(root, '.git/config', 'git state')

	return root
}

describe('migration staging', () => {
	it('copies workspace inputs and omits installed kit and git state', () => {
		const staged = migrate_files.stage(source_tree())

		try {
			expect(existsSync(path.join(staged, APP_MANIFEST))).toBe(true)
			expect(existsSync(path.join(staged, 'node_modules'))).toBe(false)
			expect(existsSync(path.join(staged, '.git'))).toBe(false)
		} finally {
			rmSync(staged, { recursive: true, force: true })
		}
	})

	it('refuses a symlinked project configuration instead of altering user configuration', () => {
		const root = make_directory('migration-symlink-')

		write_file(root, USER_CONFIG, '@joshuafolkken:registry=https://npm.pkg.github.com\n')
		symlinkSync(path.join(root, USER_CONFIG), path.join(root, '.npmrc'))
		expect(() => migrate_files.snapshot(root)).toThrow('regular file')
		expect(readFileSync(path.join(root, USER_CONFIG), 'utf8')).toContain('npm.pkg.github.com')
	})
})

describe('migration rollback', () => {
	it.each([true, false])(
		'restores existing and absent originals on rename failure: %s',
		(has_config) => {
			const root = make_directory('migration-rollback-')
			const staged = make_directory('migration-staged-')

			if (has_config) write_file(root, '.npmrc', 'original config')
			write_file(root, LOCKFILE, 'original lock')
			const before = migrate_files.snapshot(root)

			write_file(staged, '.npmrc', 'new config')
			write_file(staged, LOCKFILE, 'new lock')
			expect(() => migrate_files.commit(root, before, staged, fail_second_replace)).toThrow(
				RENAME_ERROR,
			)
			expect(migrate_files.snapshot(root)).toEqual(before)
		},
	)
})
