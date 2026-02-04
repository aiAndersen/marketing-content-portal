/**
 * Webflow Webhook Handler for Vercel Serverless Functions
 *
 * Receives webhooks from Webflow when CMS items are created/updated/deleted
 * and syncs them to Supabase marketing_content table.
 *
 * Environment Variables Required:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_KEY (use service key for server-side writes)
 * - WEBFLOW_WEBHOOK_SECRET (optional, for signature verification)
 */

// Use require for compatibility with Vercel serverless
const { createClient } = require('@supabase/supabase-js');

// Webflow Collection IDs (from your existing scripts)
const COLLECTIONS = {
  RESOURCES: '6751db0aa481dcef9c9f387a',
  RESOURCE_TYPES: '6751daf28e1af86441a0593a',
  RESOURCE_TOPICS: '6751dae129876320ee925de2',
  STATES: null // Add your states collection ID if you have one
};

// Webflow Type ID to Database Type mapping
const WEBFLOW_TYPE_MAP = {
  '67626bc6c3c7b15c804c0426': 'Award',
  '675223f253981c726ff23303': 'Webinar',
  '675223f2984c60080643fd9a': 'Video',
  '675223f1552c4c30b0ddced4': 'Ebook',
  '675223f1c7d4029beaea5081': 'Customer Story',
  '675223f1d5bb34dc72fc6709': 'Event',
  '675223f1bba77df9f4a65aca': 'Blog',
  '675223f1e57b8177a6e5f8f2': '1-Pager',
  '675223f146c059050c3effe6': 'Press Release'
};

// Initialize Supabase client
function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials');
  }

  return createClient(supabaseUrl, supabaseKey);
}

// Normalize URL for duplicate checking
function normalizeUrl(url) {
  if (!url) return '';
  return url.toLowerCase().replace(/\/$/, '').replace('www.', '');
}

// Normalize title for duplicate checking
function normalizeTitle(title) {
  if (!title) return '';
  return title.toLowerCase().trim();
}

// Extract text from HTML
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Map Webflow item to database record
function mapWebflowToDatabase(item, collectionId) {
  const fieldData = item.fieldData || item;

  // Determine content type
  let contentType = 'Asset'; // default
  if (fieldData['resource-type']) {
    contentType = WEBFLOW_TYPE_MAP[fieldData['resource-type']] || 'Asset';
  }

  // Build the live link
  let liveLink = '';
  if (fieldData.slug) {
    liveLink = `https://www.schoolinks.com/resources/${fieldData.slug}`;
  } else if (fieldData['live-link'] || fieldData.liveLink) {
    liveLink = fieldData['live-link'] || fieldData.liveLink;
  }

  // Extract summary/description
  let summary = '';
  if (fieldData['short-description']) {
    summary = stripHtml(fieldData['short-description']);
  } else if (fieldData.description) {
    summary = stripHtml(fieldData.description);
  } else if (fieldData['body-content']) {
    // Take first 500 chars of body as summary
    summary = stripHtml(fieldData['body-content']).substring(0, 500);
  }

  // Extract tags
  let tags = '';
  if (fieldData.tags && Array.isArray(fieldData.tags)) {
    tags = fieldData.tags.join(', ');
  } else if (fieldData['resource-topics'] && Array.isArray(fieldData['resource-topics'])) {
    // Topics are often IDs, we'll just note them for now
    tags = 'webflow-topics';
  }

  // Determine platform
  let platform = 'Website';
  if (liveLink.includes('youtube.com') || liveLink.includes('youtu.be')) {
    platform = 'YouTube';
  } else if (liveLink.includes('vimeo.com')) {
    platform = 'Vimeo';
  } else if (liveLink.includes('linkedin.com')) {
    platform = 'LinkedIn';
  }

  // Extract state if available
  let state = null;
  if (fieldData.state) {
    state = fieldData.state;
  } else if (fieldData['state-2']) {
    state = fieldData['state-2'];
  }

  return {
    title: fieldData.name || fieldData.title || 'Untitled',
    type: contentType,
    live_link: liveLink,
    ungated_link: fieldData['ungated-link'] || fieldData.ungatedLink || null,
    platform: platform,
    state: state,
    summary: summary,
    tags: tags,
    last_updated: new Date().toISOString(),
    // Store Webflow ID for future reference
    webflow_id: item.id || item._id
  };
}

// Check if content already exists
async function checkDuplicate(supabase, title, liveLink) {
  const normalizedTitle = normalizeTitle(title);
  const normalizedUrl = normalizeUrl(liveLink);

  // Check by URL first (more reliable)
  if (normalizedUrl) {
    const { data: urlMatch } = await supabase
      .from('marketing_content')
      .select('id, title')
      .or(`live_link.ilike.%${normalizedUrl}%`)
      .limit(1);

    if (urlMatch && urlMatch.length > 0) {
      return { exists: true, id: urlMatch[0].id, matchType: 'url' };
    }
  }

  // Check by title
  if (normalizedTitle) {
    const { data: titleMatch } = await supabase
      .from('marketing_content')
      .select('id, title')
      .ilike('title', normalizedTitle)
      .limit(1);

    if (titleMatch && titleMatch.length > 0) {
      return { exists: true, id: titleMatch[0].id, matchType: 'title' };
    }
  }

  return { exists: false };
}

// Main webhook handler
module.exports = async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Log incoming webhook for debugging
  console.log('[Webflow Webhook] Received:', JSON.stringify(req.body, null, 2).substring(0, 1000));

  try {
    const payload = req.body;

    // Validate payload structure
    if (!payload) {
      return res.status(400).json({ error: 'Empty payload' });
    }

    // Extract webhook data
    // Webflow webhooks can come in different formats depending on the trigger
    const triggerType = payload.triggerType || payload.trigger_type || payload._type;
    const collectionId = payload.collectionId || payload.collection_id;
    const item = payload.item || payload.data || payload;

    console.log(`[Webflow Webhook] Trigger: ${triggerType}, Collection: ${collectionId}`);

    // Skip if it's a delete event (we don't auto-delete from our DB)
    if (triggerType && triggerType.includes('deleted')) {
      console.log('[Webflow Webhook] Delete event ignored - manual review required');
      return res.status(200).json({
        success: true,
        message: 'Delete events are logged but not automatically processed',
        triggerType
      });
    }

    // Initialize Supabase
    const supabase = getSupabaseClient();

    // Map the Webflow item to our database format
    const dbRecord = mapWebflowToDatabase(item, collectionId);

    console.log(`[Webflow Webhook] Mapped record:`, {
      title: dbRecord.title,
      type: dbRecord.type,
      live_link: dbRecord.live_link
    });

    // Check for duplicates
    const duplicate = await checkDuplicate(supabase, dbRecord.title, dbRecord.live_link);

    if (duplicate.exists) {
      // Update existing record
      console.log(`[Webflow Webhook] Updating existing record (${duplicate.matchType} match): ${duplicate.id}`);

      const { data, error } = await supabase
        .from('marketing_content')
        .update({
          ...dbRecord,
          last_updated: new Date().toISOString()
        })
        .eq('id', duplicate.id)
        .select();

      if (error) {
        console.error('[Webflow Webhook] Update error:', error);
        return res.status(500).json({ error: 'Failed to update record', details: error.message });
      }

      return res.status(200).json({
        success: true,
        action: 'updated',
        id: duplicate.id,
        title: dbRecord.title,
        matchType: duplicate.matchType
      });
    } else {
      // Insert new record
      console.log(`[Webflow Webhook] Inserting new record: ${dbRecord.title}`);

      const { data, error } = await supabase
        .from('marketing_content')
        .insert([dbRecord])
        .select();

      if (error) {
        console.error('[Webflow Webhook] Insert error:', error);
        return res.status(500).json({ error: 'Failed to insert record', details: error.message });
      }

      return res.status(200).json({
        success: true,
        action: 'created',
        id: data[0]?.id,
        title: dbRecord.title
      });
    }

  } catch (error) {
    console.error('[Webflow Webhook] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
