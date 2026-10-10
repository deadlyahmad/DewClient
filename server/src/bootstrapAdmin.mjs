import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CONFIG } from './config.mjs';
import { fetchSupabase } from './services/supabaseHttp.mjs';
import { AuthService } from './services/authService.mjs';

function readHidden(prompt, environmentValue) {
  if (environmentValue) return Promise.resolve(environmentValue);
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Use an interactive terminal or set the documented bootstrap password environment variables.'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    const finish = (error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Bootstrap cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (character >= ' ') value += character;
      }
    };
    stdin.on('data', onData);
  });
}

async function bootstrapAdmin() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY are required.');
  }

  const terminal = createInterface({ input: stdin, output: stdout });
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || await terminal.question('First admin email: ')).trim().toLowerCase();
  const displayName = (await terminal.question('Display name (optional): ')).trim();
  terminal.close();

  const password = await readHidden('Password (12 characters minimum): ', process.env.BOOTSTRAP_ADMIN_PASSWORD);
  const confirmation = await readHidden('Confirm password: ', process.env.BOOTSTRAP_ADMIN_PASSWORD_CONFIRM);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (password.length < 12 || password.length > 256) throw new Error('Password must be between 12 and 256 characters.');
  if (password !== confirmation) throw new Error('The passwords do not match.');

  const passwordHash = AuthService.hashPassword(password);
  const response = await fetchSupabase(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/dew_bootstrap_admin`, {
    method: 'POST',
    headers: {
      apikey: CONFIG.SUPABASE_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_email: email, p_password_hash: passwordHash, p_display_name: displayName || null })
  });
  if (!response.ok) {
    if ([400, 409].includes(response.status)) throw new Error('Bootstrap refused: an active administrator already exists or the database schema is not current.');
    throw new Error(`Admin bootstrap failed (${response.status}); check the database migration and server credentials.`);
  }

  passwordHash.replace(/./g, '');
  console.log(`Created the first active administrator: ${email}`);
}

bootstrapAdmin().catch((error) => {
  console.error(`[BOOTSTRAP] ${error.message}`);
  process.exitCode = 1;
});
