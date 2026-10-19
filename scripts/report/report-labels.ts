import { session_language } from '#scripts/josh/session-language'

// The labels of the work summary and the completion report, in the two languages the workflow is
// written in. **This table is their single source**: `report:template` prints the skeletons from it
// and `report:lint` checks a summary against it, so a session that translates its labels by the
// table passes the lint in any language. `report-format.md` names the command, never a copy.

interface ReportLabels {
	overview: string
	now: string
	change: string
	check: string
	details: string
	target: string
	approach: string
	out_of_scope: string
	changes: string
	cases: string
	case_vocabulary: ReadonlyArray<string>
	if_it_breaks: string
	not_applicable: string
	never_breaks: string
	completion: string
	cause: string
	fix: string
	result: string
	changed_files: string
	test_results: string
	evidence: string
	caught_by: string
	remaining: string
}

const JAPANESE_LABELS: ReportLabels = {
	overview: '■ 概要',
	now: '今こうなっている',
	change: 'こう直す',
	check: '確かめ方',
	details: '技術詳細',
	target: '対象',
	approach: '方針',
	out_of_scope: '副作用 / スコープ外',
	changes: '変更とテスト',
	cases: 'ケース',
	case_vocabulary: ['正常', '空・0件', '1件', '多数', '境界', '不正入力', '重複', '順序', 'null'],
	if_it_breaks: '壊れるとしたら',
	not_applicable: '該当なし',
	never_breaks: 'どう呼ばれても壊れない',
	completion: '■ 完了報告',
	cause: '原因',
	fix: '対応',
	result: '結果',
	changed_files: '変更ファイル',
	test_results: 'テスト結果',
	evidence: '実行証跡',
	caught_by: '捕まえられた検証',
	remaining: '残課題',
}

const ENGLISH_LABELS: ReportLabels = {
	overview: '■ Overview',
	now: 'Now',
	change: 'Change',
	check: 'Check',
	details: 'Details',
	target: 'Target',
	approach: 'Approach',
	out_of_scope: 'Side effects / out of scope',
	changes: 'Changes and tests',
	cases: 'Cases',
	case_vocabulary: [
		'normal',
		'empty',
		'one',
		'many',
		'boundary',
		'invalid input',
		'duplicate',
		'order',
		'null',
	],
	if_it_breaks: 'If it breaks',
	// Never `N/A`: the lint splits a case line on `/`, which would cut the marker in two.
	not_applicable: 'not applicable',
	never_breaks: 'never breaks however it is called',
	completion: '■ Completion report',
	cause: 'Cause',
	fix: 'Fix',
	result: 'Result',
	changed_files: 'Changed files',
	test_results: 'Test results',
	evidence: 'Execution evidence',
	caught_by: 'Caught by',
	remaining: 'Remaining',
}

function labels_for(lang: string): ReportLabels {
	return session_language.is_japanese(lang) ? JAPANESE_LABELS : ENGLISH_LABELS
}

function session_labels(): ReportLabels {
	return labels_for(session_language.resolve_session_lang().lang)
}

const report_labels = { ENGLISH_LABELS, JAPANESE_LABELS, labels_for, session_labels }

export type { ReportLabels }
export { report_labels }
