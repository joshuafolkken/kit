import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { toolchain_inputs } from './toolchain-inputs'

const MANIFEST = 'package.json'
const RULE = 'eslint/rule.js'
const CONFIG = 'tsconfig.json'

function inputs(): string {
	// Distributed tests cannot import kit's unpublished tools/test helper; cleanup is registered below.
	// eslint-disable-next-line no-restricted-syntax
	const root = mkdtempSync(path.join(tmpdir(), 'consumer-toolchain-'))

	onTestFinished(() => rmSync(root, { recursive: true, force: true }))
	mkdirSync(path.join(root, 'eslint'))
	writeFileSync(path.join(root, RULE), 'export default {}\n')
	writeFileSync(path.join(root, MANIFEST), '{}\n')
	symlinkSync(path.join(root, 'missing.json'), path.join(root, CONFIG))

	return root
}

it('verifies every distributed toolchain operation without kit internals (ac-07c1d077)', () => {
	const root = inputs()

	expect(toolchain_inputs.paths(root)).toEqual([RULE, MANIFEST, CONFIG])
	expect(toolchain_inputs.is_input(RULE)).toBe(true)
	expect(toolchain_inputs.is_input(MANIFEST)).toBe(true)
	expect(toolchain_inputs.is_input('eslint/rule.test.ts')).toBe(false)
	const before = toolchain_inputs.digest(root)

	writeFileSync(path.join(root, RULE), 'export default { changed: true }\n')
	expect(toolchain_inputs.digest(root)).not.toBe(before)
})
