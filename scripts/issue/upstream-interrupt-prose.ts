import { session_language } from '#scripts/josh/session-language'

// The sentences `josh upstream:interrupt` posts on the finder for a person to read, in the session
// language. The headings they sit under and the `stash:pop` command stay English: the headings are the
// fixed sections of `issue-template.md`, and the command is what a person runs (joshuafolkken/kit#7670).

function is_japanese(): boolean {
	return session_language.is_japanese(session_language.resolve_session_lang().lang)
}

function resume(stash_message: string): string {
	const command = `\`pnpm josh stash:pop "${stash_message}"\``

	return is_japanese() ? `再開: ${command}。` : `Resume with ${command}.`
}

function stopped(finder: string): string {
	return is_japanese()
		? `${finder} はこの上流の不具合で止まった。作業は stash してある。`
		: `${finder} stopped on this upstream defect; its work is stashed.`
}

function not_filed(repo: string): string {
	return is_japanese()
		? `起票していない: \`${repo}\` は第三者のリポジトリ（Tier C）なので、下の下書きは人が投稿する。`
		: `Not filed: \`${repo}\` is third-party (Tier C) — a person posts the draft below.`
}

const upstream_interrupt_prose = { resume, stopped, not_filed }

export { upstream_interrupt_prose }
