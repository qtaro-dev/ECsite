# 管理者権限の手動運用

## 公開サイトでの初回管理者作成（初回のみ）

初回の所有者だけは、サイト内で `/admin-setup` から管理者アカウントを作成できます。セットアップ画面が閉じた後の追加・取消しは、引き続き下記のDB運用手順を使います。一般会員登録から管理者権限を得ることはできません。

1. `openssl rand -base64 48` などで一時コードを生成します（32バイト以上のランダム値）。コードをチャット、Git、URL、チケット、ログへ貼らず、パスワード管理ツール等へ一時保管します。
2. VercelのECsiteプロジェクトで、公開サイトのデプロイ環境に `ADMIN_SETUP_CODE` をサーバー専用環境変数として登録します。`NEXT_PUBLIC_` を付けず、値をログや画面へ出さないでください。登録後に対象環境を再デプロイします。
3. T56のDB migrationを通常のmigration手順で対象Supabaseへ適用します。Hosted DBをダッシュボードから直接変更しません。
4. 公開サイトの `/admin-setup` を開き、一時コード、管理者メールアドレス、12文字以上の本人用パスワードを入力します。成功後は `/admin-login` からログインし、`/admin` を開けることを確認します。
5. 初回作成のため、現在SMTPメール送信が未設定の環境では、コードを保持する所有者だけが利用できる例外としてAuthメール確認済み状態で作成します。メール確認を省略するのは、この一回限りの所有者セットアップだけです。通常の会員登録には適用されません。
6. セットアップ後は画面が自動で閉じ、DBの永続claimも残ります。管理者ユーザーを削除しても再開しません。初回コードはVercelから削除し、再デプロイして破棄します。

セットアップは同一Originのみ受け付け、10分あたりIP単位で10回までに制限します。初回claim、管理者付与、監査記録はDBトランザクションで一度に確定し、Auth作成後の付与失敗時はそのリクエストが作成したAuthユーザーの削除を試みます。セットアップコードは監査・ログへ保存しません。

Vercel環境変数の作成、migration適用、再デプロイなど本人アカウントを使う操作は、作業担当者が利用者へ必要内容を案内します。コードとパスワードは利用者本人が入力します。

管理者権限は通常の管理画面から付与できません。権限付与・取消しはデータベース運用担当者が本人確認後に実施し、SQLの実行者と対象を監査記録へ残します。本人の `auth.users.id` と付与者のIDを管理された運用経路で確認し、SQL履歴・監査ログにメールアドレスや住所を記録しません。

```sql
begin;

insert into public.admin_memberships (user_id, granted_by)
values ('<対象 auth.users.id>'::uuid, '<付与者 auth.users.id>'::uuid)
on conflict (user_id) do update
set granted_by = excluded.granted_by, granted_at = now(), revoked_at = null;

insert into public.audit_logs (actor_id, action, entity_type, entity_id, change_summary, request_id)
values (
  '<付与者 auth.users.id>'::uuid,
  'admin_membership.granted',
  'admin_membership',
  '<対象 auth.users.id>'::uuid,
  '{"changed_fields":["admin_membership"],"reason_code":"role_change"}'::jsonb,
  'manual-admin-grant-TICKET-123'
);

commit;
```

取消しは `revoked_at` を現在時刻に更新し、同じトランザクションで `admin_membership.revoked` の監査記録を追加します。`change_summary` の `changed_fields` には許可済みの `admin_membership`、`reason_code` には `role_change` を使います。`request_id` は `A–Z`, `a–z`, 数字、`_ . : -` のみで作ります。上の運用チケットID例は実際のチケットIDへ置き換えます。付与者と対象者が同じ場合も、申請者とは別の運用担当者が承認します。操作後に対象アカウントでログインできることと、一般会員アカウントで管理画面/APIが403になることを確認します。

管理APIの `requestId` とダッシュボードに表示する `auditId` は、運用チケットやサーバー側ログとの照合用識別子です。認証Cookie、サービスロール鍵、住所本文、SMTP秘密は識別子や監査の値に含めません。
