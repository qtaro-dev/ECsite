# T46 GitHub Actions・Vercel・SupabaseのCI/CD

**状態**：未着手  
**フェーズ**：M7 品質・CI/CD・公開  
**推奨実装順**：46/47（番号順ではなく[実装計画](../docs/implementation-plan.md)第3章の順序）  
**一覧へ戻る**：[implementation-tickets.md](../docs/implementation-tickets.md)

## 目的

レビューと環境分離を保って公開できるようにする。

## 対応要件ID

| ID | 要件定義書の要件 |
| --- | --- |
| QLT-01 | 主要操作、異常系、権限、在庫・金額の整合性について受け入れ条件を作る。 |
| SEC-01 | テスト用の認証省略機能と管理権限を公開環境の一般利用者に開放しない。 |
| SEC-02 | 公開デモの模擬SMSとDevelopment/Testの認証省略は別機能とする。模擬SMSでもコードの照合を必須とし、省略設定を本番環境で有効にできない。 |

要件定義書の「詳細化待ち」および古い確認待ち表記は、後続の利用者承認と詳細設計の確定内容を適用する。

## 参照する設計箇所

- [要件定義書（正本）](../output/pdf/自作PCパーツECサイト_要件定義書_レビュー版.pdf)：上記3件の要件ID。
- [基本設計書](../output/pdf/自作PCパーツECサイト_基本設計書_レビュー版.pdf)：§2、§12。
- [詳細設計書](../output/pdf/自作PCパーツECサイト_詳細設計書_レビュー版.pdf)：§11、§12、§13。
- [詳細設計の編集原稿](../docs/detailed-design-review.md)：同章の表・状態・例外・画面IDを実装時に確認する。
- [実装計画](../docs/implementation-plan.md)・[AGENTS.md](../AGENTS.md)：作業順序と共通ガードレール。

## 依存チケット

- [T05 CIの最小ゲート](T05-ci-baseline.md)
- [T45 全体E2Eと性能検収](T45-full-e2e-performance.md)
- **外部作業ゲート**：G-GitHub/G-Vercel/G-Supabase。接続・認証・費用が必要な段階で利用者へ具体的に提示する。

## 対象範囲

- GitHub Actions、Vercel Git連携、別Supabase Preview/Production。

## 実装内容

- CIにDB/RLS/Playwrightを追加、PR Preview、main Production、別Supabaseプロジェクト、マイグレーション適用ゲート、環境別変数、失敗時ロールバック手順。アプリはVercel Git連携でデプロイし、Actionsから二重デプロイしない。
- PRのDB/RLS/Playwright、main公開、環境別秘密、監督付きDB適用、復旧手順を整える。
- 入出力・DB・権限・画面に変更がある場合は、同じチケット内で対応するOpenAPI、Zod、マイグレーション、RLS、テスト、文書を整合させる。

## 対象外

- Actionsからの二重Vercelデプロイ、無承認の有料プラン。
- 他チケットの機能と、正本にない仕様の独断追加。必要なら変更案を報告する。

## 受け入れ条件

- PreviewがProductionの個人情報・秘密・DBを共有せず、PR必須チェック失敗でmain反映できない。Productionにライブ決済鍵なし。
- PreviewがProductionの個人情報・鍵を共有せず、失敗チェックでmain反映を防ぐ。
- 設計との不整合、秘密・個人情報の露出、権限の迂回がない。外部設定が未完了なら接続確認を完了扱いにしない。

## 必要なテスト

- PR Preview、mainのテストデプロイ、環境変数差分・DB適用順・ロールバック演習。
- PR Preview、テストデプロイ、環境差分、マイグレーション/復旧演習を行う。
- 該当する境界・異常・権限のケースを実行し、既存の関連回帰テストも通す。実行できない場合は理由を記録する。

## 完了条件

- 対象範囲の成果物と受け入れ条件が揃い、指定テストの結果を記録した。
- チケット外の変更、設計上の疑問、外部作業の未完了を隠さず報告した。
- 変更点、設計根拠、テスト結果、残課題をLUNAの完了報告に記載し、レビュー可能な差分になっている。
