import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'
import { claude_settings_fixture } from './claude-settings-fixture'
import { entry_read_set } from './document/entry-read-set'
import { read_set_cli } from './document/read-set-cli'

// joshuafolkken/kit#1797. Two halves of one entry read, both measured on `fullrun #1783`.
//
// **The fetch was truncating and nobody could tell.** The entry issued `cat fullrun.md
// split-assessment.md` and `cat chain-rule.md followup.md latest-gate.md eval-gate.md`; both
// exceeded the Bash output cap, so 1,725 and 2,034 characters of preview came back and five of the
// files were then read again individually. Two wasted requests, and about 3.7k tokens of dead
// preview resident for the rest of the run. **Reading the preview and carrying on is the failure,
// not the workaround** — it produces a run that has read its instructions partly and cannot say
// which part — so the fix is a fetch that cannot truncate, stated where the entry reads it and
// printed beside the figures by the command that measures them.
//
// **And three documents were being read half an hour before their first use.** `eval-gate.md` cost
// 6,420 tokens and was never used at all, because `pnpm josh eval:scope` answered `skip`;
// `followup.md` cost 10,326 and rode 55 requests before `pnpm josh followup` was issued. They are
// read at the point of use now — whole, in the same turn, by the command that has to obey them —
// which is the opposite of the "read it later" demotion joshuafolkken/kit#1344 and
// joshuafolkken/kit#1460 each measured firing exactly never. This suite pins that distinction,
// because a later reword that softened it into "read it when convenient" would pass everything else.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CAP_KEY = 'BASH_MAX_OUTPUT_LENGTH'
const FULLRUN = 'fullrun'
const NOTHING = 0
const STATES_CASE = 'states: %j'

const OUTPUT_BOUNDS_DOC = fileURLToPath(
	new URL('../prompts/collaboration-workflow/output-bounds.md', import.meta.url),
)

const FETCH_MARKERS: ReadonlyArray<string> = [
	'### The fetch is one `Read` call per file',
	'Fetch each file above with one `Read` call of its own — never `cat`, and never two of them in one command',
	'every document in this set is larger than that cap',
	// The refusal the Issue is emphatic about: a preview is not a shorter read, it is a partial one.
	'Reading the preview and carrying on is refused',
	'a fetch that cannot truncate, never a judgement about whether enough of it came back',
]

const POINT_OF_USE_MARKERS: ReadonlyArray<string> = [
	'### Three documents are read at the point of use, not at the entry',
	'Each is fetched **in full, in the same turn, by the step that has to obey it**',
	// The half that separates this from a demotion, kept verbatim because it is the half a reword loses.
	'This is "read it at the point of use", not "read it later", and the difference is what makes it safe',
	'nothing here is demoted, deferred past its own call, or summarized',
]

const POINT_OF_USE_TRIGGERS: ReadonlyArray<[string, string]> = [
	['latest-gate.md', '`pnpm josh latest:scope` answers `required`'],
	['eval-gate.md', '`pnpm josh eval:scope` answers `required`'],
	['followup.md', 'Before issuing `pnpm josh followup`'],
]

function skill_text(): string {
	return read_unwrapped(SKILL)
}

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

describe(`${SKILL} states how the entry read is fetched`, () => {
	it.each(FETCH_MARKERS)(STATES_CASE, (marker) => {
		expect(skill_text()).toContain(marker)
	})
})

describe(`${SKILL} names the documents read at the point of use`, () => {
	it.each(POINT_OF_USE_MARKERS)(STATES_CASE, (marker) => {
		expect(skill_text()).toContain(marker)
	})

	// The trigger is a named command in every row, so nothing about *when* is left to judgement — the
	// failure mode a "read it later" rule has and this one must not.
	it.each(POINT_OF_USE_TRIGGERS)('names %s beside its trigger', (file, trigger) => {
		expect(skill_text()).toContain(`\`${file}\``)
		expect(skill_text()).toContain(trigger)
	})

	it('leaves all three out of the read set of every entry point', () => {
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
describe('the fetch cap the report prints', () => {
	it('is the one the distributed settings file declares', () => {
		expect(entry_read_set.bash_output_cap(process.cwd())).toBe(declared_cap())
	})

	it('is the number the canonical topic document argues for', () => {
		const topic = readFileSync(OUTPUT_BOUNDS_DOC, 'utf8')

		expect(topic).toContain(`"${CAP_KEY}": "${String(declared_cap())}"`)
	})

	// A checkout with no settings file still answers, with the harness's own default rather than zero:
	// a cap of zero would mark every file unreadable, and a cap of infinity none.
	it('falls back to the harness default where nothing is declared', () => {
		expect(entry_read_set.bash_output_cap('/nonexistent-root')).toBe(
			entry_read_set.HARNESS_DEFAULT_CAP_CHARS,
		)
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
