import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { own_formatter } from './own-formatter'

const roots: Array<string> = []

function fixture(files: Array<string>): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'josh-own-formatter-'))

	roots.push(root)

	for (const file of files) writeFileSync(path.join(root, file), '{}')

	return root
}

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('own_formatter.find_config', () => {
	it.each(['biome.json', 'biome.jsonc', 'dprint.json', '.dprint.jsonc'])('finds %s', (name) => {
		expect(own_formatter.find_config(fixture([name]))).toBe(name)
	})
	it('returns undefined when the project has no formatter of its own', () => {
		expect(own_formatter.find_config(fixture(['.prettierrc', 'package.json']))).toBeUndefined()
	})
})
