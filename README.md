# Alysis Code Farm

Automated account farming for [Alysis Code](https://alysiscode.com) — get free `slk_` API keys for DeepSeek-v4 models using Google OAuth (GSuite accounts).

## Features

- ✅ Google OAuth login via Camoufox (anti-detect browser)
- ✅ Supabase device-code flow → `slk_` API key extraction
- ✅ Auto-handle Google Workspace Terms of Service speedbump
- ✅ Fresh browser context per account (no cookie carryover)
- ✅ Batch processing with configurable count/start
- ✅ Keys saved to `apikeys.txt` (format: `email|slk_xxx`)

## Available Models

| Model | Description |
|---|---|
| `deepseek-v4-flash` | Fast inference |
| `deepseek-v4-flash-vision-exp` | Vision-capable |
| `deepseek-v4-pro` | Pro tier |
| `deepseek-v4.1-flash-expires-on-0910` | Flash v4.1 |

## API Endpoint

```
Base URL: https://vzigujbcjjmpntxhmyvr.supabase.co/functions/v1/llm/v1
Auth: Authorization: Bearer ***
```

Compatible with OpenAI SDK format — use as drop-in replacement.

## Prerequisites

1. **Node.js** v18+
2. **Camoufox** browser binary (auto-installed, or see below)
3. **Xvfb** (for headless display on Linux VPS)
4. **GSuite accounts** in `accounts.txt` (format: `email|password`)

### Install Camoufox

```bash
# Install Python camoufox to download the binary
pip install camoufox
camoufox fetch

# Binary location (Linux):
# ~/.cache/camoufox/browsers/official/152.0.4-beta.30-*/camoufox
```

### Install Xvfb (VPS)

```bash
apt install -y xvfb
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99
```

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/alysis-farm.git
cd alysis-farm
npm install
```

## Usage

1. Add your GSuite accounts to `accounts.txt`:
```
user1@yourdomain.com|password123
user2@yourdomain.com|password456
```

2. Run the farm:
```bash
# Farm all accounts
node farm.js

# Farm first 5 accounts
node farm.js --count 5

# Farm accounts starting from index 10
node farm.js --start 10

# Farm 3 accounts starting from index 5
node farm.js --start 5 --count 3
```

3. Keys are saved to `apikeys.txt`:
```
user1@yourdomain.com|slk_xxxxxxxxxxxxxxxx
user2@yourdomain.com|slk_yyyyyyyyyyyyyyyy
```

## Test a Key

```bash
# List models
curl https://vzigujbcjjmpntxhmyvr.supabase.co/functions/v1/llm/v1/models \
  -H "Authorization: Bearer slk_XXXXXXXX"

# Chat completion
curl https://vzigujbcjjmpntxhmyvr.supabase.co/functions/v1/llm/v1/chat/completions \
  -H "Authorization: Bearer slk_XXXXXXXX" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

## Use with OpenAI SDK (Python)

```python
from openai import OpenAI

client = OpenAI(
    api_key="slk_XXXXXXXX",
    base_url="https://vzigujbcjjmpntxhmyvr.supabase.co/functions/v1/llm/v1"
)

response = client.chat.completions.create(
    model="deepseek-v4-flash",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

## Use with OpenAI SDK (Node.js)

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'slk_XXXXXXXX',
  baseURL: 'https://vzigujbcjjmpntxhmyvr.supabase.co/functions/v1/llm/v1',
});

const response = await client.chat.completions.create({
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);
```

## How It Works

```
1. Google OAuth via Camoufox browser
   └─ Navigate to Supabase Google OAuth authorize URL
   └─ Enter GSuite email/password
   └─ Handle consent screen (Allow/Izinkan)
   └─ Capture access_token from callback URL hash

2. Device Code Flow
   └─ POST /functions/v1/device-code → user_code + device_code
   └─ POST /rest/v1/rpc/approve_device (with user JWT) → approve
   └─ Poll /functions/v1/device-token → slk_ API key

3. Save to apikeys.txt
```

## Project Structure

```
alysis-farm/
├── farm.js           # Main farming script
├── accounts.txt      # GSuite accounts (email|password)
├── apikeys.txt       # Generated API keys (output)
├── package.json      # Node.js dependencies
├── LICENSE           # MIT License
└── README.md         # This file
```

## Troubleshooting

**"No password field"**
- Account may not exist on Google, or Google is showing a CAPTCHA

**"Workspace ToS speedbump"**
- New GSuite accounts need to accept workspace terms — script handles this automatically

**"No access_token captured"**
- Google consent didn't redirect back — try again (rate limiting)

**"Approve failed (401)"**
- Supabase anon key may have expired — re-extract from `alysiscode.com` JS bundle

## License

MIT
