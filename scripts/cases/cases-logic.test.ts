import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cases } from './cases-logic'

// joshuafolkken/kit#2246: `cases` reads the changed paths and answers which I/O boundaries they cross
// and the abnormal cases each owes. Fixtures are written to a temp directory so the answers do not
// ride on the current contents of real repository files.

const directory = mkdtempSync(path.join(tmpdir(), 'cases-'))

function fixture(name: string, content: string): string {
	const target = path.join(directory, name)

	writeFileSync(target, content, 'utf8')

	return target
}

const NETWORK_PATH = fixture('net.ts', 'const r = await fetch(url)\n')
const PROCESS_PATH = fixture('proc.ts', "import { spawn } from 'node:child_process'\n")
const FS_PATH = fixture('io.ts', "import { readFileSync } from 'node:fs'\n")
const INERT_PATH = fixture(
	'pure.ts',
	'export function add(a: number, b: number) { return a + b }\n',
)
const MISSING_PATH = path.join(directory, 'missing.ts')

afterAll(() => {
	rmSync(directory, { recursive: true, force: true })
})

describe('cases.boundaries_in', () => {
	it('answers network for a fetch call', () => {
		expect(cases.boundaries_in([NETWORK_PATH])).toEqual(['network'])
	})

	it('answers process for a child_process import', () => {
		expect(cases.boundaries_in([PROCESS_PATH])).toEqual(['process'])
	})

	it('answers fs for a filesystem import', () => {
		expect(cases.boundaries_in([FS_PATH])).toEqual(['fs'])
	})

	it('answers no boundary for a change that crosses none', () => {
		expect(cases.boundaries_in([INERT_PATH])).toEqual([])
	})

	it('reports each crossed boundary once across many paths', () => {
		expect(cases.boundaries_in([NETWORK_PATH, PROCESS_PATH, FS_PATH])).toEqual([
			'network',
			'process',
			'fs',
		])
	})

	it('treats an unreadable path as crossing no boundary', () => {
		expect(cases.boundaries_in([MISSING_PATH])).toEqual([])
	})
})

describe('cases.boundaries_in — prose and call forms', () => {
	it('does not read a bare URL in text as a network boundary', () => {
		const document_path = fixture('doc.md', 'See https://example.com for details\n')

		expect(cases.boundaries_in([document_path])).toEqual([])
	})

	it('does not read bare process or fs verbs in prose as boundaries', () => {
		const prose_path = fixture('prose.md', 'exec the plan and rm the old files\n')

		expect(cases.boundaries_in([prose_path])).toEqual([])
	})

	it('answers process for a spawn call and fs for a readdir call', () => {
		const call_path = fixture('calls.ts', 'spawn(cmd)\nreaddir(dir)\n')

		expect(cases.boundaries_in([call_path])).toEqual(['process', 'fs'])
	})
})

describe('cases.cases_for', () => {
	it('names the mandatory abnormal cases of a boundary', () => {
		expect(cases.cases_for(['network'])).toContain('タイムアウト')
		expect(cases.cases_for(['network'])).toContain('非200')
	})

	it('owes connection-drop at the network boundary — the transport failure of #2317 (#2355)', () => {
		expect(cases.cases_for(['network'])).toContain('接続断')
	})

	it('returns nothing for no boundaries', () => {
		expect(cases.cases_for([])).toEqual([])
	})
})

describe('cases.VOCABULARY', () => {
	it('is exactly the three boundaries plus none', () => {
		expect(cases.VOCABULARY).toEqual(['network', 'process', 'fs', cases.NONE])
	})
})
