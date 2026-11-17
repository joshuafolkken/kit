import path from 'node:path'
import { PORCELAIN_FLAG, UNTRACKED_FILES_FLAG } from '#scripts/git/constants'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { session_language } from '#scripts/josh/session-language'
import { lane_environment } from '#scripts/lane/lane-environment'
import { lane_paths } from '#scripts/lane/lane-paths'
import { lane_registry } from '#scripts/lane/lane-registry'

// A park from inside a lane keeps that lane and its seat, so the park comment names the lane
// directory, the held seat and the way to give it back (joshuafolkken/kit#5840). The child wrote the
// three by hand on every park; the park writes them now.
//
// The note also carries the lane's tree — its HEAD and uncommitted change count — so a re-park after
// an adopted option tells an unchanged tree from a moved one (joshuafolkken/kit#7820): `tree_of`
// reads back what `tree_lines` wrote.

const UNKNOWN_SEAT = 'unknown'
const LINE_SEPARATOR = '\n'
const TREE_LINE = /^- (?:ツリー|Tree): (?<head>\S+) · (?:変更|changes) (?<changes>\d+)$/mu

interface LaneTree {
	head: string
	changes: number
}

function seat_of(directory: string): string {
	const content = lane_registry.read_environment(directory)
	const seat = content === undefined ? undefined : lane_environment.read_lane_seat(content)

	return seat === undefined ? UNKNOWN_SEAT : String(seat)
}

// The lane's HEAD and its uncommitted changes counted as `tree:status` counts them; `undefined` when
// git cannot read either.
function tree_at(directory: string): LaneTree | undefined {
	const options = git_spawn_sync.located(directory)
	const head = git_spawn_sync.read(['rev-parse', '--short', 'HEAD'], options)
	const status = git_spawn_sync.read(['status', PORCELAIN_FLAG, UNTRACKED_FILES_FLAG], options)

	if (head === undefined || status === undefined) return undefined

	return { head, changes: status.split(LINE_SEPARATOR).filter((line) => line !== '').length }
}

function tree_lines(directory: string, is_japanese: boolean): ReadonlyArray<string> {
	const tree = tree_at(directory)

	if (tree === undefined) return []
	const changes = String(tree.changes)

	return [
		is_japanese
			? `- ツリー: ${tree.head} · 変更 ${changes}`
			: `- Tree: ${tree.head} · changes ${changes}`,
	]
}

// The lines are for a person to read, so they follow the session language; the directory and the
// `lane:close` command stay as they are (joshuafolkken/kit#7667).
function note_lines(issue: string, directory: string, is_japanese: boolean): ReadonlyArray<string> {
	const lane = `\`${directory}\``
	const seat = seat_of(directory)
	const close = `\`pnpm josh lane:close ${issue}\``

	if (is_japanese) {
		return [
			`- レーンのディレクトリ: ${lane}`,
			`- レーンを残す間、席 ${seat} は確保したまま`,
			`- 返却: ${close}`,
		]
	}

	return [
		`- Lane directory: ${lane}`,
		`- Seat ${seat} stays held while the lane is kept`,
		`- Give it back: ${close}`,
	]
}

function lane_note(issue: string, directory: string): string {
	const is_japanese = session_language.is_japanese(session_language.resolve_session_lang().lang)
	const lines = [
		...note_lines(issue, directory, is_japanese),
		...tree_lines(directory, is_japanese),
	]

	return ['---', ...lines].join(LINE_SEPARATOR)
}

// `body` unchanged outside a lane.
function with_lane_note(body: string, directory: string): string {
	const issue = lane_paths.lane_issue_of(directory)

	if (issue === undefined) return body

	const lane = lane_paths.checkout_of(path.resolve(directory))

	return `${body.trimEnd()}\n\n${lane_note(issue, lane)}\n`
}

// The tree a park body's lane note recorded, as `<head> · <changes>` in either language; `undefined`
// for a body with none (a park outside a lane, or one written before the note carried it).
function tree_of(body: string): string | undefined {
	const match = TREE_LINE.exec(body)

	if (match?.groups === undefined) return undefined

	return `${match.groups['head'] ?? ''} · ${match.groups['changes'] ?? ''}`
}

const run_park_lane = { tree_of, with_lane_note }

export { run_park_lane }
