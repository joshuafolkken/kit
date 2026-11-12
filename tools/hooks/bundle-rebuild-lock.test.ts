import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bundle_rebuild_lock } from './bundle-rebuild-lock'

const make_directory = temporary_directory('suite')
const root = make_directory('bundle-rebuild-lock-')
const out_directory = path.join(root, 'dist', 'commands')
const lock = bundle_rebuild_lock.lock_path(out_directory)
const MS_PER_SECOND = 1000

beforeEach(() => {
	mkdirSync(out_directory, { recursive: true })
})

afterEach(() => {
	rmSync(root, { recursive: true, force: true })
})

describe('bundle_rebuild_lock', () => {
	it('places the lock beside the bundle directory, outside what its build prunes', () => {
		expect(lock).toBe(path.join(root, 'dist', '.commands-rebuild.lock'))
	})

	it('grants the lock to one claimant until it is released', () => {
		expect(bundle_rebuild_lock.claim(lock)).toBe(true)
		expect(bundle_rebuild_lock.claim(lock)).toBe(false)

		bundle_rebuild_lock.release(lock)

		expect(existsSync(lock)).toBe(false)
		expect(bundle_rebuild_lock.claim(lock)).toBe(true)
	})

	it('takes over a lock left by a build that died', () => {
		const abandoned = (Date.now() - bundle_rebuild_lock.ABANDONED_LOCK_MS * 2) / MS_PER_SECOND

		writeFileSync(lock, '')
		utimesSync(lock, abandoned, abandoned)

		expect(bundle_rebuild_lock.claim(lock)).toBe(true)
	})
})
