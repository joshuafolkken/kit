# コーディング指針 — lint では表せない書き方

命名・エクスポート・ファイル名・内容の規約の単一ソースは下記「Conventions」、関数の構文・品質上限・型安全・早期 return・マジックナンバーの単一ソースは `CLAUDE.md` → "Critical Conventions (non-standard — always apply)" である。その大半は ESLint が強制する（クラスのプロパティ・メソッドの `snake_case` などここに書いていない細目は `eslint/rules/naming-convention.js` が持つ）。ただし **`function` 構文（アロー関数を使わない）と早期 return の 1 行形式は lint が検査しない**ので、書き手とレビューが確かめる。このファイルは本文を写さず、lint では表せない書き方の指針だけを持つ。

lint・型検査の実行手順は `CLAUDE.md` → "Code Change Rules" の検証ゲート（`pnpm josh gate`、実装中は `pnpm josh lint:related` / `pnpm josh test:related`）が単一ソースである。

## Conventions

`CLAUDE.md` から移した、lint が強制する規約の単一ソース。

- **Naming**: `snake_case` variables / functions / params · `PascalCase` types / classes / interfaces / enums · `UPPER_CASE` enum members · booleans prefixed `is_` / `has_` / `should_` / `can_` / `will_` / `did_` · constants `UPPER_CASE` or `snake_case`
- **Functions & exports**: multiple functions → a namespace object `export { my_module }` (constants exempt) · no `export default`
- **Files**: Svelte `PascalCase.svelte(.ts)` · TypeScript `kebab-case.ts` · tests `*.test.ts` / `*.svelte.test.ts`, colocated, never `*.spec.ts` (`prompts/testing-guide.md`) · in `scripts/`, no `../` imports — use `#scripts/*`
- **Content rules**: user-visible strings use i18n message keys in every locale · comments / test titles English only (`eslint/rules/` may explain rationale in Japanese) · no duplication; `/* @refactor-ignore */` at file top excludes a file from refactoring

## 📝 基本方針

一般的な書き方の助言（シンプルさ・命名・過度な抽象化の回避など）は繰り返さない。lint が強制せず、一般論でもない指針だけを置く。

- **意図が不明瞭な処理は関数に抽出する**: 条件式や処理の意図がわかりにくければ、たとえ 1 行でも抽出し、関数名で意図を表す（`if (is_eligible_for_service(user))`）
- **コメントは「なぜ」だけ、経緯は書かない**: 残すのは一行の理由（そのルールの意図）だけ。「以前は…」という経緯、Issue 番号への参照、計測値は git 履歴と Issue が保持している
- **文字列も定数化する**: 数値リテラルの抽出は lint が強制するが、繰り返し使用する文字列や識別子も定数化し、意味の分かる名前を付ける
- **既存のコード体系に寄り添う**: そのうえで、より良く書けるなら目指す
- **仕組みを足す前に原因を問う**: 設計時の判断は `prompts/collaboration-workflow/principles.md` → "elegant-design" の担当。コメントの英語限定と重複の撲滅は上の「Conventions」と `principles.md` → "no-clones" が単一ソースである

## 📁 新規作成時の手順

### 1. 既存ファイルを必ず参照

```bash
# 類似機能の既存ファイルを探す
find src -name "*.ts" -o -name "*.svelte" | grep -i [関連キーワード]
```

### 2. ファイル分割の指針

- **上限に近づいたら分割を検討**: 関数やファイルが `CLAUDE.md` → "Quality limits" の上限に近づいたら分割を検討する。編集前に `pnpm josh lines <path>` で余裕を確認する
- **責任が複数ある場合**: 1つのファイルが複数の責任を持つ場合は、責任ごとにファイルを分割
- **再利用性**: 他のファイルからも使用される可能性があるロジックは、別ファイルに分離
- **メインファイルの肥大化を避ける**: メインファイルの肥大化を避けることを優先する。再利用可能な機能や独立した責任を持つ機能は、積極的に別ファイルに分割する。メインファイルは主要な処理フローに集中し、詳細な実装は別ファイルに分離する
- **過度な分割は避ける**: 小さすぎるファイルの分割は避け、関連する機能は同じファイルにまとめる

### 3. 名前空間オブジェクトの名付け方

複数の関数を名前空間オブジェクトにまとめてエクスポートする規則そのものは上記「Conventions」にある（定数は個別エクスポートでよい）。ここでは名付け方だけを述べる。

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
