# ESLint設定ガイド - コーディング支援用

このプロジェクトのESLint設定は非常に厳格で、標準的なJavaScript/TypeScriptプロジェクトとは異なる命名規則を採用しています。新しいコード作成やリファクタリング時は必ずこのガイドを参照してください。

## 📝 基本方針

### コードの書き方

- **シンプルで読みやすく**: 複雑な実装よりも、シンプルで理解しやすいコードを優先する
- **現在の要件に集中**: 予定のない未来の拡張性を考慮せず、現在必要な機能のみを実装する
- **適切な分割**: 同一ファイルに無理に実装を詰め込まず、適宜別ファイルにロジックを分割する
- **意図が不明瞭な処理は関数に抽出**: 条件式がわかりにくい、意図がわかりにくい処理は、たとえ1行でも抽出を行い、関数名等で理解できるようにする
- **既存のコード体系に寄り添う**: 現在のコード体系に可能な限り寄り添ったうえで、更に良いコードがかけるのであれば目指すこと

### コメントとドキュメント

- **コメントは必要最小限に**: コードで表現できることはコメントにしない。コード自体が説明になるように書く
- **なぜ書いたかを説明**: 何をしているかではなく、なぜその実装にしたかを説明する場合のみコメントを書く
- **複雑なロジックのみ**: 複雑な処理や意図が伝わりにくい部分のみにコメントを追加
- **コメントは英語で記載**: コメントは英語で記載する

### 抽象化と設計

- **過度な抽象化を避ける**: 現在の要件で必要な抽象化のみを行う。将来の拡張性を考慮した抽象化は不要
- **パターンの強制は避ける**: デザインパターンやアーキテクチャパターンを無理に適用しない
- **コードの重複は撲滅**: コードクローン（重複）は完全に撲滅する。重複が見つかった場合は関数やモジュールに抽出して共通化する

### エラーハンドリング

- **シンプルなエラーハンドリング**: 複雑なエラーハンドリングロジックは避け、必要最小限の処理のみを行う
- **エラーメッセージは明確に**: エラーメッセージは原因が分かるように、簡潔に記述する

### 命名の考え方

- **意図が明確に伝わる命名**: 変数名や関数名から、何をしているかが分かるように命名する
- **略語は避ける**: 一般的でない略語は使わず、明確な単語を使用する
- **長すぎる名前も避ける**: 必要以上に長い名前は避け、適切な長さで意図を表現する

## 🚨 最重要：命名規則（標準と大きく異なる）

### ❌ よくある間違い：camelCase を使う

```typescript
// ❌ 間違い（標準的なTypeScript）
const userName = 'john'
const isLoggedIn = true
const getUserData = () => {}

// ✅ 正しい（このプロジェクト）
const user_name = 'john'
const is_logged_in = true
const get_user_data = () => {}
```

### 正しい命名規則

- **変数・関数・パラメータ**: `snake_case`
- **定数（const）**: `UPPER_CASE` または `snake_case`
- **boolean変数**: `is_`, `has_`, `should_`, `can_`, `will_`, `did_` で始める
- **型・クラス・インターフェース・Enum**: `PascalCase`
- **Enumメンバー**: `UPPER_CASE`
- **クラスプロパティ・メソッド**: `snake_case`

## 🔧 必須：型安全性ルール

### 明示的な型定義が必須

```typescript
// ❌ 間違い
const processData = (data) => {
	return data.map((item) => item.value)
}

// ✅ 正しい
const process_data = (data: Array<{ value: string }>): Array<string> => {
	return data.map((item) => item.value)
}
```

### 禁止事項

- `any` の使用は完全禁止
- 未使用変数は禁止
- 浮動Promiseは禁止
- 型アサーションは制限あり

### 早期returnの書き方

- 条件の本体が単一の `return` だけで、かつ行長が100文字未満のときは1行で書く
  `if (value === undefined) return default_value`
- 100文字以上になる、または複数ステートメントがある場合はブロック構文を使う
- **条件式が複雑な場合は関数に抽出**: 条件式の意図が不明瞭な場合は、関数に抽出して関数名で意図を明確にする

  ```typescript
  // ❌ 意図が不明瞭
  if (user.age >= 18 && user.country === 'JP' && user.verified === true) { ... }

  // ✅ 関数に抽出して意図を明確化
  if (is_eligible_for_service(user)) { ... }

  function is_eligible_for_service(user: User): boolean {
    return user.age >= 18 && user.country === 'JP' && user.verified === true
  }
  ```

### マジックナンバーと定数化

- `0`, `1`, `-1` 以外の数値リテラルは原則として定数へ抽出する
- 繰り返し使用する文字列や識別子は定数化し、意味の分かる名前を付ける

## 📁 新規作成時の手順

### 1. 既存ファイルを必ず参照

```bash
# 類似機能の既存ファイルを探す
find src -name "*.ts" -o -name "*.svelte" | grep -i [関連キーワード]
```

### 2. ファイル作成時の注意点

- **Svelteファイル**: `PascalCase.svelte`（例: `UserProfile.svelte`）
- **`*.svelte.ts` ファイル**: Svelte のリアクティブな状態やロジックを格納するファイルも `PascalCase.svelte.ts` 形式とする（例: `ThemeStore.svelte.ts`, `LocaleStore.svelte.ts`）
- **TypeScriptファイル**: `kebab-case.ts`（例: `user-service.ts`）
- **ルートファイル**: `+page.svelte`, `+layout.svelte` などは例外
- **関数定義**: `function` で表現できる処理はアロー関数ではなく通常の `function` 構文で記述する
- **複数関数のエクスポート**: 複数の関数を公開する場合は名前空間オブジェクト（namespace object）にまとめてエクスポートする（定数のみのエクスポートは個別で問題ない）

### ファイル分割の指針

- **複雑度が高い場合**: 関数の複雑度が4を超える、または行数が25行を超える場合は分割を検討
- **責任が複数ある場合**: 1つのファイルが複数の責任を持つ場合は、責任ごとにファイルを分割
- **再利用性**: 他のファイルからも使用される可能性があるロジックは、別ファイルに分離
- **メインファイルの肥大化を避ける**: メインファイルの肥大化を避けることを優先する。再利用可能な機能や独立した責任を持つ機能は、積極的に別ファイルに分割する。メインファイルは主要な処理フローに集中し、詳細な実装は別ファイルに分離する
- **過度な分割は避ける**: 小さすぎるファイルの分割は避け、関連する機能は同じファイルにまとめる

### 3. インポート/エクスポート規則

```typescript
// ❌ 間違い
export default class UserService {}

// ✅ 正しい
export class UserService {}
export type { UserData }
```

#### 名前空間オブジェクトエクスポート（必須）

**重要**: 複数の関数を公開する場合は、必ず名前空間オブジェクト（namespace object）にまとめてエクスポートする。リファクタリング時も同様に適用する。

**注意**: このルールは**関数のみ**に適用される。定数（`const`で定義された値やオブジェクト）は個別エクスポートで問題なく、名前空間オブジェクトにまとめる必要はない。

```typescript
// ❌ 間違い: 個別の関数エクスポート
async function exec_git_branch(): Promise<string> {
	return await exec_git_command('rev-parse --abbrev-ref HEAD')
}

async function exec_git_status(): Promise<string> {
	return await exec_git_command('status --porcelain')
}

export { exec_git_branch, exec_git_status }
```

```typescript
// ✅ 正しい: 名前空間オブジェクトエクスポート
// ファイル名: git-command.ts
// 名前空間名: git_command

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

**命名の工夫**:

- ファイル名と名前空間名で意図を明確にする（例: `git-command.ts` → `git_command`）
- メソッド名は短く、名前空間で補完する（例: `exec_git_branch()` → `git_command.branch()`）
- アロー関数は使わず、通常の`function`構文を使用する

**使用例**:

```typescript
// インポート
import { git_command } from './git/git-command.js'

// 使用
const branch_name = await git_command.branch()
const status_output = await git_command.status()
```

## 🧹 必須：Lintチェック手順

### 基本ルール

- **ファイルを変更したときは、最後にかならず lint チェックを行うこと**
- エラーがある場合は修正してからコミットする
- 変更したファイルだけでなく、依存関係にあるファイルも含めてチェックする

### チェック対象

- 編集したファイル、新規作成したファイル、削除したファイル（インポート元がある場合）
- 依存ファイル：変更したファイルからインポートしているファイル、変更したファイルがインポートしているファイル、同じ機能領域のファイル

### 編集後の必須作業

```bash
# 1. ESLintチェック
pnpm run lint

# 2. エラーがある場合は修正
pnpm run lint:fix

# 3. 型チェック
pnpm run check

# 4. 最終確認
pnpm run build
```

### Agentモード運用（報告＝Lintゼロの保証）

1. **変更完了直後にLintを実行**
   - `read_lints([変更ファイルの絶対パス配列])` で初期確認
   - **必須**: `pnpm run lint` で検証（`read_lints` は一部のESLintルールやPrettierを検出しないため）
   - エラーが1件でもあれば修正→再実行。ゼロになるまで報告禁止

2. **複数ファイル変更時**
   - すべての関与ファイルを明示的に指定してチェック
   - 大きな変更はファイル群ごとに区切り、群ごとにLintゼロを達成してから次へ

3. **報告文**
   - 「Lint: 0 errors（確認対象: 変更ファイル/またはsrc配下）」を明記
   - ゼロ以外は報告不可

**`read_lints` の制限**: 一部のESLintルール（例: `id-length`）やPrettierのフォーマットチェックを検出しない。報告前に必ず `pnpm run lint` で再確認すること。

補足: 本運用ルールの機械可読版は `prompts/agent-lint-protocol.json` に格納。

### よくあるLintエラーと対処法

#### 1. 命名規則エラー

```bash
# エラー例
error: Identifier 'userName' is not in snake_case

# 修正
const user_name = 'john'; // snake_caseに変更
```

#### 2. 型定義エラー

```bash
# エラー例
error: Missing return type on function

# 修正
const get_user_data = (): UserData => { // 戻り値の型を明記
```

#### 3. 未使用変数エラー

```bash
# エラー例
error: 'unusedVar' is defined but never used

# 修正
const _unused_var = 'value'; // アンダースコアプレフィックス
```

## 🎯 プロジェクト固有の設定

### Svelte固有ルール

- `$state` などのリアクティブ変数は再代入可能
- Propsインターフェース名は `Props` で許可
- DOM操作は制限あり

### ファイル除外設定

以下のファイルはESLint対象外：

- `.storybook/**`
- `*.config.js`
- `src/routes/demo/**`
- `src/stories/**`

### リファクタリング除外設定

ファイル先頭に `/* @refactor-ignore */` コメントが含まれるファイルは、リファクタリング提案や参考コードとして使用する際の対象から除外されます。

```typescript
#!/usr/bin/env node
/* @refactor-ignore */
// このファイルはリファクタリング対象外です
```

### 複雑度制限

- **関数の複雑度**: 最大4
- **ネストレベル**: 最大1
- **関数の行数**: 最大25行
- **ファイルの行数**: 最大300行
- **パラメータ数**: 最大3個

## 🔍 デバッグ用コマンド

### 特定ファイルのLintチェック

```bash
pnpm exec eslint src/path/to/file.ts
```

### 自動修正可能なエラーを修正

```bash
pnpm exec eslint --fix src/path/to/file.ts
```

### 型チェックのみ

```bash
pnpm exec tsc --noEmit
```

## ⚠️ よくある間違いトップ5

1. **camelCase使用** → `snake_case`に変更
2. **型定義省略** → 明示的な型定義を追加
3. **any使用** → 適切な型を定義
4. **Lintチェック忘れ** → 必ず`pnpm run lint`実行
5. **既存ファイル未参照** → 類似機能のファイルを必ず確認

### その他のよくある間違い

- **過度な抽象化** → 現在の要件に必要な抽象化のみを行う
- **不要なコメント** → コードで表現できることはコメントにしない
- **未来の拡張性を考慮** → 現在必要な機能のみを実装する
- **意図が不明瞭な条件式** → 複雑な条件式や意図が伝わりにくい処理は関数に抽出して関数名で意図を明確にする

## 📋 チェックリスト

新規作成・リファクタリング時：

- [ ] 既存の類似ファイルを参照した
- [ ] 命名規則（snake_case）を守った
- [ ] 明示的な型定義を追加した
- [ ] `any`を使用していない
- [ ] `pnpm run lint`でエラーがない
- [ ] `pnpm run check`で型エラーがない
- [ ] 複雑度制限内に収まっている
- [ ] コードがシンプルで読みやすいか
- [ ] 現在の要件に集中しているか（未来の拡張性を考慮していないか）
- [ ] 過度な抽象化をしていないか
- [ ] 不要なコメントがないか
- [ ] 適切にファイル分割されているか
- [ ] コードの重複（クローン）がないか
- [ ] 条件式や意図が不明瞭な処理を関数に抽出しているか
- [ ] 複数の関数を公開する場合は名前空間オブジェクトにまとめてエクスポートしているか（**注意**: 関数のみに適用。定数は個別エクスポートで問題ない）

---

**重要**: このプロジェクトのESLint設定は標準と大きく異なります。必ずこのガイドを参照し、既存ファイルのパターンに従ってコーディングしてください。
