/** Supabase anonymous users are signed-in users, not an auth bypass. */
export function isDemoUser(user: { is_anonymous?: boolean } | null | undefined): boolean {
  return user?.is_anonymous === true;
}

export function demoAuthFailure(code?: string, status?: number): string {
  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return 'デモ開始の回数が上限に達しました。少し待ってから再試行してください。';
  }
  if (code === 'anonymous_provider_disabled') {
    return '現在デモ会員の作成を利用できません。設定を確認中です。時間をおいて再試行してください。';
  }
  return 'デモ会員を開始できませんでした。通信状態を確認し、時間をおいて再試行してください。';
}
