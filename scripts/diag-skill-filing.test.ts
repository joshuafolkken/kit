import { describe, expect, it } from 'vitest'
import { read_skill_file, SKILL_ENTRY_FILE } from './skill-fixture'

// Split from `diag-skill.test.ts` to keep that file inside its line budget (joshuafolkken/kit#1872).
// The ranking's already-filed-issue rules read one topic and fail for their own reason — a dropped
// filed issue reports the backlog as emptier than it is — so they sit in a suite of their own.
const SKILL_DIRECTORY = '.claude/skills/diag'
const SKILL_PATH = `${SKILL_DIRECTORY}/${SKILL_ENTRY_FILE}`

function read_skill(): string {
	return read_skill_file(SKILL_DIRECTORY)
}

// joshuafolkken/kit#1308. A ranked list that drops what is already filed reports the backlog as
// emptier than it is, and an un-started issue that ranks high is usually the cheapest action there
// is — it needs a run, not a filing.
describe(`${SKILL_PATH} — keeps already-filed issues in the ranking`, () => {
	it.each([
		'**Do not drop an item because it is already filed.**',
		'un-started issue is usually the highest-priority action in the table**',
		'| Un-filed |',
		'| Filed, not started |',
		'| In progress |',
		'| Done |',
		'`fullrun #N`, or `epicrun #E`',
		'Never a second filing',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// GitHub treats `In-Progress` as the same label as `in-progress`, so an eye comparing against the
	// lowercase string reports an in-progress issue as un-started — and the table then tells someone
	// to start a run that is already going.
	it.each([
		'**Read the state from `pnpm josh issue:state <N> [<N> ...]`, never by parsing `gh` output yourself —',
		'the `labels:` line is compared case-insensitively',
	])('reads issue state through the command: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// joshuafolkken/kit#1302: the table reads a state per row, and one call per row paid a process
	// start and a round trip each. Reading them in one call is only safe while each block names its
	// own number — a number that produced no state prints none, so position cannot be trusted.
	it.each([
		"pass the whole table's numbers in one call",
		'**Attribute each block by its `issue:` line, never by position.**',
		'pnpm josh issue:state 1262 1222 1176',
	])('reads the whole table in one call: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	it('routes a filing through the scout before it files', () => {
		expect(read_skill()).toContain('pnpm josh issue:scout "<title>"')
		expect(read_skill()).toContain('pnpm josh epic:bundle <new>')
	})
})
