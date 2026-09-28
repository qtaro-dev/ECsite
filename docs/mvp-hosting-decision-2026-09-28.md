# 公開MVPの単一Hosted DB運用（2026-09-28承認）

利用者は、ECsiteを広く一般公開する運用ではなく、ブラウザで購入フローを検証し、必要に応じてポートフォリオとして提示するサイトとした。無料枠を維持するため、SupabaseのPreview用・Production用2プロジェクトという従来案を、**1プロジェクトの順次利用**へ変更した。この決定は公開環境について従来の設計・手順より優先する。認証省略、実課金、秘密の公開、他人データの共有は認めていない。

## 環境の使い方

1. Supabase `ecsite-production`（東京リージョン）を、公開前は**検証専用**として使用する。名前に`production`が含まれていても、検証を終えるまでは公開用データを入れない。`web-picross-supabase`には触れない。
2. Vercel `ecsite`はGitHub `qtaro-dev/ECsite`と接続する。検証中はVercel Previewの固定した検証URLから、このSupabaseとStripe**テストモード**へ接続する。Productionの自動デプロイが存在しても、検収前に「MVP公開済み」と表示しない。
3. T35/T43/T44/T45/T49の検証後、同じSupabaseを公開用へ**切り替える**。StripeテストWebhookの宛先・署名秘密と`NEXT_PUBLIC_SITE_URL`を公開URLへ設定し直す。切替前の未完了CheckoutとWebhook再試行を確認し、注文・在庫の状態を照合する。実データを複製しない。
4. 切替後のPR Previewには、このSupabaseのサービスロール鍵、Stripe Webhook秘密、内部ジョブ秘密を渡さず、公開DBへの書き込みを防ぐ。DB/RLS/ブラウザ統合はGitHub Actionsの隔離したローカルSupabaseで検証する。後日常設のHosted Previewが必要になった場合は、別プロジェクト枠・費用を利用者と決める。

## 必須の安全条件

- Supabase匿名Authの個別セッションとRLS、管理者拒否、架空配送先限定、30日削除を維持する。デモ利用者へ実住所・電話・メールの入力を開放しない。
- Stripeは`sk_test_*`だけを使い、Webhook署名で支払を確定する。戻りURLだけで成功にしない。
- 版管理済みSQLのみ適用し、対象Project Refとマイグレーション履歴を確認する。検証DBでも既存注文を消す`db reset --linked`はしない。
- VercelのPreview/Productionを同じDBへ同時に接続して運用しない。切替後に新しいPRを検証する際はHosted DBへの接続を外す。
- サイトには実販売・実課金・実発送なし、架空データ使用、既知の制限を表示する。最終成果は利用者がブラウザだけで商品→カート→注文→Stripeテスト決済→注文・在庫更新を確認できるURLと証拠で判定する。

## 現在の接続記録

- Vercel: `ecsite`プロジェクト作成、GitHub連携、Next.js/Node 22設定済み。初回Productionデプロイは環境変数未設定の段階で自動生成されたため、検収済みURLではない。
- Supabase: 未使用の`ai-contact-support-console`は利用者の指示で削除済み。`ecsite-production`を東京の無料枠で作成し、2026-09-28時点の23件のマイグレーションと架空商品seedを適用、匿名サインインを有効化した。接続秘密はGit・文書に保存しない。
- Vercelの初回Productionトラフィックは、利用者がCLIで`ecsite`を入力して一時停止した。検証用Previewとは別に、提示用へ切り替える時点で再開する。
