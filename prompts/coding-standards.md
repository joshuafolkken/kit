# コーディング指針 — lint では表せない書き方

関数の構文・品質上限・型安全・早期 return・マジックナンバーは `CLAUDE.md` → "Critical Conventions (non-standard — always apply)"、lint・型検査の実行は `CLAUDE.md` → "Code Change Rules"（`pnpm josh gate`、実装中は `pnpm josh lint:related` / `pnpm josh test:related`）に従う。ここにない命名の細目（クラスのプロパティ・メソッドの `snake_case` など）は `eslint/rules/naming-convention.js` が持つ。`function` 構文と早期 return の 1 行形式は lint が検査する。

## Conventions

- Naming: `snake_case` variables / functions / params · `PascalCase` types / classes / interfaces / enums · `UPPER_CASE` enum members · booleans prefixed `is_` / `has_` / `should_` / `can_` / `will_` / `did_` · constants `UPPER_CASE` or `snake_case`
- Functions & exports: multiple functions → a namespace object `export { my_module }` (constants exempt) · no `export default`
- Files: Svelte `PascalCase.svelte(.ts)` · TypeScript `kebab-case.ts` · tests `*.test.ts` / `*.svelte.test.ts`, colocated, never `*.spec.ts` (`prompts/testing-guide.md`) · in `scripts/`, no `../` imports — use `#scripts/*`
- Content rules: user-visible strings use i18n message keys in every locale · comments / test titles English only (`eslint/rules/` may explain rationale in Japanese) · no duplication; `/* @refactor-ignore */` at file top excludes a file from refactoring

## 📝 基本方針

- **意図が不明瞭な処理は関数に抽出する**: 1 行でも抽出し、関数名で意図を表す（`if (is_eligible_for_service(user))`）
- **コメントは「なぜ」だけ**: 一行の理由だけを残す。「以前は…」の経緯・Issue 番号・計測値は書かない（git 履歴と Issue が持つ）
- **文字列も定数化する**: 繰り返す文字列や識別子にも意味の分かる名前の定数を付ける
- **既存のコード体系に寄り添う**: そのうえで、より良く書けるなら目指す
- **仕組みを足す前に原因を問う**: `prompts/collaboration-workflow/principles.md` → "elegant-design"。重複の撲滅は "no-clones"

## 📁 新規作成時の手順

### 1. 既存ファイルを必ず参照

```bash
# 類似機能の既存ファイルを探す
find src -name "*.ts" -o -name "*.svelte" | grep -i [関連キーワード]
```

### 2. ファイル分割の指針

- `CLAUDE.md` → "Quality limits" の上限に近づいたら分割を検討する。編集前に `pnpm josh lines <path>` で余裕を確認する
- 責任ごと、また他ファイルからも使われうるロジックごとに別ファイルに分け、メインファイルは主要な処理フローに集中させる
- 小さすぎる分割は避け、関連する機能は同じファイルにまとめる

### 3. 名前空間オブジェクトの名付け方

- ファイル名と名前空間名で意図を明確にする（例: `git-command.ts` → `git_command`）
- メソッド名は短く、名前空間で補完する（例: `exec_git_branch()` → `git_command.branch()`）

```typescript
// ✅ ファイル名: git-command.ts / 名前空間名: git_command
async function branch(): Promise<string> {
	return await exec_git_command('rev-parse --abbrev-ref HEAD')
}

async function status(): Promise<string> {
	return await exec_git_command('status --porcelain')
}

const git_command = {
	branch,
	status,
}

export { git_command }
```

```typescript
// 使用側
import { git_command } from './git/git-command.js'

const branch_name = await git_command.branch()
```
