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

const git_pr_review_prose = {
	ignore_comment,
	with_reason,
	unreadable_ai,
	unreadable_cr,
	ignore_alternative,
}

export type { Reviewer }
export { git_pr_review_prose }
