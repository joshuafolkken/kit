import { session_language } from '#scripts/josh/session-language'

// The withdraw comment a person reads on the Issue, in the session language. The `- Why:` label stays
// English, as on `run:merge`'s comments, and so do the withdrawer names on the event stream, which
// `run:merge` and the board match (joshuafolkken/kit#7668).

// Who withdrew the lane: a person with `lane:withdraw`, the supervisor's sweep of closed issues,
// `run:merge` collecting a child whose issue closed without a merge (joshuafolkken/kit#4916), or the
// child's own `lane:plan` giving its lane back (`lane-yield.ts`, joshuafolkken/kit#4926).
type Withdrawer = 'person' | 'supervisor' | 'merge' | 'yield'

interface Heads {
	closed: string
	open: string
	// The open issue's tail where it is not the shared one.
	open_tail?: string
}

interface Prose {
	heads: Record<Withdrawer, Heads>
	open_tail: string
	closed_tail: string
}

const EN: Prose = {
	heads: {
		person: {
			closed: 'Its lane was withdrawn with `pnpm josh lane:withdraw` after the Issue was closed.',
			open: 'Withdrawn from the current run by a person with `pnpm josh lane:withdraw`.',
		},
		supervisor: {
			closed: 'Its lane was withdrawn by the `run:wake` supervisor after the Issue was closed.',
			open: 'Withdrawn from the current run by the `run:wake` supervisor.',
		},
		merge: {
			closed:
				'Its lane was withdrawn by `pnpm josh run:merge` after the Issue was closed without a merge.',
			open: 'Withdrawn from the current run by `pnpm josh run:merge`.',
		},
		yield: {
			closed: 'Its lane was given back by `pnpm josh lane:plan` after the Issue was closed.',
			open: 'Gave its lane back: `pnpm josh lane:plan` found an earlier lane holding one of its planned files.',
			open_tail:
				'The lane closed before any implementation edit. The Issue stays in the run: it is offered again once the holding lane ends, keeping its place in line.',
		},
	},
	open_tail:
		'Its lane child was stopped and the lane closed. The Issue stays open: this run does not resume it, and the next run offers it again.',
	closed_tail:
		'Its lane child was stopped and the lane closed, so it no longer holds a lane and is not resumed.',
}

const JA: Prose = {
	heads: {
		person: {
			closed: 'Issue が閉じられた後に、`pnpm josh lane:withdraw` でレーンを取り下げた。',
			open: '人が `pnpm josh lane:withdraw` で今回のランから取り下げた。',
		},
		supervisor: {
			closed: 'Issue が閉じられた後に、`run:wake` の監督役がレーンを取り下げた。',
			open: '`run:wake` の監督役が今回のランから取り下げた。',
		},
		merge: {
			closed: 'Issue がマージなしで閉じられた後に、`pnpm josh run:merge` がレーンを取り下げた。',
			open: '`pnpm josh run:merge` が今回のランから取り下げた。',
		},
		yield: {
			closed: 'Issue が閉じられた後に、`pnpm josh lane:plan` がレーンを返した。',
			open: 'レーンを返した: `pnpm josh lane:plan` が、計画したファイルの一つを持つ先行のレーンを見つけた。',
			open_tail:
				'実装の編集より前にレーンを閉じた。Issue はランに残る: 先行のレーンが終わると、順番を保ったまま再び提示される。',
		},
	},
	open_tail:
		'レーンの子を止めてレーンを閉じた。Issue は開いたまま: 今回のランでは再開せず、次のランで再び提示される。',
	closed_tail: 'レーンの子を止めてレーンを閉じたので、レーンを持たず、再開もされない。',
}

function prose_of(): Prose {
	return session_language.is_japanese(session_language.resolve_session_lang().lang) ? JA : EN
}

function tail_of(prose: Prose, by: Withdrawer, is_closed: boolean): string {
	if (is_closed) return prose.closed_tail

	return prose.heads[by].open_tail ?? prose.open_tail
}

function comment(by: Withdrawer, is_closed: boolean, reason: string): string {
	const prose = prose_of()
	const head = is_closed ? prose.heads[by].closed : prose.heads[by].open

	return [head, tail_of(prose, by, is_closed), `- Why: ${reason}`].join('\n')
}

const lane_withdraw_prose = { comment }

export type { Withdrawer }
export { lane_withdraw_prose }
