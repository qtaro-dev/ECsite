# 管理者権限の手動運用

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
