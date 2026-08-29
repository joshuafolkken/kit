import { git_epic_parse } from './git-epic-parse'
import { EPIC_LABEL } from './issue-labels'
import { parse_json_object_safe } from './parse-json-array'
import { epic_subject_schema } from './schemas'

// The four requirements an epic has to satisfy are otherwise enforced only by an agent reading the
// procedure carefully, and three of the four fail silently: a missing label or a bare `#N` child
// list makes `git-epic-close.ts` skip the epic forever, and prose dependencies make the batch read
// as unordered so a skipped `--add-blocked-by` is never reported. Checking them here reuses
// `git-epic-parse.ts` rather than restating the patterns, so "what the auto-close can read" and
// "what this check accepts" are one definition instead of two that can drift.

interface EpicSubject {
	number: number
	labels: ReadonlyArray<string>
	body: string | undefined
}

interface CheckResult {
	name: string
	is_passing: boolean
	detail: string
}

// The `number,labels,body` read's answer, as the shape every epic writer reads. It lives beside
// the checks because `EpicSubject` is defined here, and each command that wanted one had otherwise
// to restate the unwrapping (joshuafolkken/kit#890).
function parse_epic_subject(raw_json: string | undefined): EpicSubject | undefined {
	if (raw_json === undefined) return undefined

	const parsed = parse_json_object_safe(raw_json, epic_subject_schema)
	if (parsed === undefined) return undefined

	return {
		number: parsed.number,
		labels: (parsed.labels ?? []).map((label) => label.name),
		body: parsed.body,
	}
}

function check_label(subject: EpicSubject): CheckResult {
	const is_passing = subject.labels.includes(EPIC_LABEL)

	return {
		name: 'epic label',
		is_passing,
		detail: is_passing
			? `the \`${EPIC_LABEL}\` label is applied`
			: `add the \`${EPIC_LABEL}\` label — the auto-close only looks at labelled issues`,
	}
}

function format_children(children: ReadonlyArray<number>): string {
	return children.map((child) => `#${String(child)}`).join(', ')
}

function check_task_list(subject: EpicSubject): CheckResult {
	const children = git_epic_parse.parse_task_list_issue_numbers(subject.body)
	const is_passing = children.length > 0

	return {
		name: 'child task list',
		is_passing,
		detail: is_passing
			? `${String(children.length)} child issue(s) tracked: ${format_children(children)}`
			: 'no `- [ ] #N` rows found — a bare `#N` link is not tracked and never auto-closes',
	}
}

function describe_dependencies(state: { has_chain: boolean; has_none_literal: boolean }): string {
	if (state.has_chain) return 'an ordered chain (`#N -> #M`) is declared'
	if (state.has_none_literal) return 'declared as an unordered batch'

	return 'neither `#N -> #M` nor the `None — ...` literal found; prose order is not machine-readable'
}

// An unordered batch is a legitimate state, so the absence of a chain is not a failure by itself.
// What this reports is the ambiguous middle: neither the arrow form nor the literal is present, so
// a reader cannot tell "no order" from "the order was never written down". The literal is compared
// against the constant the generator emits, so the two cannot drift into disagreement.
function check_dependencies(subject: EpicSubject): CheckResult {
	const has_chain = git_epic_parse.has_declared_dependency_chain(subject.body)
	const has_none_literal = git_epic_parse.has_unordered_declaration(subject.body)

	return {
		name: 'dependencies section',
		is_passing: has_chain || has_none_literal,
		detail: describe_dependencies({ has_chain, has_none_literal }),
	}
}

// A cross-repository child cannot be resolved without a different `--repo`, so the auto-close
// deliberately leaves such an epic open. Reporting it here is what turns "stayed open silently"
// into "was told to close it manually".
function check_external_children(subject: EpicSubject): CheckResult {
	const has_external = git_epic_parse.has_external_task_list_entry(subject.body)

	return {
		name: 'auto-close eligibility',
		is_passing: !has_external,
		detail: has_external
			? 'tracks a child in another repository — this epic will not auto-close; close it manually'
			: 'every tracked child is in this repository',
	}
}

function validate_epic(subject: EpicSubject): Array<CheckResult> {
	return [
		check_label(subject),
		check_task_list(subject),
		check_dependencies(subject),
		check_external_children(subject),
	]
}

function is_epic_valid(results: ReadonlyArray<CheckResult>): boolean {
	return results.every((result) => result.is_passing)
}

function format_check_line(result: CheckResult): string {
	return `${result.is_passing ? '✔' : '✖'} ${result.name} — ${result.detail}`
}

function format_check_report(epic_number: number, results: ReadonlyArray<CheckResult>): string {
	const lines = results.map((result) => format_check_line(result))
	const summary = is_epic_valid(results)
		? `✅ Epic #${String(epic_number)} satisfies every requirement.`
		: `❌ Epic #${String(epic_number)} does not satisfy every requirement.`

	return [...lines, '', summary].join('\n')
}

const git_epic_validate = {
	parse_epic_subject,
	validate_epic,
	is_epic_valid,
	format_check_report,
}

export { git_epic_validate }
export type { CheckResult, EpicSubject }
