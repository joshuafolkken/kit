import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { create_version_command_config, version_commands } from './index'

const exports_schema = z.object({ exports: z.record(z.string(), z.unknown()) })

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SELF_DIR, '..', '..')
const VERSION_EXPORT_KEY = './version'
const VERSION_EXPORT_PATH = './scripts/version/index.ts'

describe('version library barrel', () => {
	it('re-exports the config builder', () => {
		expect(typeof create_version_command_config).toBe('function')
	})

	it('re-exports the version_commands run functions', () => {
		expect(typeof version_commands.run_check).toBe('function')
		expect(typeof version_commands.run_upgrade).toBe('function')
	})
})

describe('package.json version export', () => {
	it('exposes ./version pointing at the library barrel', () => {
		const raw = readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
		const parsed = exports_schema.parse(JSON.parse(raw))

		expect(parsed.exports[VERSION_EXPORT_KEY]).toBe(VERSION_EXPORT_PATH)
	})
})
