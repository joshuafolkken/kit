import { session_language } from '#scripts/josh/session-language'

// The prose `followup` writes for a person when it leaves a reviewer's findings unresolved or cannot
// read them, in the session language. The commands and the `kit#753` reference stay as they are in
// either language, and nothing here is matched by a script (joshuafolkken/kit#7669).

type Reviewer = 'ai' | 'coderabbit'

interface Prose {
	ignored: Record<Reviewer, string>
	reason: string
	affected: string
	unreadable_ai: string
	unreadable_cr: string
	ignore_alternative: string
	unresolved: string
	fix_findings: string
	reread: string
}

const IGNORE_COMMAND = '`pnpm josh followup --ai-review-ignore-reason "<reason>"`'

const EN: Prose = {
	ignored: {
		ai: 'Some AI reviewer findings were intentionally left unresolved.',
		coderabbit: 'Some CodeRabbit findings were intentionally left unresolved.',
	},
	reason: 'Reason',
	affected: 'Affected comments:',
	unreadable_ai:
		'The AI reviewer comments could not be read, so no finding could be ruled out.\n' +
		'Re-run `pnpm josh followup` once the read succeeds, or pass an ignore reason.',
	unreadable_cr:
		'CodeRabbit line comments could not be read; unresolved findings were not checked (kit#753).',
	ignore_alternative: `Re-run ${IGNORE_COMMAND} if the gate does not apply`,
	unresolved: 'AI reviewer findings remain unresolved.',
	fix_findings: 'Fix the findings and re-run `pnpm josh followup`',
	reread: 'Re-run `pnpm josh followup` once the comments can be read',
}

const JA: Prose = {
	ignored: {
		ai: 'AI レビューの指摘の一部を、意図して未解決のまま残した。',
		coderabbit: 'CodeRabbit の指摘の一部を、意図して未解決のまま残した。',
	},
	reason: '理由',
	affected: '対象のコメント:',
	unreadable_ai:
		'AI レビューのコメントを読めなかったので、指摘が無いことを確かめられなかった。\n' +
		'読めるようになってから `pnpm josh followup` を再実行するか、無視の理由を渡す。',
	unreadable_cr:
		'CodeRabbit の行コメントを読めなかったので、未解決の指摘を確かめていない (kit#753)。',
	ignore_alternative: `ゲートが当てはまらないなら ${IGNORE_COMMAND} を再実行する`,
	unresolved: 'AI レビューの指摘が未解決のまま残っている。',
	fix_findings: '指摘を直して `pnpm josh followup` を再実行する',
	reread: 'コメントを読めるようになってから `pnpm josh followup` を再実行する',
}

function prose_of(): Prose {
	return session_language.is_japanese(session_language.resolve_session_lang().lang) ? JA : EN
}

function reason_line(reason: string): string {
	return `${prose_of().reason}: ${reason.trim()}`
}

function ignore_comment(
	reviewer: Reviewer,
	reason: string,
	affected: ReadonlyArray<string>,
): string {
	const prose = prose_of()

	return [prose.ignored[reviewer], reason_line(reason), prose.affected, ...affected].join('\n')
}

function with_reason(body: string, reason: string): string {
	return `${body}\n${reason_line(reason)}`
}

function unreadable_ai(): string {
	return prose_of().unreadable_ai
}

function unreadable_cr(): string {
	return prose_of().unreadable_cr
}

function ignore_alternative(): string {
	return prose_of().ignore_alternative
}

// The confirmation an AI-review stop sends: its heading and the recommended choice, in the language
// of the body and the alternative beside them.
function unresolved(): string {
	return prose_of().unresolved
}

function fix_findings(): string {
	return prose_of().fix_findings
}

function reread(): string {
	return prose_of().reread
}

const git_pr_review_prose = {
	ignore_comment,
	with_reason,
	unreadable_ai,
	unreadable_cr,
	ignore_alternative,
	unresolved,
	fix_findings,
	reread,
}

export type { Reviewer }
export { git_pr_review_prose }
