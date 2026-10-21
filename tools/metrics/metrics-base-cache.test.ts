import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { metrics_base_cache, type CachedReading } from './metrics-base-cache'

// joshuafolkken/kit#4382: the merge-base reading is keyed on the commit and on the ruler — the
// sources the metrics command loads — so a changed ruler measures the base again.

const scratch = mkdtempSync(path.join(tmpdir(), 'metrics-base-cache-test-'))
const COMMAND = path.join('tools', 'metrics', 'metrics-command.ts')
const HELPER = path.join('tools', 'metrics', 'helper.ts')
const UNRELATED = path.join('scripts', 'unrelated.ts')
const CONFIG = 'eslint.config.js'
const CONFIG_MODULE = path.join('eslint', 'rules', 'code-quality.js')
const READING: CachedReading = { stdout: '{"guards":1}', approvals: [['7.json', 'approved']] }
const written: Array<string> = []

function file(root: string, relative: string, text: string): void {
	mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
	writeFileSync(path.join(root, relative), text)
}

function ruler(): string {
	const root = mkdtempSync(path.join(scratch, 'root-'))

	file(root, COMMAND, "import { helper } from './helper'\n")
	file(root, HELPER, 'export const helper = 1\n')
	file(root, UNRELATED, 'export const unrelated = 1\n')
	file(root, CONFIG, 'export default []\n')
	file(root, CONFIG_MODULE, 'export const code_quality_rules = {}\n')

	return root
}

function commit(): string {
	return randomUUID()
}

function stored(name: string, root: string): string {
	metrics_base_cache.write(name, root, READING)
	written.push(metrics_base_cache.cache_path(name, root))

	return name
}

afterEach(() => {
	for (const target of written.splice(0)) stamp_file.remove_stamp(target)
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('metrics_base_cache.ruler_files', () => {
	it('is the metrics command and what it imports, never an unrelated source', () => {
		const root = ruler()

		expect(metrics_base_cache.ruler_files(root)).toStrictEqual([
			path.join(root, HELPER),
			path.join(root, COMMAND),
		])
	})
})

describe('metrics_base_cache.read — the eslint configuration lines are counted under', () => {
	it.each([CONFIG, CONFIG_MODULE])('has nothing once %s changed', (changed) => {
		const root = ruler()
		const name = stored(commit(), root)

		file(root, changed, 'export default [{ rules: { "max-lines": "off" } }]\n')

		expect(metrics_base_cache.read(name, root)).toBeUndefined()
	})
})

describe('metrics_base_cache.read', () => {
	it('reads back what was written for the same commit and ruler', () => {
		const root = ruler()
		const name = stored(commit(), root)

		expect(metrics_base_cache.read(name, root)).toStrictEqual(READING)
	})

	it('has nothing for another commit', () => {
		const root = ruler()

		stored(commit(), root)

		expect(metrics_base_cache.read(commit(), root)).toBeUndefined()
	})

	it('has nothing once a source the command loads changed', () => {
		const root = ruler()
		const name = stored(commit(), root)

		file(root, HELPER, 'export const helper = 2\n')

		expect(metrics_base_cache.read(name, root)).toBeUndefined()
	})

	it('still answers when only a source the command never loads changed', () => {
		const root = ruler()
		const name = stored(commit(), root)

		file(root, UNRELATED, 'export const unrelated = 2\n')

		expect(metrics_base_cache.read(name, root)).toStrictEqual(READING)
	})

	it('has nothing where the record no longer parses', () => {
		const root = ruler()
		const name = stored(commit(), root)

		stamp_file.replace_text_stamp(metrics_base_cache.cache_path(name, root), '{"stdout":1}')

		expect(metrics_base_cache.read(name, root)).toBeUndefined()
	})
})
