// The brief `josh run:handoff retrospective` hands the end-of-run retrospective unit: the procedure
// `.claude/skills/workflow-commands/retrospective.md` spells out, so the unit, not the backlogrun parent,
// runs them. Every `issue:file` brake (the origin ceiling, the WIP cap, `--max`, `cost --cut`) and
// its `auto-ok` judgement still apply, since the unit files through the same command.
//
// The unit's exit is not its own word: `run:handoff` reads the carry record after it ends and exits 0
// only when `run:carry --retrospective` marked it (`run-handoff-cli.ts`).
//
// The carry belongs to the backlogrun parent, and `run:carry` refuses a mark from any other live
// session (`run-carry.ts` → `is_count_refused`), so the close names the parent's pid as `--owner`.

const RETROSPECTIVE_DOC = '.claude/skills/workflow-commands/retrospective.md'
const DIGEST_COMMAND = 'pnpm josh retrospective'
const FILE_COMMAND = 'pnpm josh issue:file'
const CLOSE_COMMAND = 'pnpm josh run:carry --retrospective'
const OWNER_FLAG = '--owner'

// No known parent pid leaves `--owner` out; the record then names no live owner to refuse the mark.
function close_line(owner: number | undefined): string {
	const owner_part = owner === undefined ? '' : ` ${OWNER_FLAG} ${String(owner)}`

	return `${CLOSE_COMMAND}${owner_part} --summary "<result>"`
}

function steps(owner: number | undefined): ReadonlyArray<string> {
	return [
		`You are the end-of-run retrospective unit. Read \`${RETROSPECTIVE_DOC}\` in full first; it governs every step below.`,
		`1. Run \`${DIGEST_COMMAND}\` once.`,
		`2. Put the top two \`Improvement picks\` through the depth test (\`observation-filing.md\` → "The depth test") and file each that passes with the \`${FILE_COMMAND}\` line the digest prints; its \`auto-ok\` judgement and every brake apply as printed.`,
		'3. Send the `stack:` lines to the observation ledger.',
		`4. Close with \`${close_line(owner)}\`, naming the issues filed (or none) and the candidates dropped with why.`,
		'Ask nobody and file nothing beyond these steps. When step 4 cannot be written, say why as the final message.',
	]
}

function brief(owner?: number): string {
	return steps(owner).join('\n')
}

const run_handoff_retrospective = {
	CLOSE_COMMAND,
	DIGEST_COMMAND,
	FILE_COMMAND,
	OWNER_FLAG,
	brief,
}

export { run_handoff_retrospective }
