/**
 * Local Development API Server
 * Runs alongside Vite to handle /api endpoints during local development
 *
 * Usage: node dev-server.js
 * Then run: npm run dev (Vite will proxy /api to this server)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env file manually (no dotenv dependency)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

const PORT = 3001;

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Route: POST /api/openai
  if (req.method === 'POST' && req.url === '/api/openai') {
    // Check both possible env var names
    const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;

    if (!apiKey) {
      console.error('OPENAI_API_KEY not set in .env');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API key not configured' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { messages, model, max_tokens, temperature } = JSON.parse(body);

        if (!messages || !Array.isArray(messages)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request: messages array required' }));
          return;
        }

        const modelToUse = model || 'gpt-4o-mini';
        const usesNewTokenParam = /^(gpt-5|o[134])/.test(modelToUse);
        // gpt-5-mini doesn't support custom temperature (only default 1)
        const noCustomTemp = /^gpt-5-mini/.test(modelToUse);

        const requestBody = {
          model: modelToUse,
          messages,
        };

        // Only add temperature if model supports it
        if (!noCustomTemp) {
          requestBody.temperature = temperature ?? 0.3;
        }

        // Use appropriate token limit parameter
        // Note: gpt-5-mini uses significant reasoning tokens internally,
        // so we need higher limits (500+ just for simple queries)
        if (usesNewTokenParam) {
          requestBody.max_completion_tokens = max_tokens || 2000;
        } else {
          requestBody.max_tokens = max_tokens || 1000;
        }

        console.log(`[API] Request to ${modelToUse}`);

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
          console.error(`[API] Error ${response.status}:`, data);
          res.writeHead(response.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: data.error?.message || 'OpenAI API error' }));
          return;
        }

        console.log(`[API] Success from ${modelToUse}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));

      } catch (err) {
        console.error('[API] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n🚀 Local API server running on http://localhost:${PORT}`);
  console.log('   Vite will proxy /api requests here\n');
});
