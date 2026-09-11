#!/usr/bin/env node
/**
 * Alysis Code Farm v2 — Pure API (Google OAuth + Device Code → slk_ key)
 *
 * Flow per account:
 *   1. Google OAuth via Camoufox → Supabase access_token + refresh_token
 *   2. POST /functions/v1/device-code → device_code + user_code
 *   3. POST /rest/v1/rpc/approve_device {p_user_code} → 204 (with user JWT)
 *   4. Poll /functions/v1/device-token → slk_ key
 *
 * Usage: node farm.js [--count N] [--start N] [--accounts FILE]
 */
const { firefox } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ─── Config ────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://vzigujbcjjmpntxhmyvr.supabase.co';
const SITE_URL = 'https://alysiscode.com';
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.txt');
const OUTPUT_FILE = path.join(__dirname, 'apikeys.txt');
const DELAY_BETWEEN = 5000; // ms between accounts

// ─── Helpers ───────────────────────────────────────────────────────
const delay = ms => new Promise(r => setTimeout(r, ms));
const log = (msg, icon = '•') => console.log(`${icon} ${msg}`);

function loadAccounts(file) {
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && l.includes('|'))
    .map(l => { const [email, password] = l.split('|'); return { email, password }; });
}

// ─── Auto-detect Camoufox binary ──────────────────────────────────
function findCamoufox() {
  const cacheDir = path.join(require('os').homedir(), '.cache', 'camoufox', 'browsers', 'official');
  if (!fs.existsSync(cacheDir)) {
    throw new Error('Camoufox not found. Install: pip install camoufox && camoufox fetch');
  }
  const versions = fs.readdirSync(cacheDir).sort().reverse();
  for (const ver of versions) {
    const bin = path.join(cacheDir, ver, 'camoufox');
    if (fs.existsSync(bin)) return bin;
    // Try linux subdirectory
    const linuxBin = path.join(cacheDir, ver, 'camoufox');
    if (fs.existsSync(linuxBin)) return linuxBin;
  }
  throw new Error('Camoufox binary not found in ' + cacheDir);
}

// ─── Auto-extract Supabase anon key from alysiscode.com ───────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function extractAnonKey() {
  log('Extracting Supabase anon key from alysiscode.com...', '🔍');
  // Step 1: Get HTML and find all JS/CSS asset URLs
  const html = await fetchUrl(SITE_URL);
  const jsFiles = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  log(`Found ${jsFiles.length} JS files`, '📄');

  // Step 2: Search each JS file for a Supabase anon key (JWT with supabase ref nearby)
  for (const jsPath of jsFiles) {
    const jsUrl = SITE_URL + jsPath;
    const jsData = await fetchUrl(jsUrl);
    const match = jsData.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    if (match && jsData.includes('supabase')) {
      log(`Anon key extracted from ${jsPath} (${match[0].length} chars)`, '✅');
      return match[0];
    }
  }
  throw new Error('Could not extract anon key from alysiscode.com JS bundles');
}

// ─── Step 1: Google OAuth → Supabase session ──────────────────────
async function getSupabaseToken(browser, email, password, index, total) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Capture access_token from callback URL hash
    let accessToken = null;
    let refreshToken = null;
    page.on('framenavigated', f => {
      if (f === page.mainFrame() && f.url().includes('auth/callback#')) {
        const params = new URLSearchParams(f.url().split('#')[1]);
        accessToken = params.get('access_token');
        refreshToken = params.get('refresh_token');
      }
    });

    // Navigate to Supabase Google OAuth authorize URL
    const oauthUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(SITE_URL + '/auth/callback')}`;
    log(`[${index}/${total}] Google OAuth: ${email}`, '▶️');
    await page.goto(oauthUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(3000);

    // Enter email on Google sign-in
    log(`[${index}] Entering email...`, '📧');
    await page.locator('#identifierId').fill(email, { timeout: 10000 });
    await page.locator('#identifierNext').click({ force: true, noWaitAfter: true, timeout: 5000 });
    await delay(4000);

    // Enter password
    const hasPw = await page.locator('input[type="password"]:visible').count();
    if (hasPw > 0) {
      log(`[${index}] Entering password...`, '🔑');
      await page.locator('input[type="password"]:visible').first().fill(password, { timeout: 10000 });
      await page.locator('#passwordNext').click({ force: true, noWaitAfter: true, timeout: 5000 });
      await delay(8000);
    } else {
      const body = await page.evaluate(() => document.body?.innerText?.substring(0, 200));
      throw new Error(`No password field. Page: ${body.substring(0, 80)}`);
    }

    // Handle Workspace Terms of Service speedbump (new GSuite accounts)
    const postPwdUrl = page.url();
    if (postPwdUrl.includes('speedbump') || postPwdUrl.includes('workspaceterms')) {
      log(`[${index}] Workspace ToS speedbump — clicking "I understand"...`, '📄');
      await page.locator('#gaplustosNext').click({ force: true, noWaitAfter: true, timeout: 5000 });
      await delay(5000);
    }

    // Handle Google consent screen ("Izinkan"/"Allow")
    try {
      const consentBtn = page.locator('#submit_approve_access');
      if (await consentBtn.count() > 0 && await consentBtn.isVisible()) {
        log(`[${index}] Clicking consent (Allow)...`, '✔️');
        await consentBtn.click({ force: true, noWaitAfter: true, timeout: 3000 });
        await delay(10000);
      }
    } catch {}

    // Wait for tokens to be captured
    for (let i = 0; i < 20; i++) {
      if (accessToken) break;
      await delay(500);
    }

    if (!accessToken) {
      throw new Error(`No access_token captured. Final URL: ${page.url().substring(0, 80)}`);
    }

    log(`[${index}] Got Supabase session ✅`, '✅');
    return { accessToken, refreshToken };
  } finally {
    await context.close();
  }
}

// ─── Step 2-4: Device code → Approve → Get slk_ key ───────────────
async function getApiKey(accessToken, anonKey, index) {
  // Step 2: Create device code
  const dcResp = await fetch(`${SUPABASE_URL}/functions/v1/device-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey },
    body: JSON.stringify({ client_name: 'alysis-farm' })
  });
  if (!dcResp.ok) throw new Error(`Device code failed: ${dcResp.status}`);
  const dcData = await dcResp.json();
  log(`[${index}] Device code: ${dcData.user_code}`, '🔗');

  // Step 3: Approve device code via Supabase RPC with user JWT
  const approveResp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/approve_device`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'apikey': anonKey
    },
    body: JSON.stringify({ p_user_code: dcData.user_code })
  });
  if (approveResp.status !== 204 && !approveResp.ok) {
    const err = await approveResp.text();
    throw new Error(`Approve failed (${approveResp.status}): ${err.substring(0, 100)}`);
  }
  log(`[${index}] Device approved`, '✅');

  // Step 4: Poll for API key
  for (let i = 0; i < 10; i++) {
    await delay(2000);
    const pollResp = await fetch(`${SUPABASE_URL}/functions/v1/device-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey },
      body: JSON.stringify({ device_code: dcData.device_code })
    });
    const pollData = await pollResp.json();
    if (pollData.key) {
      log(`[${index}] API Key: ${pollData.key.substring(0, 30)}...`, '🔑');
      return pollData.key;
    }
    if (pollData.status === 'expired' || pollData.status === 'denied') {
      throw new Error(`Device code ${pollData.status}`);
    }
  }
  throw new Error('Timed out waiting for API key');
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  Alysis Code Farm v2 — API-only (no browser approve) ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  // Parse args
  const args = process.argv.slice(2);
  let count = 999, start = 0, accountsFile = ACCOUNTS_FILE;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) count = parseInt(args[++i]);
    if (args[i] === '--start' && args[i + 1]) start = parseInt(args[++i]);
    if (args[i] === '--accounts' && args[i + 1]) accountsFile = path.resolve(args[++i]);
  }

  // Auto-detect Camoufox
  let camoufoxBin;
  try {
    camoufoxBin = findCamoufox();
    log(`Camoufox: ${camoufoxBin}`, '🌐');
  } catch (e) {
    console.error('❌ ' + e.message);
    process.exit(1);
  }

  // Auto-extract anon key
  let anonKey;
  try {
    anonKey = await extractAnonKey();
  } catch (e) {
    console.error('❌ ' + e.message);
    process.exit(1);
  }

  const accounts = loadAccounts(accountsFile).slice(start, start + count);
  console.log(`📋 Total accounts: ${accounts.length} (start=${start})\n`);

  // Launch browser once
  let browser;
  try {
    browser = await firefox.launch({
      executablePath: camoufoxBin,
      headless: true
    });
  } catch (e) {
    console.error('❌ Failed to launch Camoufox:', e.message);
    console.error('   Make sure Xvfb is running: Xvfb :99 -screen 0 1920x1080x24 &');
    process.exit(1);
  }

  // Ensure Xvfb
  if (!process.env.DISPLAY) process.env.DISPLAY = ':99';

  const results = { success: 0, failed: 0, keys: [] };

  for (let i = 0; i < accounts.length; i++) {
    const { email, password } = accounts[i];
    const idx = start + i + 1;

    try {
      // Step 1: Google OAuth → Supabase token
      const { accessToken } = await getSupabaseToken(browser, email, password, idx, accounts.length);

      // Step 2-4: Device code → Approve → Key
      const apiKey = await getApiKey(accessToken, anonKey, idx);

      // Save key
      results.keys.push({ email, key: apiKey });
      fs.appendFileSync(OUTPUT_FILE, `${email}|${apiKey}\n`);
      results.success++;
      log(`[${idx}] ✅ DONE: ${email} → ${apiKey}`, '🎉');
    } catch (e) {
      results.failed++;
      log(`[${idx}] ❌ FAILED: ${email} — ${e.message}`, '❌');
    }

    // Delay between accounts
    if (i < accounts.length - 1) {
      log(`Waiting ${DELAY_BETWEEN / 1000}s...`, '⏳');
      await delay(DELAY_BETWEEN);
    }
  }

  await browser.close();

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ✅ SUCCESS: ${results.success}/${accounts.length}  ❌ FAILED: ${results.failed}`);
  console.log(`  Keys saved to: ${OUTPUT_FILE}`);
  console.log('══════════════════════════════════════════════════════════\n');

  // Print summary
  if (results.keys.length > 0) {
    console.log('📋 Keys:');
    for (const k of results.keys) {
      console.log(`  ${k.email} → ${k.key}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
