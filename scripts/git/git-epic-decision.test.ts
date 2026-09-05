import { describe, expect, it } from 'vitest'
import { git_epic_decision } from './git-epic-decision'
import { git_epic_parse } from './git-epic-parse'

const BLANK = ''
const DECISIONS_HEADING = '## Decisions'
const PROGRESS_HEADING = '## Progress'
const ROW_890 = '- [ ] #890'
const NEW_ENTRY = '### Where #894 goes'
const REASON_LINE = '- 理由: 主題が同じ'
const RECORD = [NEW_ENTRY, BLANK, '- 採用: この epic', REASON_LINE].join('\n')
const EXISTING_ENTRY = '### Where #891 goes'
const CHAIN_LINE = '#890 -> #894'

const WITH_SECTION = [
	PROGRESS_HEADING,
	BLANK,
	ROW_890,
	BLANK,
	DECISIONS_HEADING,
	BLANK,
	EXISTING_ENTRY,
	BLANK,
].join('\n')

const WITHOUT_SECTION = [PROGRESS_HEADING, BLANK, ROW_890, BLANK].join('\n')

const SECTION_BEFORE_ANOTHER = [
	DECISIONS_HEADING,
	BLANK,
	EXISTING_ENTRY,
	BLANK,
	PROGRESS_HEADING,
	BLANK,
	ROW_890,
	BLANK,
].join('\n')

describe('git_epic_decision.append_decision', () => {
	it('appends to the end of an existing section', () => {
		const written = git_epic_decision.append_decision(WITH_SECTION, RECORD)

		expect(written.indexOf(EXISTING_ENTRY)).toBeLessThan(written.indexOf(NEW_ENTRY))
		expect(written).toContain(REASON_LINE)
	})

	// The record has to land inside the section, not after whatever follows it: a reader of
	// `## Decisions` would otherwise not find the entry at all.
	it('keeps the record inside the section when another heading follows', () => {
		const written = git_epic_decision.append_decision(SECTION_BEFORE_ANOTHER, RECORD)
		const lines = written.split('\n')

		expect(lines.indexOf(NEW_ENTRY)).toBeLessThan(lines.indexOf(PROGRESS_HEADING))
	})

	it('creates the section at the end when the body has none', () => {
		const written = git_epic_decision.append_decision(WITHOUT_SECTION, RECORD)

		expect(written).toContain(DECISIONS_HEADING)
		expect(written.indexOf(ROW_890)).toBeLessThan(written.indexOf(DECISIONS_HEADING))
	})

	it('leaves the task list exactly as it was', () => {
		const written = git_epic_decision.append_decision(WITH_SECTION, RECORD)

		expect(git_epic_parse.parse_task_list_issue_numbers(written)).toStrictEqual([890])
	})

	it('drops the record file’s trailing newline rather than growing the section', () => {
		const written = git_epic_decision.append_decision(WITHOUT_SECTION, `${RECORD}\n\n`)

		expect(written.endsWith(REASON_LINE)).toBe(true)
	})
})

describe('git_epic_decision.find_decision_error', () => {
	const CHAIN_RECORD = ['- 経緯: なし', CHAIN_LINE].join('\n')

	it('accepts a record that carries no bare declaration', () => {
		expect(git_epic_decision.find_decision_error(RECORD)).toBeUndefined()
	})

	it('refuses a record that says nothing', () => {
		expect(git_epic_decision.find_decision_error('  \n\n')).toContain('empty')
	})

	// A bare `#A -> #B` line is parsed as a declaration wherever it sits, so a record quoting an order
	// on its own line would add a dependency nobody declared — joshuafolkken/kit#1253's failure mode
	// arriving by a second route.
	// The line is named rather than quoted: the record is a file the caller handed over, so echoing a
	// line of it into stderr would put arbitrary file content in the console.
	it('refuses a record whose line is nothing but a dependency chain, naming the line number', () => {
		const refusal = git_epic_decision.find_decision_error(CHAIN_RECORD)

		expect(refusal).toContain('Line 2')
		expect(refusal).not.toContain(CHAIN_LINE)
	})

	it('accepts the same order quoted inside a sentence', () => {
		const quoted = '- 却下: `#890 -> #894` は主題が違うので宣言しない'

		expect(git_epic_decision.find_decision_error(quoted)).toBeUndefined()
	})

	it('refuses a record that restates the unordered sentence on its own line', () => {
		const record = [
			NEW_ENTRY,
			'None — the children are independent; any execution order works.',
		].join('\n')

		expect(git_epic_decision.find_decision_error(record)).toContain('dependency order')
	})
})

describe('git_epic_decision.format_decision_report', () => {
	it('reports the epic and the children when every comment landed', () => {
		const report = git_epic_decision.format_decision_report({ total: 2, failures: 0 })

		expect(report).toContain('2 child issue(s)')
	})

	it('says the epic entry is intact when a comment could not be posted', () => {
		const report = git_epic_decision.format_decision_report({ total: 2, failures: 1 })

		expect(report).toContain('intact')
	})
})

// The record is judged the way the merged body will be judged: through the same fence mask. A chain
// inside a fenced block is an illustration the parser ignores, so refusing it would send the author
// after advice the fence has already taken.
describe('git_epic_decision.find_decision_error — fenced blocks', () => {
	it('accepts a chain quoted inside a fenced block', () => {
		const fenced = [NEW_ENTRY, '```text', CHAIN_LINE, '```'].join('\n')

		expect(git_epic_decision.find_decision_error(fenced)).toBeUndefined()
	})
})
