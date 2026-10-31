import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { disposition_batch, type BatchFinding } from './disposition-batch'

// The branch-2 half of `josh disposition --batch`: for each finding it routes to `file`, a body that
// `issue:lint` passes and the `issue:file` line that files it — written and printed, never filed, so
// the run reads the draft before the filing. The origin pull request is unknown when the disposition
// runs and an untraced bug owes a reproduction this cannot run, so the draft is declared non-bug; the
// filer reclassifies it once the origin is traced.

const BODY_DIRECTORY = '.josh/tmp'
const FOUND_DURING_FLAG = '--found-during'
const SECURITY_CATEGORY = 'security:'
// A `'` inside a single-quoted shell word: close the quote, an escaped quote, reopen.
const ESCAPED_QUOTE = String.raw`'\''`
const MISSING_FOUND_DURING =
	'a finding routes to `file`: pass `--found-during <N>`, the issue whose review found it'
const FILE_HEADING = `File commands (bodies drafted under ${BODY_DIRECTORY}/ — read each before filing):`

interface Filing {
	title: string
	body_path: string
}

// The issue as GitHub renders it — the title, the body and the `parent:` line all name it this way.
function cite(issue: number): string {
	return issue_cite.plain(issue)
}

function title_of(finding: BatchFinding, issue: number): string {
	return `Resolve review-cap finding ${finding.spec} deferred from ${cite(issue)}`
}

// A security finding declares what it bypasses instead of a priority, so `issue:file` applies the
// high floor `issue-template.md` → H gives it; any other finding runs at the normal priority.
function priority_line(finding: BatchFinding): string {
	return finding.spec.startsWith(SECURITY_CATEGORY)
		? `- セキュリティ: ${finding.description}`
		: '- 優先度: 通常'
}

function background_lines(finding: BatchFinding, issue: number): ReadonlyArray<string> {
	return [
		'## 背景',
		'',
		'- 種別: 非不具合',
		'- 目的: 機能改善',
		'- 人の判断: 不要',
		priority_line(finding),
		'- 規模見積もり: 約 1 ファイル / 20 行（テスト除く）',
		'',
		`${cite(issue)} のレビューで確かめた所見 \`${finding.spec}\`。ラウンド上限のため、その場では直さずに持ち越した。`,
	]
}

function body_of(finding: BatchFinding, issue: number): string {
	return [
		`parent: ${cite(issue)}`,
		'',
		...background_lines(finding, issue),
		'',
		'## 現象',
		'',
		`- ${finding.description}`,
		'',
		'## 期待結果',
		'',
		`- \`${finding.spec}\` の失敗シナリオが起きない`,
		'',
		'## 受け入れ条件',
		'',
		'- [ ] 所見の失敗シナリオを入力と状態で再現するテストが通る',
		'',
	].join('\n')
}

// Single-quoted, so a finding path carrying `$(`, a backtick or `"` stays literal when pasted.
function shell_quoted(text: string): string {
	return `'${text.split("'").join(ESCAPED_QUOTE)}'`
}

function command_of(filing: Filing, issue: number): string {
	const flags = `--route review-cap --label run:lane --found-during ${String(issue)}`
	const body_file = shell_quoted(filing.body_path)

	return `pnpm josh issue:file ${shell_quoted(filing.title)} --body-file ${body_file} ${flags}`
}

function body_path_of(directory: string, issue: number, index: number): string {
	return path.join(directory, `review-cap-${String(issue)}-${String(index + 1)}.md`)
}

// Writes each finding's body under `directory` and returns what its filing line names.
function write_filings(
	findings: ReadonlyArray<BatchFinding>,
	issue: number,
	directory: string = BODY_DIRECTORY,
): ReadonlyArray<Filing> {
	mkdirSync(directory, { recursive: true })

	return findings.map((finding, index) => {
		const body_path = body_path_of(directory, issue, index)

		writeFileSync(body_path, body_of(finding, issue))

		return { title: title_of(finding, issue), body_path }
	})
}

function found_during_of(argv: ReadonlyArray<string>): number | undefined {
	const value = argv.includes(FOUND_DURING_FLAG) ? argv[argv.indexOf(FOUND_DURING_FLAG) + 1] : ''

	return issue_number_shape.is_issue_number(value ?? '') ? Number(value) : undefined
}

// The lines `--batch` prints after the table: each `file` finding's filing line once its body is
// written, `[]` when none routes to `file`, `undefined` when one does and `argv` names no issue.
function filing_lines(
	findings: ReadonlyArray<BatchFinding>,
	argv: ReadonlyArray<string>,
	directory: string = BODY_DIRECTORY,
): ReadonlyArray<string> | undefined {
	const filed = findings.filter((finding) => disposition_batch.branch_of(finding) === 'file')

	if (filed.length === 0) return []

	const issue = found_during_of(argv)

	if (issue === undefined) return undefined

	const filings = write_filings(filed, issue, directory)
	const commands = filings.map((filing) => command_of(filing, issue))

	return ['', FILE_HEADING, ...commands]
}

const disposition_batch_filing = {
	MISSING_FOUND_DURING,
	body_of,
	command_of,
	filing_lines,
	title_of,
	write_filings,
}

export { disposition_batch_filing }
export type { Filing }
