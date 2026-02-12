/**
 * Vercel Serverless Function - Supabase Write Proxy
 *
 * Proxies write operations (insert, update, delete) to Supabase
 * using the service_role key, keeping it secure on the server side.
 *
 * Environment Variables Required:
 * - SUPABASE_URL (or VITE_SUPABASE_URL)
 * - SUPABASE_SERVICE_KEY
 */

const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  return createClient(url, key);
}

// Allowed tables and operations for security
const ALLOWED_TABLES = ['marketing_content'];
const ALLOWED_OPERATIONS = ['insert', 'update', 'delete'];

module.exports = async function handler(req, res) {
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

  try {
    const { operation, table, data, match } = req.body || {};

    // Validate operation
    if (!ALLOWED_OPERATIONS.includes(operation)) {
      return res.status(400).json({ error: `Invalid operation: ${operation}` });
    }

    // Validate table
    if (!ALLOWED_TABLES.includes(table)) {
      return res.status(400).json({ error: `Table not allowed: ${table}` });
    }

    const supabase = getSupabaseClient();
    let result;

    if (operation === 'insert') {
      if (!data) {
        return res.status(400).json({ error: 'Missing data for insert' });
      }
      const { data: rows, error } = await supabase
        .from(table)
        .insert(Array.isArray(data) ? data : [data])
        .select();

      if (error) throw error;
      result = { action: 'inserted', data: rows };

    } else if (operation === 'update') {
      if (!data || !match?.id) {
        return res.status(400).json({ error: 'Missing data or match.id for update' });
      }
      const { data: rows, error } = await supabase
        .from(table)
        .update(data)
        .eq('id', match.id)
        .select();

      if (error) throw error;
      result = { action: 'updated', data: rows };

    } else if (operation === 'delete') {
      if (!match?.id) {
        return res.status(400).json({ error: 'Missing match.id for delete' });
      }
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', match.id);

      if (error) throw error;
      result = { action: 'deleted', id: match.id };
    }

    return res.status(200).json({ success: true, ...result });

  } catch (error) {
    console.error('[supabase-write] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
