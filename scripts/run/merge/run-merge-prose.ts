import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { session_language } from '#scripts/josh/session-language'

// The comments `run:merge` posts for a person to read, in the session language. The label, the list
// line labels, commands and paths stay English, as on `run:merge`'s other comments
// (joshuafolkken/kit#7699).

interface Prose {
	decision_head: string
	failures: string
	next: string
	kept_lane: string
}

const ENGLISH_PROSE: Prose = {
	decision_head: `Parked with \`${NEEDS_DECISION_LABEL}\` by \`pnpm josh run:merge\`: the child waits for your answer.`,
	failures: 'unchanged.',
	next: `answer the question on this issue, then remove \`${NEEDS_DECISION_LABEL}\` to resume.`,
	kept_lane:
		"The split left this issue's lane open: it still holds a commit, an uncommitted change or a live process",
}

const JAPANESE_PROSE: Prose = {
	decision_head: `\`pnpm josh run:merge\` が \`${NEEDS_DECISION_LABEL}\` で park した: 子があなたの回答を待っている。`,
	failures: '変わらない。',
	next: `この Issue の質問に答えてから \`${NEEDS_DECISION_LABEL}\` を外すと再開する。`,
	kept_lane:
		'分割でこの Issue のレーンを開けたままにした: コミット、未コミットの変更、または動いているプロセスがまだある',
}

function prose_of(): Prose {
	return session_language.is_japanese(session_language.resolve_session_lang().lang)
		? JAPANESE_PROSE
		: ENGLISH_PROSE
}

function decision_comment(why: string): string {
	const prose = prose_of()

	return [
		prose.decision_head,
		`- Decision: ${why}`,
		`- Consecutive failures: ${prose.failures}`,
		`- Next: ${prose.next}`,
	].join('\n')
}

function kept_lane_comment(directory: string): string {
	return `${prose_of().kept_lane} — ${directory}`
}

const run_merge_prose = { decision_comment, kept_lane_comment }

export { run_merge_prose }
