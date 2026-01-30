/**
 * Vercel Serverless Function - OpenAI Whisper Proxy
 *
 * This endpoint proxies requests to OpenAI's audio transcription API,
 * keeping the API key secure on the server side.
 */

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
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
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    // Collect raw body chunks
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const contentType = req.headers['content-type'];

    // Make request to OpenAI Whisper API
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': contentType
      },
      body: body
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('OpenAI Whisper API error:', response.status, errorData);
      return res.status(response.status).json({
        error: errorData.error?.message || 'Whisper API error'
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error('Whisper proxy error:', error.message, error.stack);
    return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
}
