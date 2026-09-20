import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CloneGroup } from './clone-aggregate'
import { clone_scan } from './clone-scan'

// joshuafolkken/kit#2217: the scan reads real source trees, so it is exercised against a temporary
// repository with a copied block, and the report shape is pinned so a caller can read `clean`.

// Seven identical significant lines: above the window size, so the copy is detected.
const COPIED_BLOCK = [
	'export function total(values) {',
	'	let sum = 0',
	'	for (const value of values) {',
	'		sum = sum + value',
	'	}',
	'	return sum',
	'}',
].join('\n')

// A repo-relative path reused across two sites so a cross-repository clone is unambiguous.
const SITE_PATH = 'src/one.ts'

// A temporary directory with no `.git`, so repository discovery adds no siblings and only this tree
// is scanned. Held on an object so the hooks assign a property rather than a top-level binding.
const context = { workspace: '' }

beforeEach(() => {
	context.workspace = mkdtempSync(path.join(tmpdir(), 'clone-scan-'))
	mkdirSync(path.join(context.workspace, 'src'), { recursive: true })
})

afterEach(() => {
	rmSync(context.workspace, { recursive: true, force: true })
})

function write_source(name: string, body: string): void {
	writeFileSync(path.join(context.workspace, 'src', name), body)
}

describe('scan measures duplication in the source tree', () => {
	it('reports no clone when each file is unique', () => {
		write_source('one.ts', COPIED_BLOCK)
		write_source('two.ts', COPIED_BLOCK.replaceAll('total', 'grand_total').replaceAll('sum', 'acc'))

		expect(clone_scan.scan(context.workspace)).toHaveLength(0)
	})

	it('finds a cross-file clone when a block is copied between files', () => {
		write_source('one.ts', COPIED_BLOCK)
		write_source('two.ts', COPIED_BLOCK)

		const clones = clone_scan.scan(context.workspace)

		expect(clones.length).toBeGreaterThan(0)
		expect(clones.every((clone) => clone.category === 'cross-file')).toBe(true)
	})

	it('ignores test files', () => {
		write_source('one.test.ts', COPIED_BLOCK)
		write_source('two.test.ts', COPIED_BLOCK)

		expect(clone_scan.scan(context.workspace)).toHaveLength(0)
	})
})

describe('format_report reads as a verdict then detail', () => {
	it('prints clean when there is nothing to report', () => {
		expect(clone_scan.format_report([])).toBe(clone_scan.CLEAN_VERDICT)
	})

	it('leads with the count and lists each site', () => {
		const group: CloneGroup = {
			hash: 'h',
			category: 'cross-repo',
			sites: [
				{ repo: '/repos/a', file: SITE_PATH, line: 3 },
				{ repo: '/repos/b', file: SITE_PATH, line: 9 },
			],
		}

		const report = clone_scan.format_report([group])

		expect(report).toContain(`${clone_scan.CLONES_PREFIX} 1`)
		expect(report).toContain('[cross-repo]')
		expect(report).toContain('a/src/one.ts:3')
		expect(report).toContain('b/src/one.ts:9')
	})
})
