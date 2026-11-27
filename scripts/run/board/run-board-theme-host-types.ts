// The shapes the run:board theme host shares with every theme it draws (joshuafolkken/kit#8917): the
// grid a theme draws into, the state of the three typed places it reads, the board's layout and the
// helpers a theme is handed. Ported from the confirmed theme demo (`fixed-v21-theme-demo.mjs`).

// A cell while a frame is drawn: its character and its style — a role key ('body', 'rule:dim',
// 'hi:bold') the theme's colors paint, or raw SGR escapes starting with ESC.
type Cell = [string, string]
type Grid = Array<Array<Cell>>
// A finished cell: its character, its painted SGR, and its background wash as 'r;g;b' ('' for none).
type FinalCell = [string, string, string]
type FinalGrid = Array<Array<FinalCell>>

interface Point {
	y: number
	x: number
}

// A typed place: its row and the columns from `x` up to `end`.
interface Span {
	y: number
	x: number
	end: number
}

// Columns of the header a NOTICE may borrow, all three of its rows.
interface Area {
	x: number
	w: number
}

interface Spot {
	y: number
	x: number
	w: number
}

interface Box {
	x: number
	y: number
	w: number
	h: number
}

// One message of a typed place: the tick it starts on, its text, the progress line's icon, and
// (for a NOTICE's effect) a fixed length in ticks in place of its text's.
interface TimelineMessage {
	start: number
	text: string
	icon?: string
	ticks?: number
}

// What happens on the board, in ticks: the notices, the progress lines and the lanes added. `level` is
// the board's real alert level (5 calm .. 1), given only while no demo, part or event plays: a theme
// whose level indicator carries a level shows it in place of its own.
interface ThemeTimeline {
	notice: Array<TimelineMessage>
	progress: Array<TimelineMessage>
	row: Array<TimelineMessage>
	level?: number
}

// A timeline with the ticks all its text takes to type.
interface ThemeEvent extends ThemeTimeline {
	total: number
}

type ChannelName = 'notice' | 'progress' | 'row'

// One place's typed state: which message, how much of it shows, and the ticks since it finished.
interface Channel {
	name: ChannelName
	index: number
	is_typing: boolean
	length: number
	total: number
	cooled: number
	start: number
	span: Span
	text: string
	icon: string | undefined
}

// Everything an effect reads: the three channels, whether any types, the one that finished last.
interface ThemeState {
	tick: number
	event: ThemeEvent
	notice: Channel
	notice_text: Channel
	progress: Channel
	row: Channel
	all: Array<Channel>
	busy: boolean
	latest: ChannelName | undefined
	since: number
	last_start: number
	busy_ticks: number
	done: number
}

// The board's places, found from its frame. `w` and `h` are the columns and rows drawn; `edge` is
// the board's own right edge (its rules end there).
interface ThemeLayout {
	h: number
	w: number
	edge: number
	px: number
	pw: number
	area_top: number
	area_end: number
	column_x: number
	pins_x: number
	notice: Span
	progress: Span
	row: Span
	row_text: string
	lane_rows: Array<number>
	gap_rows: Array<number>
	issue_x: number
	new_lane: string
	level_spot: Spot
	head_left: Area
	head_right: Area
	head_top: Area
	last_text_row: number
	sign_x: number
	head_colons: Array<Point>
	lane_spin_x: number
	// The lane rows kit turns a spinner on — the running lanes; a row with a mark (`OK`, …) keeps it.
	lane_spin_rows: Array<number>
	// joshuafolkken/kit#8917: kit's other spinners — off the signs column and the lanes, as the queued
	// rule's — which turn the theme's glyphs too, never the base's.
	other_spins?: Array<Point>
	screen_cx: number
	screen_cy: number
	// joshuafolkken/kit#8917: the LANES section's rule row, open, folded or with no lane; none off screen.
	lanes_rule?: number | undefined
	// joshuafolkken/kit#8917: the header's estimate, now and start always as `MM-DD HH:MM` — the header
	// drops a date all three share; none where the base is a captured frame (its clocks are dated).
	dated_clocks?: Array<string> | undefined
}

// A stretch letters type over, in ms from the part's start.
interface TypedSpan {
	from_ms: number
	to_ms: number
}

// joshuafolkken/kit#8917: the letters a part types on screen — the trill sounds over each span, and the
// typed end once at `typed_ms` (none where it sounds none).
interface PartTyping {
	spans: ReadonlyArray<TypedSpan>
	typed_ms: number | undefined
}

// An opening or an ending: played once over the theme's idle board, `tick` counting from 0. `typing`
// is the letters it types, where it types any outside the theme's intro (`run-board-theme-defs.ts`).
interface ThemePart {
	ticks: number
	note: string
	draw: (grid: Grid, tick: number, s: ThemeState) => void
	typing?: PartTyping
}

type PartName = 'opening' | 'ending'

// Each role's color as 'r;g;b'. A type alias, so the colors read as a table keyed by any role. The
// marks that stand in for icons carry three roles more a theme may color — `human` (waiting on a
// person), `idle` and `info` — each drawn in `body` where the theme gives it none.
type ThemeColors = Record<
	'body' | 'hi' | 'notice' | 'ok' | 'red' | 'rule' | 'type' | 'warn',
	string
> &
	Partial<Record<'human' | 'idle' | 'info', string>>

// The demo's event keys: idle, progress, row, notice, and every effect in turn.
type EventKey = 'a' | 'i' | 'n' | 'p' | 'r'

// A theme: its look and its drawing. `board` names the board top left; `capitals` raises every
// letter; `spinner` is its glyphs (else the host's for its `name`); `colons` blinks the header
// clocks' colons; `background` washes behind a cell ('r;g;b', or undefined for none); `lasts` gives
// an event more ticks than the host's own.
interface ThemeModule {
	name: string
	board?: string
	capitals?: boolean
	spinner?: string
	colons?: boolean
	colors: ThemeColors
	notes?: Partial<Record<EventKey, string>>
	background?: (x: number, y: number, tick: number, s: ThemeState) => string | undefined
	draw: (grid: Grid, s: ThemeState, tick: number) => void
	// Whether an event's effect plays at `s`, by the very condition `draw` paints it by; false once the
	// board is back on its idle look. Demo mode's footer reads it (`run-board-demo-footer.ts`).
	playing?: (s: ThemeState) => boolean
	opening?: ThemePart
	ending?: ThemePart
	lasts?: Partial<Record<EventKey, number>>
}

// How a digit or a number in three-row digits is drawn: its style, and the unlit segments' under it.
interface BigLook {
	style: string
	ghost?: string
}

// A banner's place: a header area, its first row `top` (0 when not given).
interface BannerPlace extends Area {
	top?: number
}

interface Corners {
	x0: number
	y0: number
	x1: number
	y1: number
}

type CellTest = (cell: Cell, x: number, y: number) => boolean
type StyleAt = (x: number, y: number, cell: Cell) => string

// What a theme is handed: the layout and the untouched board, and the host's drawing helpers. Those
// that need the layout are bound to it.
interface ThemeApi {
	layout: ThemeLayout
	board: Grid
	plain: (y: number) => string
	fg: (color: string) => string
	bg: (color: string) => string
	hash: (first: number, second?: number, third?: number) => number
	pick: <T>(list: ArrayLike<T>, value: number) => T
	put: (grid: Grid, at: Point, text: string, style?: string) => void
	restyle: (grid: Grid, is_match: CellTest, style_at: StyleAt) => void
	cell_at: (grid: Grid, y: number, x: number) => Cell
	set_cell: (grid: Grid, at: Point, cell: Cell) => void
	is_rule: (cell: Cell) => boolean
	digit: (seed: number) => string
	centered: (text: string, width: number) => string
	clear_area: (grid: Grid, x0?: number, x1?: number) => void
	block: (grid: Grid, area: Area, style: string) => void
	banner: (grid: Grid, place: BannerPlace, text: string, style: string) => void
	big_width: (text: string) => number
	big_digit: (grid: Grid, at: Point, ch: string, look: BigLook) => void
	big_number: (grid: Grid, at: Point, text: string, look: BigLook) => void
	framed: (grid: Grid, box: Box, label: string, style: string) => void
	tear: (grid: Grid, y: number, shift: number) => void
	active: (typed: Channel, tail: number) => boolean
	finished: (typed: Channel) => number
	trace_on: (s: ThemeState) => boolean
	notice_trace: (grid: Grid, s: ThemeState, color: string) => void
	start_flash: (grid: Grid, s: ThemeState, tick: number, style: string) => void
	peak_flash: (grid: Grid, s: ThemeState, style: string) => void
	blank_row: (grid: Grid, y: number) => void
	blank_screen: (grid: Grid) => void
	dimmed: (grid: Grid, style: string) => void
	rect_frame: (grid: Grid, corners: Corners, style: string) => void
	eased: (share: number) => number
	tube_picture: (grid: Grid, half: { w: number; h: number }, glow?: string) => void
	tube_on: ThemePart
	tube_off: ThemePart
}

// A theme file's export: the theme built for the host's layout (it may precompute tables from it).
type ThemeFactory = (api: ThemeApi) => ThemeModule

export type {
	Area,
	BannerPlace,
	BigLook,
	Box,
	Cell,
	CellTest,
	Channel,
	ChannelName,
	Corners,
	EventKey,
	FinalCell,
	FinalGrid,
	Grid,
	PartName,
	PartTyping,
	Point,
	Span,
	Spot,
	StyleAt,
	ThemeApi,
	ThemeColors,
	ThemeEvent,
	ThemeFactory,
	ThemeLayout,
	ThemeModule,
	ThemePart,
	ThemeState,
	ThemeTimeline,
	TimelineMessage,
	TypedSpan,
}
