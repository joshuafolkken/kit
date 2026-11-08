import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { own_formatter } from './own-formatter'

const make_directory = temporary_directory('suite')

function fixture(files: Array<string>): string {
	const root = make_directory('josh-own-formatter-')

	for (const file of files) writeFileSync(path.join(root, file), '{}')

	return root
}

describe('own_formatter.find_config', () => {
	it.each(['biome.json', 'biome.jsonc', 'dprint.json', '.dprint.jsonc'])('finds %s', (name) => {
		expect(own_formatter.find_config(fixture([name]))).toBe(name)
	})
	it('returns undefined when the project has no formatter of its own', () => {
		expect(own_formatter.find_config(fixture(['.prettierrc', 'package.json']))).toBeUndefined()
	})
})
