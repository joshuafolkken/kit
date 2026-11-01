import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { toolchain_inputs } from '#scripts/gate/toolchain-inputs'
import { json_value } from '#scripts/lib/json-value'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build_hooks, INLINED_PACKAGES } from './build-hooks'
import { hook_bundle_stamp } from './hook-bundle-stamp'

const BUILD_TIMEOUT_MS = 60_000
const REPO_ROOT = process.cwd()
const DEPENDENCY_SEGMENT = 'node_modules/'
// `stop-guard` reaches `typescript` through `eslint/config-fingerprint.js`; inlined it would grow the
// bundles tenfold, so it stays a runtime import.
const EXTERNAL_PACKAGE = 'typescript'

const out_directory = mkdtempSync(path.join(tmpdir(), 'build-hooks-deps-'))

function built_code(): string {
	const outputs = readdirSync(out_directory).filter((name) => name.endsWith('.js'))

	return outputs.map((name) => readFileSync(path.join(out_directory, name), 'utf8')).join('\n')
}

function imports_package(code: string, name: string): boolean {
	return code.includes(`from "${name}"`) || code.includes(`from "${name}/`)
}

function recorded_inputs(): Array<string> {
	const stamp = json_value.parse_or_undefined(
		readFileSync(path.join(out_directory, hook_bundle_stamp.STAMP_NAME), 'utf8'),
	)
	const inputs = json_value.is_record(stamp) ? stamp['inputs'] : undefined

	return Array.isArray(inputs) ? inputs.map(String) : []
}

beforeAll(async () => {
	await build_hooks(out_directory)
}, BUILD_TIMEOUT_MS)

afterAll(() => {
	rmSync(out_directory, { recursive: true, force: true })
})

// joshuafolkken/kit#5641: loading these from node_modules file by file was most of the pretool
// bundle's import time on every tool call.
describe('build_hooks dependency boundary', () => {
	it('inlines every dependency each hook launch loads', () => {
		const code = built_code()
		const imported = [...INLINED_PACKAGES].filter((name) => imports_package(code, name))

		expect(imported).toEqual([])
	})

	it('keeps any other dependency a runtime import', () => {
		expect(imports_package(built_code(), EXTERNAL_PACKAGE)).toBe(true)
	})

	it('records no inlined dependency source in the stamp', () => {
		const toolchain = new Set(toolchain_inputs.paths(REPO_ROOT))
		const dependencies = recorded_inputs().filter(
			(input) => input.includes(DEPENDENCY_SEGMENT) && !toolchain.has(input),
		)

		expect(dependencies).toEqual([])
	})

	it('reads its fresh build as current', () => {
		expect(hook_bundle_stamp.is_fresh(out_directory, REPO_ROOT)).toBe(true)
	})
})
