# リファクタリング支援プロンプト

- 「リファクタリングを提案して」→ 分析・提案のみ。実装はユーザーに委ねる
- 「リファクタリングして」→ 優先度高・中を自動実施し、同一セッション内で収束するまで繰り返す

---

## 対象と候補の算出（`pnpm josh refactor:scan`）

対象ファイル・スコープ拡張・lint 候補の集計・収束判定は `pnpm josh refactor:scan` が計算する。手作業で grep せず、まずこれを実行する（joshuafolkken/kit#2180、詳細は `docs/josh-commands.md` の `josh refactor:scan`）。

```bash
pnpm josh refactor:scan
```

- 対象ファイル: 作業ツリーの変更＋main との差分＋未追跡ファイル。いずれも無ければ `scripts/` 配下。`demo`・`src/routes/stories`・先頭に `/* @refactor-ignore */` を持つファイルは除外。
- スコープ拡張: import グラフを双方向に最大3段階たどり、新規0件で止める。拡張後の集合を印字する。
- **候補の集計**: eslint の件数と file:line — 行数・複雑度（`max-lines` / `max-lines-per-function` / `complexity` / `sonarjs/cognitive-complexity`）、型の安全性（`@typescript-eslint/no-explicit-any`）、名前空間エクスポート（`local/namespace-object-export`）、重複コード（`sonarjs/no-identical-functions`）、変数名の書式（`@typescript-eslint/naming-convention`）、重複文字列（`sonarjs/no-duplicate-string`）、マジックナンバー（`@typescript-eslint/no-magic-numbers`）、未使用コード（低優先度: `@typescript-eslint/no-unused-vars`）。件数は `pnpm josh gate` の eslint と同一。
- inline config: gate と同じ設定を使い、外部形式のキーなどに付けた有効な例外は候補に数えない。抑制されていない規約違反は引き続き報告する。
- 収束判定: 高・中優先度の候補が0件なら `verdict: clear`、残れば `verdict: candidates`。低優先度は報告のみで数えない。

行数はコード行数（`max-lines` / `max-lines-per-function` は `skipBlankLines` と `skipComments` 有効）。`wc -l` ではなくこのコマンドの報告で判断する。

---

## コマンドが見ない、目視で残すもの

次の2つは機械判定できないため、コマンドの結果に加えて必ず目視で確認する：

- **副作用の冪等性**: 一度だけ実行すべき副作用（intersection observer・イベントハンドラ・コールバック）に、状態チェックで早期 return するガード節があるか。
- **似た UI 構造**: 複数箇所の同じ UI パターンを、props で差を吸収する共通コンポーネントにまとめられないか。

---

## 「リファクタリングを提案して」の動作

1. `refactor:scan` で候補を洗い出し、目視2項目で補う
2. 高・中優先度 → すべて提案（件数制限なし）／すべて低優先度なら最大3つ
3. 実装はせず、コメントでなく実装可能なサンプルコードを示す
4. このプロンプトの説明はせず、直接提案に移る

---

## 「リファクタリングして」の動作

対象範囲は「対象ファイル」と同一。

```text
[テスト準備] 対象のふるまいを検証する unit/E2E テストを先に実装し、グリーンを確認してから構造変更を始める
[1回目]    refactor:scan の候補 + 目視2項目 → 優先度高・中をすべて実施
[2回目以降] refactor:scan を再実行 → 漏れがあれば実施
[完了]     `verdict: clear` かつ目視2項目も0件 → 低優先度のみ報告して完了
```

- 高・中が0件になるまで、ユーザーの再依頼なしに繰り返す
- 低優先度は自動実施せず報告のみ
- 毎回「N回目の分析」「残り候補: X件」と進捗を示す

## 部分的に lint が当たる項目（目視で補う）

lint が一部の面しか見ない項目だけを挙げる。コーディング規約・命名規則は `CLAUDE.md` を参照。

### 高優先度

- **責務の分離**: 行数が収まっていても複数責任が混在していれば、再利用可能・独立した機能を別ファイルに分ける（`max-lines` は大きさだけを見る）。
- **リテラル型の保持**: データ配列は `as const satisfies T` でリテラル型を保つ（型注釈のみでは `string` に widen される。`prefer-as-const` は肩代わりしない）。

### 中優先度

- **変数名の意味**: `@typescript-eslint/naming-convention` は書式だけを見る。意味が不明確・実態と合わない名前は見直す。
- **類似コードの共通化**: `sonarjs/no-identical-functions` は完全一致だけを検出する。似ているが同一でないコードは目視で共通化を判断する。

### 低優先度

- **不要コメントの整理**: 冗長・陳腐化したコメントを削除する。

---

## 基本方針

- 可読性・保守性・パフォーマンス・AI コストは同列で、どれも悪化させない（`prompts/collaboration-workflow/principles.md` → "quality-priority"）
- コードクローンの排除・メソッド抽出・共通コンポーネント化は必ず分析・提案に含める
- `async () => await fn()` → `() => fn()` の簡素化は提案しない
- 提案が無ければ無理に提案しない

---

## 提案の形式

各提案: 優先度 / 問題点 / 改善案と効果 / サンプルコード（プロジェクト規約準拠、lint エラーなし）/ 影響ファイル

## 実装後の品質保証（絶対遵守）

実装後は `pnpm josh lint:related` → `pnpm josh gate` の順で全関与ファイルを確認し、エラー0件になるまで修正する。エラーが残ったまま完了報告しない。レーン子の gate は `josh ship` が回す（`.claude/skills/workflow-commands/chain-rule.md` → "Run the review-to-merge chain" step 0）。
