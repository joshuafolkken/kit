import {
	AREA_LABEL_PREFIX,
	BREAKING_CHANGE_LABEL,
	BUG_LABEL,
	BUGFIX_LABEL,
	ENHANCEMENT_LABEL,
	has_label_name,
	PRIORITY_CRITICAL_LABEL,
	PRIORITY_HIGH_LABEL,
} from '#scripts/issue/issue-labels'
import type { FiledKind } from '#scripts/run/event/run-event-filed'

// The release category a row is drawn with (joshuafolkken/kit#3577): the categories
// `.github/release.yml` sorts a change into, in its order, each with every label that places an issue
// there. An issue with labels from several takes the first, as the release notes do; one with none is
// an Other Change and draws no kind.

const RELEASE_KINDS: ReadonlyArray<readonly [FiledKind, ReadonlyArray<string>]> = [
	['breaking-change', [BREAKING_CHANGE_LABEL]],
	['enhancement', [ENHANCEMENT_LABEL]],
	['bug', [BUGFIX_LABEL, BUG_LABEL]],
]

// The kinds in the release notes' order — the order a legend names them in.
const KIND_ORDER: ReadonlyArray<FiledKind> = RELEASE_KINDS.map(([kind]) => kind)

function kind_of(labels: ReadonlyArray<string> | undefined): FiledKind | undefined {
	if (labels === undefined) return undefined

	return RELEASE_KINDS.find(([, names]) => names.some((name) => has_label_name(labels, name)))?.[0]
}

// The priority a row is drawn with (joshuafolkken/kit#4383): critical over high, none for the rest.
type BoardPriority = 'critical' | 'high'

const PRIORITIES: ReadonlyArray<readonly [BoardPriority, string]> = [
	['critical', PRIORITY_CRITICAL_LABEL],
	['high', PRIORITY_HIGH_LABEL],
]

function priority_of(labels: ReadonlyArray<string> | undefined): BoardPriority | undefined {
	if (labels === undefined) return undefined

	return PRIORITIES.find(([, name]) => has_label_name(labels, name))?.[0]
}

// The area a row is drawn with (joshuafolkken/kit#8960): the word after `area:` of the first such label,
// so a new area needs no code; none where the issue carries no area.
function area_of(labels: ReadonlyArray<string> | undefined): string | undefined {
	const label = labels?.find((name) => name.toLowerCase().startsWith(AREA_LABEL_PREFIX))
	const area = label?.slice(AREA_LABEL_PREFIX.length)

	return area === '' ? undefined : area
}

// What a row draws from its labels before its title: its release kind, priority and area.
interface RowMarks {
	kind: FiledKind | undefined
	priority: BoardPriority | undefined
	area: string | undefined
}

function marks_of(labels: ReadonlyArray<string> | undefined): RowMarks {
	return { kind: kind_of(labels), priority: priority_of(labels), area: area_of(labels) }
}

const run_board_kind = { area_of, KIND_ORDER, kind_of, marks_of, priority_of }

export type { BoardPriority, RowMarks }
export { run_board_kind }
