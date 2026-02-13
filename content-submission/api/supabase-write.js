/**
 * Vercel Serverless Function - Supabase Write Proxy
 *
 * Proxies write operations (insert, update, delete) to Supabase
 * using the REST API (PostgREST), keeping keys secure on the server side.
 *
 * Environment Variables:
 * - SUPABASE_URL or VITE_SUPABASE_URL
 * - SUPABASE_SERVICE_KEY (preferred) or VITE_SUPABASE_ANON_KEY (fallback)
 */

// Allowed tables and operations for security
const ALLOWED_TABLES = ['marketing_content'];
const ALLOWED_OPERATIONS = ['insert', 'update', 'delete'];

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[supabase-write] Missing SUPABASE_URL or key');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const { operation, table, data, match } = req.body || {};

    if (!ALLOWED_OPERATIONS.includes(operation)) {
      return res.status(400).json({ error: `Invalid operation: ${operation}` });
    }

    if (!ALLOWED_TABLES.includes(table)) {
      return res.status(400).json({ error: `Table not allowed: ${table}` });
    }

    const baseUrl = `${supabaseUrl}/rest/v1/${table}`;
    const headers = {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    let response;

    if (operation === 'insert') {
      if (!data) {
        return res.status(400).json({ error: 'Missing data for insert' });
      }
      response = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(Array.isArray(data) ? data : [data])
      });
    } else if (operation === 'update') {
      if (!data || !match?.id) {
        return res.status(400).json({ error: 'Missing data or match.id for update' });
      }
      response = await fetch(`${baseUrl}?id=eq.${match.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data)
      });
    } else if (operation === 'delete') {
      if (!match?.id) {
        return res.status(400).json({ error: 'Missing match.id for delete' });
      }
      response = await fetch(`${baseUrl}?id=eq.${match.id}`, {
        method: 'DELETE',
        headers
      });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[supabase-write] Supabase error:', response.status, errorData);
      return res.status(response.status).json({
        error: errorData.message || errorData.error || `Supabase error: ${response.status}`
      });
    }

    // DELETE returns empty body with 204
    if (operation === 'delete') {
      return res.status(200).json({ success: true, action: 'deleted', id: match.id });
    }

    const rows = await response.json();
    return res.status(200).json({
      success: true,
      action: operation === 'insert' ? 'inserted' : 'updated',
      data: rows
    });

  } catch (error) {
    console.error('[supabase-write] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
