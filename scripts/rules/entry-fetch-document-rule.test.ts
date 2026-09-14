import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claude_settings_fixture } from '#scripts/claude/claude-settings-fixture'
import { entry_read_set } from '#scripts/document/entry-read-set'
import { read_set_cli } from '#scripts/document/read-set-cli'
import { afterAll, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1797 gave the entry read two properties this suite guards: the point-of-use files
// stay out of every entry's read set, and the Bash output cap the fetch cannot exceed is read from
// the settings rather than restated. joshuafolkken/kit#1959 removed what used to sit beside them —
// the §1 "how to fetch" and "read at the point of use" prose that joshuafolkken/kit#1925 trims out of
// the always-read skill. Both properties are held here structurally, off `entry_read_set` and the
// settings file, so trimming that prose leaves them untouched.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CAP_KEY = 'BASH_MAX_OUTPUT_LENGTH'
const ENV_KEY = 'env'
const FULLRUN = 'fullrun'
const NOTHING = 0

const OUTPUT_BOUNDS_DOC = fileURLToPath(
	new URL('../../prompts/collaboration-workflow/output-bounds.md', import.meta.url),
)

// **The subsection table's rows parse as entry rows, and one edit is all it takes.** Its first column
// holds a document name, from which `ENTRY_KEYWORD` reads `followup`; until the parse learned to stop
// at the subsection, the only thing keeping that out of the keyword set was the second column
// happening to carry no `.md`. This fixture is that column carrying one — the scenario the live
// document is one edit away from, and the one a test against the live document cannot reach.
const SUBSECTION_TABLE_SKILL = `## 1. Which file to read

| Typed keyword | Read |
| ------------- | ---- |
| \`demo\` | \`demo.md\` |

### Three documents are read at the point of use, not at the entry

| Document | Read it when |
| -------- | ------------ |
| \`followup.md\` | Before issuing \`pnpm josh followup\` (\`followup.md\` → "When it runs") |
`

const temporary_roots: Array<string> = []

function fixture_root(skill: string, settings: string): string {
	const root = mkdtempSync(path.join(tmpdir(), 'read-set-'))
	const skill_directory = path.join(root, entry_read_set.SKILL_DIRECTORY)

	temporary_roots.push(root)
	mkdirSync(skill_directory, { recursive: true })
	writeFileSync(path.join(skill_directory, entry_read_set.SKILL_FILE), skill, 'utf8')
	writeFileSync(path.join(root, '.claude', 'settings.json'), settings, 'utf8')

	return root
}

function cap_of(settings: string): number {
	return entry_read_set.bash_output_cap(fixture_root(SUBSECTION_TABLE_SKILL, settings))
}

afterAll(() => {
	for (const root of temporary_roots) rmSync(root, { force: true, recursive: true })
})

function declared_cap(): number {
	return Number(claude_settings_fixture.load_settings().env[CAP_KEY])
}

function printed_report(): string {
	const lines: Array<string> = []
	const spy = vi.spyOn(console, 'info').mockImplementation((text: unknown) => {
		lines.push(String(text))
	})

	read_set_cli.run([FULLRUN])
	spy.mockRestore()

	return lines.join('\n')
}

describe(`${SKILL} keeps the point-of-use documents out of the entry read`, () => {
	// The rule is which documents are read later, not the prose that explains why. It is held off the
	// `entry_read_set.POINT_OF_USE_FILES` constant, so the §1 explanation being trimmed changes nothing.
	it('leaves every point-of-use document out of the read set of every entry point', () => {
		const root = process.cwd()

		for (const entry of entry_read_set.entries(root)) {
			const { files } = entry_read_set.read_set(root, entry)

			for (const later of entry_read_set.POINT_OF_USE_FILES) expect(files).not.toContain(later)
		}
	})
})

// **The cap is read, never restated.** A number copied into the measuring command would be a second
// declaration of it, and would drift the first time the settings file changed — which is how the
// report would come to mark a file `cat`-able that a `cat` truncates.
describe('the entry table parse stops at the section’s own subsection', () => {
	// Asserted against a fixture rather than the live document: in `SKILL.md` the trigger table's
	// second column carries no `.md`, so `push_row`'s own guard suppresses these rows and a test
	// there passes with the stop deleted.
	it('reads no keyword out of a subsection table that names a document', () => {
		const root = fixture_root(SUBSECTION_TABLE_SKILL, '{}')

		expect(entry_read_set.entries(root)).toStrictEqual(['demo'])
	})
})

describe('the fetch cap the report prints', () => {
	it('is the one the distributed settings file declares', () => {
		expect(entry_read_set.bash_output_cap(process.cwd())).toBe(declared_cap())
	})

	it('is the number the canonical topic document argues for', () => {
		const topic = readFileSync(OUTPUT_BOUNDS_DOC, 'utf8')

		expect(topic).toContain(`"${CAP_KEY}": "${String(declared_cap())}"`)
	})

	it('reads the declared value out of the env block', () => {
		expect(cap_of(`{"${ENV_KEY}":{"${CAP_KEY}":"1234"}}`)).toBe(1234)
	})

	// The regular expression this replaced took the first match anywhere in the file, so a hook
	// command naming the variable won over the declaration the harness actually reads.
	it('is not taken from an earlier mention outside the env block', () => {
		const settings = `{"hooks":[{"command":"${CAP_KEY}=99"}],"${ENV_KEY}":{"${CAP_KEY}":"1234"}}`

		expect(cap_of(settings)).toBe(1234)
	})

	// A checkout with no settings file still answers, with the harness's own default rather than zero:
	// a cap of zero would mark every file unreadable, and a cap of infinity none.
	it.each([
		['no settings file', undefined],
		['a file that does not parse', 'not json at all'],
		['an env block with no declaration', `{"${ENV_KEY}":{}}`],
		['a declaration that is not a number', `{"${ENV_KEY}":{"${CAP_KEY}":"none"}}`],
		['a declaration of zero', `{"${ENV_KEY}":{"${CAP_KEY}":"0"}}`],
	])('falls back to the harness default given %s', (_label, settings) => {
		const cap =
			settings === undefined
				? entry_read_set.bash_output_cap('/nonexistent-root')
				: cap_of(settings)

		expect(cap).toBe(entry_read_set.HARNESS_DEFAULT_CAP_CHARS)
	})
})

describe('josh read:set carries the rule beside the figures', () => {
	const report = printed_report()

	it('states the fetch rule under the report', () => {
		expect(report).toContain(read_set_cli.FETCH_RULE)
	})

	it('names the cap the truncation happens at', () => {
		expect(report).toContain(declared_cap().toLocaleString('en-US'))
	})

	it('marks every file the Bash cap cannot deliver whole', () => {
		const { files } = entry_read_set.costed(process.cwd(), FULLRUN)
		const over = files.filter((one) => one.cost.bytes > declared_cap())

		expect(over.length).toBeGreaterThan(NOTHING)
		for (const one of over) expect(report).toMatch(new RegExp(`${one.file}.*Read`, 'u'))
	})

	// Listed rather than dropped: a saving with nowhere for the cost to have gone is not a measurement.
	it('lists what left the entry read instead of hiding it', () => {
		expect(report).toContain(read_set_cli.POINT_OF_USE_LABEL)
		for (const later of entry_read_set.POINT_OF_USE_FILES) expect(report).toContain(later)
	})
})
