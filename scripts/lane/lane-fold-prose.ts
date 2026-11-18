import { issue_cite } from '#scripts/issue/issue-cite'
import { session_language } from '#scripts/josh/session-language'

// The comment `lane:fold` leaves on the Issue that takes a folded component over: how to bring the
// component's stashed work in, and that its pull request closes the component. The marker names the
// folded Issue, so a re-run finds the note already written and does not post it twice.

interface Prose {
	head: (folded: string) => string
	closes: (folded: string) => string
	why: string
}

// Each `(cited)` is the folded Issue's plain `#N`, which GitHub links in the comment.
const EN: Prose = {
	head: (cited) => `${cited} is folded into this Issue: its work ships in this pull request.`,
	closes: (cited) => `- Write \`closes ${cited}\` in the pull request body.`,
	why: 'Why',
}

const JA: Prose = {
	head: (cited) => `${cited} をこの Issue に畳んだ。部品の作業はこの PR で出す。`,
	closes: (cited) => `- PR 本文に \`closes ${cited}\` を書く。`,
	why: '理由',
}

function prose_of(): Prose {
	return session_language.is_japanese(session_language.resolve_session_lang().lang) ? JA : EN
}

function marker(folded: string): string {
	return `<!-- josh:lane-fold ${issue_cite.plain_for('program', folded)} -->`
}

function restore_line(stash: string | undefined): ReadonlyArray<string> {
	if (stash === undefined) return []

	return [`- \`pnpm josh stash:pop "${stash}"\``]
}

/** The note for the taking Issue; `stash` is `undefined` when the folded lane held no work. */
function comment(folded: string, stash: string | undefined, reason: string): string {
	const prose = prose_of()
	const cited = issue_cite.plain_for('github', folded)

	return [
		prose.head(cited),
		...restore_line(stash),
		prose.closes(cited),
		`- ${prose.why}: ${reason}`,
		marker(folded),
	].join('\n')
}

/** Whether one of the taking Issue's comment bodies is already this fold's note. */
function is_noted(bodies: ReadonlyArray<string>, folded: string): boolean {
	return bodies.some((body) => body.includes(marker(folded)))
}

const lane_fold_prose = { comment, is_noted }

export { lane_fold_prose }
