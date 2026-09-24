# T44 セキュリティ・RLS・削除の横断検証

**状態**：未着手  
**フェーズ**：M7 品質・CI/CD・公開  
**推奨実装順**：44/47（番号順ではなく[実装計画](../docs/implementation-plan.md)第3章の順序）  
**一覧へ戻る**：[implementation-tickets.md](../docs/implementation-tickets.md)

## 目的

公開前の個人情報・権限・秘密漏えいを防ぐ。

## 対応要件ID

| ID | 要件定義書の要件 |
| --- | --- |
| SEC-01 | テスト用の認証省略機能と管理権限を公開環境の一般利用者に開放しない。 |
| SEC-02 | 公開デモの模擬SMSとDevelopment/Testの認証省略は別機能とする。模擬SMSでもコードの照合を必須とし、省略設定を本番環境で有効にできない。 |
| ACC-06 | メール確認・SMS認証を省略する仕組みはDevelopment/Test環境だけで利用でき、本番環境では有効化できない。 |
| INV-03 | 同時注文でも販売可能在庫を超えて引き当てない。引当期限と再試行時の詳細な状態遷移を定める。 |
| QLT-01 | 主要操作、異常系、権限、在庫・金額の整合性について受け入れ条件を作る。 |

要件定義書の「詳細化待ち」および古い確認待ち表記は、後続の利用者承認と詳細設計の確定内容を適用する。

## 参照する設計箇所

- [要件定義書（正本）](../output/pdf/自作PCパーツECサイト_要件定義書_レビュー版.pdf)：上記5件の要件ID。
- [基本設計書](../output/pdf/自作PCパーツECサイト_基本設計書_レビュー版.pdf)：§5、§10、§12。
- [詳細設計書](../output/pdf/自作PCパーツECサイト_詳細設計書_レビュー版.pdf)：§5、§9、§10、§11、§12。
- [詳細設計の編集原稿](../docs/detailed-design-review.md)：同章の表・状態・例外・画面IDを実装時に確認する。
- [実装計画](../docs/implementation-plan.md)・[AGENTS.md](../AGENTS.md)：作業順序と共通ガードレール。

## 依存チケット

- [T09 公開データ・StorageのRLS SQL](T09-public-storage-rls.md)
- [T10 本人・管理者のRLS SQL](T10-member-admin-rls.md)
- [T17 Supabase SSRとメール・パスワード認証](T17-supabase-email-auth.md)
- [T18 Google OAuth](T18-google-oauth.md)
- [T20 Supabase Send Email HookとSMTP送信](T20-auth-email-hook-smtp.md)
- [T19 模擬SMSと再設定のOTP](T19-mock-sms-password-reset.md)
- [T21 配送先と会員画面](T21-member-address-ui-api.md)
- [T29 原子的な注文作成・在庫引当](T29-atomic-order-stock-allocation.md)
- [T30 Stripe CheckoutテストSession](T30-stripe-test-checkout-session.md)
- [T31 Stripe Webhookと決済状態](T31-stripe-webhook-state.md)
- [T32 期限切れ照合と補償ジョブ](T32-payment-expiry-reconciliation.md)
- [T33 決済結果・注文履歴画面](T33-checkout-result-order-history.md)
- [T34 注文・認証通知のジョブ](T34-order-notification-jobs.md)
- [T22 アカウント削除と30日消去](T22-account-retention-deletion.md)
- [T36 管理者判定と管理画面シェル](T36-admin-auth-shell.md)
- [T37 商品・仕様・画像の管理](T37-admin-products-specs-images.md)
- [T38 在庫調整の管理](T38-admin-inventory-adjustment.md)
- [T39 注文・決済状態の管理閲覧](T39-admin-orders-payments-readonly.md)
- [T40 発送元・送料規則の管理](T40-admin-shipping-settings.md)
- [T41 SMTP設定の管理](T41-admin-smtp-settings.md)

## 対象範囲

- 全表RLS、管理API、認証、秘密、30日削除の横断監査。

## 実装内容

- 全表RLSマトリクス、管理API、Origin/Cookie/CSP、レート制限、Production認証省略拒否、秘密スキャン、30日削除・バックアップ保持条件を検証。
- Origin/Cookie/CSP、レート制限、自己昇格拒否、ライブ鍵拒否、バックアップ保持、削除ジョブを検証する。
- 入出力・DB・権限・画面に変更がある場合は、同じチケット内で対応するOpenAPI、Zod、マイグレーション、RLS、テスト、文書を整合させる。

## 対象外

- 仕様緩和によるテスト合格、未承認の有料セキュリティ製品。
- 他チケットの機能と、正本にない仕様の独断追加。必要なら変更案を報告する。

## 受け入れ条件

- 会員間隔離、管理者自己付与不可、ライブStripe鍵不在、個人情報30日削除が確認できる。問題は隠さず修正チケット化。
- 会員間隔離とProduction省略不可を証拠付きで示す。
- 設計との不整合、秘密・個人情報の露出、権限の迂回がない。外部設定が未完了なら接続確認を完了扱いにしない。

## 必要なテスト

- RLS許可拒否、API侵入ケース、秘密スキャン、削除統合、手動セキュリティレビュー。
- RLSマトリクス、秘密スキャン、削除・越権・レート制限を試す。
- 該当する境界・異常・権限のケースを実行し、既存の関連回帰テストも通す。実行できない場合は理由を記録する。

## 完了条件

- 対象範囲の成果物と受け入れ条件が揃い、指定テストの結果を記録した。
- チケット外の変更、設計上の疑問、外部作業の未完了を隠さず報告した。
- 変更点、設計根拠、テスト結果、残課題をLUNAの完了報告に記載し、レビュー可能な差分になっている。
