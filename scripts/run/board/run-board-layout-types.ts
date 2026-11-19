import type { Declared } from '#scripts/backlog/backlog-overlap'
import type { PlanContext } from '#scripts/backlog/backlog-plan'
import type { WavePlan } from '#scripts/backlog/backlog-waves'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { FiledKind } from '#scripts/run/event/run-event-filed'
import type { BoardPriority } from './run-board-kind'
import type { PauseRead } from './run-board-pause'
import type { RetryClock } from './run-board-retry-wait'
import type { ItemState, ItemStatus } from './run-board-status'

// The board layout's row types (`run-board-layout.ts`), which every board module reads.

interface BoardPlan extends PauseRead, RetryClock {
	decision_questions?: ReadonlyMap<number, string> | undefined
	decision_waits?: ReadonlyMap<number, string> | undefined
	is_backlog_live?: boolean | undefined
	human_merge_prs?: ReadonlyMap<number, number> | undefined
	// The same snapshot's worker identities that the header counts as occupied seats.
	occupied_lanes?: ReadonlyArray<string> | undefined
	waves: WavePlan
	// Which opted-in epic tracks which child (`Plan.tracked`).
	tracked: ReadonlyMap<number, number>
	context: PlanContext
	// Each issue's label names as the open listing read them, so a running row is drawn as its labels
	// say it stopped.
	labels: ReadonlyMap<number, ReadonlyArray<string>>
	// The paths each issue's body declares (`Plan.scope.declared`), which a waiting row is checked
	// against a running one by; a plan read without them checks none.
	declared?: Declared | undefined
	// The issues the classifier withholds for a person (`EpicNextResult.blocked_on_people`) — a blocker
	// this run will not finish among them — whose waiting row leads with 🙋.
	withheld?: ReadonlySet<number> | undefined
}

// Why a waiting row waits, or the stage its lane's launch is at, as one value its row only draws
// (joshuafolkken/kit#4288): the icon it leads with in place of ⏳, the condition column's value, and
// what follows its title. A parked, withdrawn or stalled row draws its tail alone.
interface RowReason {
	evidence_url?: string | undefined
	icon?: string | undefined
	// The condition column's figure — a lane count, a memory reading, a start time.
	value?: string | undefined
	// The issues the wait names, in place of a figure: the first in the condition column, with
	// `+<rest>` where the rest follow its title.
	issues?: ReadonlyArray<string> | undefined
	tail?: string | undefined
	// The pull request the value and tail end on, which the board links where it draws the number
	// whole (joshuafolkken/kit#7181).
	pr?: number | undefined
	// When the row entered a stage, where the reason is one — the condition column counts how long it
	// has stood there from it.
	since_ms?: number | undefined
	// The start time its body declares and the row waits on, which orders the 📅 rows.
	not_before_ms?: number | undefined
}

// What a waiting child's row says, given the blockers still standing for it; `undefined` says nothing.
type ReasonOf = (child: EpicChild, waits: ReadonlyArray<string>) => RowReason | undefined

interface BoardRow {
	number: number
	title: string | undefined
	// The release category its labels place it in (joshuafolkken/kit#3577), none for an Other Change.
	kind: FiledKind | undefined
	// The priority label it carries (joshuafolkken/kit#4383), none for a normal one.
	priority?: BoardPriority | undefined
	state: ItemState
	status: ItemStatus | undefined
	// The standing blockers this row still waits on, as the plan names them.
	waits: ReadonlyArray<string>
	// Why the row waits beyond its blockers (`run-board-reason.ts`), or why a parked or withdrawn row
	// ended; any other row the run has touched has none.
	reason?: RowReason | undefined
	// An earlier run's lane (`run-board-earlier.ts`): drawn as its status says, marked 🧳 after its title.
	is_earlier?: boolean | undefined
	// A touched child carrying `run:solo`, which nothing else starts beside while it runs.
	is_solo?: boolean | undefined
}

type QueuedEntry =
	| { kind: 'row'; row: BoardRow }
	| { kind: 'epic'; epic: number; title: string | undefined; rows: Array<BoardRow> }

interface BoardLayout {
	active: ReadonlyArray<BoardRow>
	queued: ReadonlyArray<QueuedEntry>
	people: ReadonlyArray<BoardRow>
	unreached: ReadonlyArray<BoardRow>
	// The earlier run's lanes that still hold a place under the limit, and the lanes with no record —
	// drawn after the run's own lanes, and no row the header counts.
	earlier?: ReadonlyArray<BoardRow> | undefined
	// The root checkout's single run beside the run, drawn above its lanes and no row the header counts.
	root?: { name: string; row: BoardRow } | undefined
}

// What an active row is named and classified by — each issue's title and labels.
interface RowRead extends PauseRead {
	decision_questions?: ReadonlyMap<number, string> | undefined
	is_backlog_live?: boolean | undefined
	titles: ReadonlyMap<number, string>
	labels: ReadonlyMap<number, ReadonlyArray<string>>
	// Each planned child's standing blockers, which a touched stalled row waits on in place of its retry.
	waits?: ReadonlyMap<number, ReadonlyArray<string>> | undefined
}

interface Overlay {
	plan: BoardPlan
	statuses: ReadonlyMap<number, ItemStatus>
}

export type { BoardLayout, BoardPlan, BoardRow, Overlay, QueuedEntry, ReasonOf, RowRead, RowReason }
