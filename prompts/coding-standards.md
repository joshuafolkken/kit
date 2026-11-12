# コーディング指針 — lint では表せない書き方

関数の構文・品質上限・型安全・早期 return・マジックナンバーは `CLAUDE.md` → "Critical Conventions (non-standard — always apply)"、lint・型検査の実行は `CLAUDE.md` → "Code Change Rules"（`pnpm josh gate`、実装中は `pnpm josh lint:related` / `pnpm josh test:related`）に従う。ここにない命名の細目（クラスのプロパティ・メソッドの `snake_case` など）は `eslint/rules/naming-convention.js` が持つ。`function` 構文と早期 return の 1 行形式は lint が検査する。

## Conventions

- Naming: `snake_case` variables / functions / params · `PascalCase` types / classes / interfaces / enums · `UPPER_CASE` enum members · booleans prefixed `is_` / `has_` / `should_` / `can_` / `will_` / `did_` · constants `UPPER_CASE` or `snake_case`
- Functions & exports: multiple functions → a namespace object `export { my_module }` (constants exempt) · no `export default`
- Files: Svelte `PascalCase.svelte(.ts)` · TypeScript `kebab-case.ts` · tests `*.test.ts` / `*.svelte.test.ts`, colocated, never `*.spec.ts` (`prompts/testing-guide.md`) · in `scripts/`, no `../` imports — use `#scripts/*`
- Content rules: user-visible strings use i18n message keys in every locale · comments / test titles English only (<!-- lint: english-only-exemption -->`eslint/rules/`<!-- /lint --> may explain rationale in Japanese) · no duplication; `/* @refactor-ignore */` at file top excludes a file from refactoring

## 📝 基本方針

- **意図が不明瞭な処理は関数に抽出する**: 1 行でも抽出し、関数名で意図を表す（`if (is_eligible_for_service(user))`）
- **コメントは「なぜ」だけ**: 一行の理由だけを残す。Issue の引用は「なぜ」の出典として書いてよい。「以前は…」の経緯と単位付きの計測値は書かない（git 履歴と Issue が持つ。`eslint/rules/comment-why-only.js`）
- **文字列も定数化する**: 繰り返す文字列や識別子にも意味の分かる名前の定数を付ける
- **既存のコード体系に寄り添う**: そのうえで、より良く書けるなら目指す
- **仕組みを足す前に原因を問う**: `prompts/collaboration-workflow/principles.md` → "elegant-design"。重複の撲滅は "no-clones"

## 📁 新規作成時の手順

- 書く前に類似機能の既存ファイルを読み、その構成と名付けに合わせる
- 分割は責任ごと。他ファイルからも使われうるロジックは別ファイルに分け、メインファイルは主要な処理フローに集中させる。小さすぎる分割は避ける。編集前に `pnpm josh lines <path>` で上限までの余裕を見る
- 名前空間名はファイル名から取る: `git-command.ts` → `git_command`。メソッド名は名前空間で補って短くする（`exec_git_branch()` → `git_command.branch()`）
