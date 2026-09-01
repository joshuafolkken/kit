import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	read_unwrapped,
	read_unwrapped_rule_surface,
	WORKFLOW_PROMPT_DIRECTORY,
} from './ai-document-fixture'
import { SKILL_ENTRY_FILE, SKILL_ROOT } from './skill-fixture'

// joshuafolkken/kit#1150: measured on the joshuafolkken/kit#1144 transcript, 145 calls of the
// `python3 - <<'PY'` file-editing form carried 79,317 tokens — 81.7% of every Bash command body and
// about a fifth of the whole session context. The edited text rides in the command *and* in the
// file, and a command body is re-read on every later request of the session, so an edit written
// early in a run is charged hundreds of times.
//
// The rule is resident because an edit happens on any turn at all and no skill is loaded before one.
// That makes this suite the guard on two things at once: the rule being in `CLAUDE.md` rather than
// on demand, and the reasoning staying at the pointer rather than being pasted back beside it.
const CANONICAL = `${WORKFLOW_PROMPT_DIRECTORY}/file-edits.md`
const RESIDENCY = `${WORKFLOW_PROMPT_DIRECTORY}/residency.md`
const WORKFLOW_SKILL_ENTRY = `${SKILL_ROOT}/workflow-commands/${SKILL_ENTRY_FILE}`
const SUITE_PATH = 'scripts/inline-edit-rule.test.ts'
// The three figures the issue was filed on. Quotable enough to be the first thing pasted back into
// an always-loaded document, which is what makes them the marker for "the reasoning stayed put".
const MEASUREMENTS: ReadonlyArray<string> = ['79,317', '81.7%', '30.2%']

// Every sentence here changes what an agent does. Drop the first and the prohibition is gone; drop
// the criterion and it reads as a ban on a named tool, which a `node -e` or a `tee` heredoc walks
// straight past.
describe.each(AI_DOCS)('%s — keeps the file-editing prohibition resident', (document_path) => {
	const content = read_unwrapped(document_path)

	it.each([
		"**Never carry a file's new text inside a shell command.**",
		'An edit that targets a region of an existing file is made with the Edit tool',
		"**The criterion is whether the command carries the replacement wholesale, not the tool's name**",
		'a short `sed -i` substitution is smaller than an Edit and stays allowed',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('routes to the canonical topic file', () => {
		expect(content).toContain(`\`${CANONICAL}\``)
	})

	// A resident rule is a trigger plus a pointer. The measured breakdown is what makes the rule
	// persuasive, not what makes it obeyed, so it belongs at the pointer — and it is the first thing
	// that would be pasted back in, because it is the most quotable part. The rule surface is what is
	// searched, not the document alone: the likeliest paste targets are the two residency lists, and a
	// check scoped to `CLAUDE.md` would pass with the breakdown copied into either.
	it.each(MEASUREMENTS)('leaves the measurement %j at the pointer', (measurement) => {
		expect(read_unwrapped_rule_surface(document_path)).not.toContain(measurement)
		expect(read_unwrapped(RESIDENCY)).not.toContain(measurement)
	})
})

describe(`${CANONICAL} — carries the criterion and the reasoning`, () => {
	const content = read_unwrapped(CANONICAL)

	it.each([
		'## ファイル編集はコマンド本文に本文を載せない',
		'**編集後のテキストを丸ごとコマンド行に載せる形を禁じる。**',
		'**そのコマンドは、置換後のテキストを丸ごとコマンド本文に載せているか。**',
		// The half that a tool-name reading loses: `sed -i` is allowed and a whole-file Edit is not.
		'したがって短い置換に `sed -i` を使うのは**許される**。',
		'逆に「Edit を使ったから安全」も成り立たない',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// Column padding is rewritten by the formatter, so the rows are matched against collapsed
	// whitespace — the verdict is pinned, the alignment is not.
	it.each([
		'| `sed -i` の短い置換 | 条件付きで可 |',
		"| `python3 - <<'PY'` で領域を書き戻す | 不可 |",
		"| `cat > file <<'EOF'` で既存ファイルを書き直す | 不可 |",
	])('rules on %j', (row) => {
		expect(content).toContain(row)
	})

	it('says why the cost is charged twice', () => {
		expect(content).toContain(
			'**コマンド本文は、書いた時点以降のすべてのリクエストで読み直される。**',
		)
	})
})

// The carve-out is the part that can be followed straight into a corrupted file: `sed` substitutes
// on every matching line, succeeds on zero matches, and its `-i` argument differs between BSD and
// GNU — and this document ships to consumers on both.
describe(`${CANONICAL} — guards the \`sed -i\` carve-out`, () => {
	const content = read_unwrapped(CANONICAL)

	it.each([
		'### `sed -i` を使う前に満たす 4 条件',
		'**一致した全行**を書き換え、**一致が 0 件でも黙って成功する**',
		// Occurrences, not matching lines: `grep -c` answers `1` for a phrase that appears twice on one
		// line, and `s///` without `g` then rewrites half of them and exits 0.
		"`grep -o '<pattern>' <file> | wc -l`",
		'**`grep -c` を使ってはならない**',
		// The pattern side is where the escaping actually bites in a repository of prose.
		'**危ないのはむしろパターン側**',
		"BSD / macOS は `sed -i '' 's/…/…/' file`、GNU / Linux は `sed -i 's/…/…/' file`",
		// A Bash edit fires no `PostToolUse` hook, and `format:edited` reads its path from stdin.
		'**`format:edited` は手で呼べない**',
		'**4 条件のどれかが面倒に見えたら、そこが Edit を使う場所である。**',
	])('states the precondition %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The residency list claims to be exhaustive within its scope — every resident rule that has an
// on-demand counterpart. This rule has one, so a list that omits it says the rule was never checked
// against the criterion.
describe('the residency lists name the file-editing prohibition', () => {
	it.each([
		"**The prohibition on carrying a file's new text inside a shell command** — an edit happens on any turn at all",
		'there is no skill that a run loads *before* editing',
		SUITE_PATH,
	])('the workflow skill states %j', (marker) => {
		expect(read_unwrapped(WORKFLOW_SKILL_ENTRY)).toContain(marker)
	})

	it.each([
		'- **編集後の本文をコマンドに載せない禁止**',
		'**編集の直前にロードされる skill は存在しない**',
		SUITE_PATH,
	])('the canonical residency file states %j', (marker) => {
		// `residency.md` directly, never the concatenated corpus `WORKFLOW_PROMPT` reads: the pointer
		// file names this suite too, so a corpus-wide search would be satisfied by `file-edits.md` and
		// pass with the residency entry deleted.
		expect(read_unwrapped(RESIDENCY)).toContain(marker)
	})
})
