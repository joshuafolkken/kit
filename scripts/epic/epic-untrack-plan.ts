import { epic_add_body } from './epic-add-body'
import { epic_chains } from './epic-chains'
import { epic_graph } from './epic-graph'
import { epic_parse, type DependencyLink } from './epic-parse'
import type { EpicReading } from './epic-read'
import { epic_sections } from './epic-sections'
import { epic_shape } from './epic-shape'
import { epic_validate } from './epic-validate'

interface UntrackPlan {
	body: string
	removed: ReadonlyArray<DependencyLink>
}

type UntrackOutcome = { plan: UntrackPlan } | { error: string }

function touches(link: DependencyLink, children: ReadonlySet<number>): boolean {
	return children.has(link.blocker) || children.has(link.blocked)
}

function without_rows(body: string, children: ReadonlySet<number>): string {
	const lines = epic_sections.to_body_lines(body)
	const removed = new Set(
		epic_sections.find_indices(lines, (line) =>
			epic_parse.parse_task_list_issue_numbers(line).some((child) => children.has(child)),
		),
	)

	return lines.lines.filter((_line, index) => !removed.has(index)).join('\n')
}

function rewrite(
	reading: EpicReading,
	children: ReadonlySet<number>,
): { body: string } | { error: string } {
	const chains = epic_parse.parse_dependency_chains(reading.subject.body)
	const removed = epic_chains.links_of(chains).filter((link) => touches(link, children))

	return epic_add_body.rewrite_body({
		body: without_rows(reading.subject.body ?? '', children),
		placed: [],
		chains_after: epic_chains.remove_links(chains, removed),
		does_clear_declaration: removed.length > 0,
	})
}

function build_plan(reading: EpicReading, children: ReadonlyArray<number>): UntrackOutcome {
	const tracked = epic_parse.parse_task_list_issue_numbers(reading.subject.body)
	const error = epic_shape.find_subject_error(
		{ ...reading.subject, epic_number: reading.subject.number },
		tracked,
	)
	if (error !== undefined) return { error }
	const selected = new Set(children)
	const rewritten = rewrite(reading, selected)
	if ('error' in rewritten) return rewritten
	const results = epic_validate.validate_epic({ ...reading.subject, body: rewritten.body })

	if (!epic_validate.is_epic_valid(results)) {
		return { error: 'The remaining body would fail epic:check; nothing was written.' }
	}

	return {
		plan: {
			body: rewritten.body,
			removed: epic_graph
				.undeclared_relations([], reading.recorded, reading.repo)
				.filter((link) => touches(link, selected)),
		},
	}
}

const epic_untrack_plan = { build_plan }

export { epic_untrack_plan }
