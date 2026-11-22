import { file_reader } from '#scripts/lib/read-file'
import { review_attest, type ReviewSlot } from './review-attest'

// **A reviewer's launch prompt opens with its review level** (joshuafolkken/kit#5555): the level sits on
// the brief's first line, which the prompt only points at, so a transcript never carried it and
// `josh lane:breakdown` printed `round 1` where it means `round 1 · medium`. The prompt stays one line —
// a detached launch refuses a control character — so the level leads it before a separator, and the
// transcript reader reads it back with the same pattern.
//
// **The trigger follows the level** (joshuafolkken/kit#8337): which launch this is — round 1, the
// interaction review beside it, the paired run, round 2 or a retry — so `cost:audit` reads the cause of
// each reviewer run back off its transcript with `trigger_of`. A rerun names its cause in place of the
// slot's word (joshuafolkken/kit#8379), so an avoidable launch is told from a first one.

const LEVEL_PATTERN = /^(low|medium|high|xhigh|max)(?:$| — )/u
const SEPARATOR = ' — '
const RETRY = {
	ATTEST: 'attest-retry',
	STALE: 'stale-retry',
	POST_CONFLICT: 'post-conflict',
} as const
const TRIGGERS = [
	'initial',
	'interaction',
	'paired',
	'round-2',
	RETRY.ATTEST,
	RETRY.STALE,
	RETRY.POST_CONFLICT,
] as const
const TRIGGER_WORDS: ReadonlySet<string> = new Set(TRIGGERS)
const TRIGGER_PATTERN = /(?:^| — )trigger: ([a-z0-9-]+) — /u

type ReviewTrigger = (typeof TRIGGERS)[number]
type RetryTrigger = (typeof RETRY)[keyof typeof RETRY]

// The level a line opens with — a brief's bare first line or a prompt's lead — `undefined` otherwise.
function level_of(line: string): string | undefined {
	return LEVEL_PATTERN.exec(line)?.[1]
}

function is_trigger(word: string): word is ReviewTrigger {
	return TRIGGER_WORDS.has(word)
}

// The trigger a launch prompt carries, `undefined` for a prompt written before it carried one.
function trigger_of(prompt: string): ReviewTrigger | undefined {
	const word = TRIGGER_PATTERN.exec(prompt)?.[1]

	return word !== undefined && is_trigger(word) ? word : undefined
}

// Round 1's trigger by slot: the interaction slot is the second review run beside the code review.
function round_one_trigger(slot: ReviewSlot): ReviewTrigger {
	return slot === review_attest.REVIEW_SLOT.INTERACTION ? 'interaction' : 'initial'
}

// The lead a prompt pointing at `brief_path` opens with: its level and the separator — nothing for a
// brief not written or not opening with a level — then the launch's trigger and the separator.
function opening(brief_path: string, trigger: ReviewTrigger): string {
	const [first = ''] = (file_reader.read_if_readable(brief_path) ?? '').split('\n', 1)
	const level = level_of(first.trim())
	const lead = level === undefined ? '' : `${level}${SEPARATOR}`

	return `${lead}trigger: ${trigger}${SEPARATOR}`
}

const review_prompt_level = { RETRY, TRIGGERS, level_of, opening, round_one_trigger, trigger_of }

export { review_prompt_level, type RetryTrigger, type ReviewTrigger }
