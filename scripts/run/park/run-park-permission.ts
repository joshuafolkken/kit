// The permission-line vocabulary of a park option (joshuafolkken/kit#7818): the one place both the
// schema `run:park` prints and the check refusing a value off it are built from. A parent action written
// in free text (an Issue close in prose) is neither a close nor a filing to `backlog:triage --adopt`, so it
// would requeue the lane into the same dead end; the value before any parenthesized note must be one
// of these words.

// The permission a parent adopts with no person and no action of its own.
const AUTO_PERMISSION = 'なし'
// An option needing the parent's own action (filing, closing, editing an Issue): adopting it is not
// taking it, so the lane must not resume before the parent has (joshuafolkken/kit#7001).
const PARENT_PERMISSION = '親'
// A child cannot file an Issue, so an option naming `issue:file` is the parent's filing
// (joshuafolkken/kit#7771): written with the parent permission, and adopted only once the Issue it
// files exists.
const FILING_COMMAND = 'issue:file'
// An option closing the Issue without implementing names `issue:close` (joshuafolkken/kit#7805): the
// parent's `backlog:triage --adopt` closes it as not planned and returns the lane instead of a requeue.
const CLOSE_COMMAND = 'issue:close'
const PERMISSION_VALUES: ReadonlyArray<string> = [
	AUTO_PERMISSION,
	PARENT_PERMISSION,
	'owner コメント',
	'epic 編集',
	'信頼設定',
	'人',
]
const NOTE_START = /[（(]/u
const PARENT_CLOSE = `${PARENT_PERMISSION}（${CLOSE_COMMAND}）`
const PARENT_FILING = `${PARENT_PERMISSION}（${FILING_COMMAND} …）`

function value_of(permission: string): string {
	return permission.split(NOTE_START, 1)[0]?.trim() ?? ''
}

// Why `permission` is off the vocabulary, naming the parent's close and filing forms; `undefined` on it.
function problem_of(name: string, permission: string): string | undefined {
	const value = value_of(permission)

	if (PERMISSION_VALUES.includes(value)) return undefined
	const words = PERMISSION_VALUES.join(' | ')

	return `${name} names "${value}" as its permission; write one of: ${words} — a parent close is "${PARENT_CLOSE}", a parent filing "${PARENT_FILING}"`
}

function schema_lines(): ReadonlyArray<string> {
	return [
		`   - 必要な権限: ${PERMISSION_VALUES.join(' | ')}`,
		`   (closing without implementing: - 必要な権限: ${PARENT_CLOSE})`,
		`   (filing an Issue: - 必要な権限: ${PARENT_FILING})`,
	]
}

const run_park_permission = {
	AUTO_PERMISSION,
	CLOSE_COMMAND,
	FILING_COMMAND,
	PARENT_PERMISSION,
	problem_of,
	schema_lines,
}

export { run_park_permission }
