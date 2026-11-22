// A park option that is a size approval (joshuafolkken/kit#6776): its range in three lines under the
// option — the paths and both axes of `lane-plan-approval.ts`'s json, which `backlog:triage --adopt`
// writes. The lines of one option, read one by one as `run-park-body.ts` walks the option.

interface ParkBound {
	declared: number
	max: number
}

interface ParkApproval {
	paths?: ReadonlyArray<string>
	lines?: ParkBound
	files?: ParkBound
}

type ApprovalRange = Required<ParkApproval>

const APPROVAL_PATHS = /^- 規模承認のパス: ?(\S.*)$/u
const APPROVAL_LINES = /^- 規模承認の行数: ?([1-9]\d*) *\/ *([1-9]\d*)$/u
const APPROVAL_FILES = /^- 規模承認のファイル数: ?([1-9]\d*) *\/ *([1-9]\d*)$/u
const PATH_SEPARATOR = /[\s,、]+/u
const APPROVAL_PARTS = [
	['paths', '- 規模承認のパス: <path> …'],
	['lines', '- 規模承認の行数: <declared> / <max>'],
	['files', '- 規模承認のファイル数: <declared> / <max>'],
] as const

function bound_of(pattern: RegExp, line: string): ParkBound | undefined {
	const [, declared, max] = pattern.exec(line) ?? []

	return max === undefined ? undefined : { declared: Number(declared), max: Number(max) }
}

function paths_of(line: string): ReadonlyArray<string> | undefined {
	const text = APPROVAL_PATHS.exec(line)?.[1]
	const paths = text
		?.split(PATH_SEPARATOR)
		.map((path) => path.replaceAll('`', ''))
		.filter(Boolean)

	return paths?.length === 0 ? undefined : paths
}

// `approval` with the part `line` carries added; unchanged for a line that carries none.
function with_line(approval: ParkApproval | undefined, line: string): ParkApproval | undefined {
	const paths = paths_of(line)

	if (paths !== undefined) return { ...approval, paths }
	const lines = bound_of(APPROVAL_LINES, line)

	if (lines !== undefined) return { ...approval, lines }
	const files = bound_of(APPROVAL_FILES, line)

	return files === undefined ? approval : { ...approval, files }
}

// A size-approval option missing one line of its range: the json it becomes needs every one.
function problem_of(approval: ParkApproval | undefined, name: string): string | undefined {
	if (approval === undefined) return undefined
	const missing = APPROVAL_PARTS.find(([key]) => approval[key] === undefined)

	return missing === undefined ? undefined : `${name} has no "${missing[1]}" line`
}

function is_complete(approval: ParkApproval | undefined): approval is ApprovalRange {
	return APPROVAL_PARTS.every(([key]) => approval?.[key] !== undefined)
}

// The schema lines a size-approval option adds, indented under the option.
function schema_lines(): ReadonlyArray<string> {
	return APPROVAL_PARTS.map(([, line]) => `   ${line}`)
}

const run_park_approval = { is_complete, problem_of, schema_lines, with_line }

export type { ApprovalRange, ParkApproval }
export { run_park_approval }
