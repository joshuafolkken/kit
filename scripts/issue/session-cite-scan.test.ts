import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3424: an Issue number reaches a string only through `issue_cite` — `session_cite`
// for what a session reads, `issue_cite.plain_for` for what GitHub renders or a program reads. A bare
// `#${…}` assembled anywhere else is how an unlinked `#N` slipped into josh's session output, and the
// Stop guard then sent the reply that copied it back for a second turn.
//
// Refusing the template alone would leave the plain form free to print a bare `#N` straight to the
// session, so `plain_for` takes the reason its text stays plain as a required argument: the call
// declares why it is not session-facing, and the type checker refuses one that does not
// (joshuafolkken/kit#6807, joshuafolkken/kit#6810).

const SCRIPTS_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BARE_TEMPLATE = '#${'
// The files allowed a `#${…}`: the single place the bare Issue form is assembled, and the files whose
// `#` marks something that is not an Issue number at all.
const EXEMPT = new Set([
	path.join('issue', 'issue-cite.ts'),
	// A message index standing in for a missing message id.
	path.join('delegation', 'investigation-reads.ts'),
	path.join('rules', 'rule-value.ts'),
	path.join('time-runtime', 'time-round-trips.ts'),
	// A rank in a table.
	path.join('package', 'package-scout-format.ts'),
	// A URL fragment.
	path.join('safe-chain', 'preinstall-command.ts'),
])

function is_source(file: string): boolean {
	return file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('-fixture.ts')
}

function read_source(file: string): string {
	return readFileSync(path.join(SCRIPTS_ROOT, file), 'utf8')
}

function bare_sites(file: string): Array<string> {
	const lines = read_source(file).split('\n')

	return lines
		.map((line, index) => ({ line, site: `${file}:${String(index + 1)}` }))
		.filter(({ line }) => line.includes(BARE_TEMPLATE))
		.map(({ site }) => site)
}

function sources(): Array<string> {
	const files = readdirSync(SCRIPTS_ROOT, { recursive: true, encoding: 'utf8' })

	return files.filter((file) => is_source(file))
}

function scanned_sources(): Array<string> {
	return sources().filter((file) => !EXEMPT.has(file))
}

describe('Issue numbers in scripts/ go through issue_cite', () => {
	it('assembles no bare `#${…}` outside issue-cite.ts', () => {
		expect(scanned_sources().flatMap((file) => bare_sites(file))).toStrictEqual([])
	})

	it('scans the sources it guards', () => {
		expect(scanned_sources()).toContain(path.join('lane', 'lane-occupancy.ts'))
	})
})
