export function getUserFacingErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
  if (!message) return fallback;
  if (/already (?:used|in use|taken)|username[_ ]unavailable/i.test(message)) {
    return 'That in-game name is already taken. Choose another one.';
  }
  if (/\b(invalid username|3[–-]16 letters|letters, numbers, or underscores)\b/i.test(message)) {
    return 'Use 3–16 letters, numbers, or underscores for your in-game name.';
  }
  if (/discord sign-in expired|start the sign-in flow again/i.test(message)) {
    return 'Discord sign-in expired. Start again and finish the sign-in in your browser.';
  }
  if (/change your in-game name again after/i.test(message)) return message;
  if (/discord account is already linked to (?:a )?(?:different )?minecraft profile|already linked to a different minecraft profile/i.test(message)) {
    return 'This Discord account is linked to another Minecraft profile. Sign in with that profile to use its cosmetics.';
  }
  if (/\b(fetch failed|network|socket|econn|timed? ?out|could not reach)\b/i.test(message)) {
    return 'Could not reach the DewClient account server. Check your connection and try again.';
  }
  if (/\b(internal server error|account creation failed|could not be saved right now|temporarily unavailable|try again shortly)\b/i.test(message)) {
    return 'DewClient could not save your profile right now. Please try again shortly.';
  }
  if (/error invoking remote method|discord account sign-in failed \(\d{3}\)|supabase|postgrest|postgres|sqlstate|pgrst|auth\.supabase|authapierror|database|constraint|stack trace|\bhttp \d{3}\b/i.test(message) || message.length > 180) {
    return fallback;
  }
  return message;
}
