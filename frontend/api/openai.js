/**
 * Vercel Serverless Function - OpenAI Proxy
 *
 * This endpoint proxies requests to OpenAI's chat completions API,
 * keeping the API key secure on the server side.
 */

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get API key from environment variable
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('OPENAI_API_KEY environment variable not set');
    return res.status(500).json({ error: 'Server configuration error: API key not configured' });
  }

  try {
    const body = req.body || {};
    const { messages, model, max_tokens, temperature } = body;

    // Validate required fields
    if (!messages || !Array.isArray(messages)) {
      console.error('Invalid request body:', JSON.stringify(body).substring(0, 200));
      return res.status(400).json({ error: 'Invalid request: messages array required' });
    }

    const modelToUse = model || 'gpt-4o-mini';

    // gpt-5, o1, o3, o4 models require max_completion_tokens instead of max_tokens
    const usesNewTokenParam = /^(gpt-5|o[134])/.test(modelToUse);
    // gpt-5-mini doesn't support custom temperature (only default 1)
    const noCustomTemp = /^gpt-5-mini/.test(modelToUse);

    // Build request body with correct parameters per model
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

    // Make request to OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('OpenAI API error:', response.status, errorData);
      return res.status(response.status).json({
        error: errorData.error?.message || 'OpenAI API error'
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('Proxy error:', error.message, error.stack);
    return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
};
