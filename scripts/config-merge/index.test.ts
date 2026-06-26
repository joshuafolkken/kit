import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { config_merge } from './index'

const config_merge_export_schema = z.object({ types: z.string(), default: z.string() })
const exports_schema = z.object({ exports: z.record(z.string(), z.unknown()) })

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SELF_DIR, '..', '..')
const EXPORT_KEY = './config-merge'
const EXPORT_TYPES = './dist/config-merge/index.d.ts'
const EXPORT_DEFAULT = './dist/config-merge/index.js'

describe('config-merge library barrel', () => {
	it('re-exports the yaml patch + read functions', () => {
		expect(typeof config_merge.patch_yaml_list_field).toBe('function')
		expect(typeof config_merge.read_yaml_list_field).toBe('function')
	})

	it('re-exports the json patch function', () => {
		expect(typeof config_merge.patch_json_list_field).toBe('function')
	})
})

describe('package.json config-merge export', () => {
	it('exposes ./config-merge pointing at the compiled dist output', () => {
		const raw = readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')
		const parsed = exports_schema.parse(JSON.parse(raw))
		const config_export = config_merge_export_schema.parse(parsed.exports[EXPORT_KEY])

		expect(config_export.types).toBe(EXPORT_TYPES)
		expect(config_export.default).toBe(EXPORT_DEFAULT)
	})
})
