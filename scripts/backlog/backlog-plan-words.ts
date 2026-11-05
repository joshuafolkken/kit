import { session_language } from '#scripts/josh/session-language'

// The words `backlog:plan` prints around its rows, one table per session language, so the plan is
// relayed as printed rather than reworded by the reader. The rows themselves — citations, marks and
// the out-of-scope reasons — are data and stay as they are.

interface PlanWords {
	title: string
	nothing: string
	// The named-issue prefix of a `backlogrun #N1 #N2 …`: these run one at a time, in the order they
	// were typed, before anything in the pool below is picked up.
	named_heading: string
	// `--only` runs the named list and stops, so its heading says the pool is not drained.
	only_named_heading: string
	ready_heading: string
	waiting_heading: string
	// Every park label (`PARKED_LABELS`) puts a child here, so the heading names none and each row
	// names its own: a `run:stalled` row read as `needs-decision` sends a person to decide a mechanical
	// failure.
	human_heading: string
	scope_heading: string
	in_progress_note: string
	past_offer_note: string
	// Leads the blocker list of a waiting row.
	waiting_on: string
}

const ENGLISH_PLAN_WORDS: PlanWords = {
	title: 'Backlog plan',
	nothing: '(none)',
	named_heading: 'Named issues — run in order first, one at a time, then the backlog:',
	only_named_heading:
		'Named issues — run in order, one at a time, then stop (`--only`; the opted-in backlog is not run):',
	ready_heading: 'Ready now — the first wave; these may run in parallel:',
	waiting_heading: 'Waiting — each names what it is waiting on:',
	human_heading: 'Waiting on a person — resolve these before the run starts:',
	scope_heading: 'Out of scope — open, but the backlog will not run these:',
	in_progress_note: 'a run already has it',
	past_offer_note: 'waiting for a later wave (lane limit or selection gates)',
	waiting_on: 'waiting on',
}

const JAPANESE_PLAN_WORDS: PlanWords = {
	title: 'バックログ計画',
	nothing: '（なし）',
	named_heading: '指名した Issue — 指名順に 1 件ずつ先に流し、その後バックログへ:',
	only_named_heading:
		'指名した Issue — 指名順に 1 件ずつ流して止まる（`--only`。opt-in 済みのバックログは流さない）:',
	ready_heading: '今すぐ着手可 — 最初の組。並行に流せる:',
	waiting_heading: '待ち — 各行が待っている相手を示す:',
	human_heading: '人の対応待ち — ランの開始前に解消する:',
	scope_heading: '対象外 — open だがバックログは流さない:',
	in_progress_note: '既に別のランが担当中',
	past_offer_note: '後続の組を待つ（レーン上限または選択条件による）',
	waiting_on: '待ち:',
}

function words_for(lang: string): PlanWords {
	return session_language.is_japanese(lang) ? JAPANESE_PLAN_WORDS : ENGLISH_PLAN_WORDS
}

function session_words(): PlanWords {
	return words_for(session_language.resolve_session_lang().lang)
}

const backlog_plan_words = { ENGLISH_PLAN_WORDS, JAPANESE_PLAN_WORDS, session_words, words_for }

export type { PlanWords }
export { backlog_plan_words }
