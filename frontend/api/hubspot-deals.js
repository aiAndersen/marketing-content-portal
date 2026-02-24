/**
 * Vercel Serverless Function - HubSpot Inbound Deals Proxy
 *
 * Fetches inbound deals (lead_source = Inbound) in the "Sales Validating"
 * stage of the "Salesforce - New Logo" pipeline, entered in the last 7 days.
 * Enriches each deal with company, contact, and meeting data.
 */

// Module-level cache for the pipeline stage ID (avoids repeated API calls)
let cachedStageId = null;
let cachedStageIdTime = null;
const STAGE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const HUBSPOT_BASE = 'https://api.hubapi.com';
const TARGET_PIPELINE_LABEL = 'Salesforce - New Logo';
const TARGET_STAGE_LABEL = 'Sales Validating';
const DEAL_LIMIT = 15;

async function hubspotFetch(apiKey, path, options = {}) {
  const url = `${HUBSPOT_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HubSpot API error ${res.status} for ${path}: ${body.substring(0, 200)}`);
  }
  return res.json();
}

async function getStageId(apiKey) {
  // Return cached value if fresh
  if (cachedStageId && cachedStageIdTime && (Date.now() - cachedStageIdTime < STAGE_CACHE_TTL_MS)) {
    return cachedStageId;
  }

  const data = await hubspotFetch(apiKey, '/crm/v3/pipelines/deals');
  for (const pipeline of (data.results || [])) {
    // Scope to the "Salesforce - New Logo" pipeline only
    if (pipeline.label !== TARGET_PIPELINE_LABEL) continue;
    for (const stage of (pipeline.stages || [])) {
      if (stage.label && stage.label.toLowerCase() === TARGET_STAGE_LABEL.toLowerCase()) {
        cachedStageId = stage.id;
        cachedStageIdTime = Date.now();
        console.log(`[hubspot-deals] Found stage "${TARGET_STAGE_LABEL}" id: ${stage.id} in pipeline "${pipeline.label}"`);
        return stage.id;
      }
    }
  }

  throw new Error(`Stage "${TARGET_STAGE_LABEL}" not found in pipeline "${TARGET_PIPELINE_LABEL}"`);
}

async function searchDeals(apiKey, stageId) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const dateEnteredProp = `hs_date_entered_${stageId}`;

  const body = {
    filterGroups: [
      {
        filters: [
          { propertyName: 'dealstage', operator: 'EQ', value: stageId },
          { propertyName: 'createdate', operator: 'GTE', value: String(sevenDaysAgo) },
          { propertyName: 'lead_source', operator: 'EQ', value: 'Inbound' },
        ],
      },
    ],
    properties: [
      'dealname',
      'acv',
      'lead_source',
      'hs_analytics_source',
      'dealstage',
      'hubspot_owner_id',
      dateEnteredProp,
      'createdate',
      'closedate',
    ],
    sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
    limit: DEAL_LIMIT,
  };

  const data = await hubspotFetch(apiKey, '/crm/v3/objects/deals/search', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  console.log(`[hubspot-deals] Found ${data.results?.length || 0} deals in stage`);
  return data.results || [];
}

async function getAssociationIds(apiKey, dealId, toObjectType) {
  try {
    const data = await hubspotFetch(
      apiKey,
      `/crm/v3/objects/deals/${dealId}/associations/${toObjectType}`
    );
    return (data.results || []).map(r => r.id);
  } catch {
    return [];
  }
}

async function getCompany(apiKey, companyId) {
  try {
    const data = await hubspotFetch(
      apiKey,
      `/crm/v3/objects/companies/${companyId}?properties=name,city,state,enrollment,description,industry`
    );
    return data.properties || {};
  } catch {
    return {};
  }
}

async function getContact(apiKey, contactId) {
  try {
    const data = await hubspotFetch(
      apiKey,
      `/crm/v3/objects/contacts/${contactId}?properties=firstname,lastname,email,message,hs_content_membership_notes`
    );
    return data.properties || {};
  } catch {
    return {};
  }
}

async function getOwnerName(apiKey, ownerId) {
  if (!ownerId) return null;
  try {
    const data = await hubspotFetch(apiKey, `/crm/v3/owners/${ownerId}`);
    return [data.firstName, data.lastName].filter(Boolean).join(' ') || null;
  } catch {
    return null;
  }
}

async function enrichDeal(apiKey, deal, stageId) {
  const props = deal.properties || {};
  const dateEnteredProp = `hs_date_entered_${stageId}`;

  // Run all association lookups in parallel
  const [companyIds, contactIds, meetingIds] = await Promise.all([
    getAssociationIds(apiKey, deal.id, 'companies'),
    getAssociationIds(apiKey, deal.id, 'contacts'),
    getAssociationIds(apiKey, deal.id, 'meetings'),
  ]);

  // Fetch company + contact details in parallel
  const [company, contact, ownerName] = await Promise.all([
    companyIds[0] ? getCompany(apiKey, companyIds[0]) : Promise.resolve({}),
    contactIds[0] ? getContact(apiKey, contactIds[0]) : Promise.resolve({}),
    getOwnerName(apiKey, props.hubspot_owner_id),
  ]);

  const acv = props.acv ? parseFloat(props.acv) : null;
  const enrollment = company.enrollment ? parseInt(company.enrollment, 10) : null;
  const contactName = [contact.firstname, contact.lastname].filter(Boolean).join(' ') || null;
  // Demo form notes: check "message" property first (common form field), then membership notes
  const demoFormNotes = contact.message || contact.hs_content_membership_notes || null;

  return {
    id: deal.id,
    dealName: props.dealname || 'Unnamed Deal',
    acv,
    enrollment,
    companyName: company.name || props.dealname || 'Unknown Company',
    companyState: company.state || null,
    companyCity: company.city || null,
    companyDescription: company.description || null,
    ownerName,
    meetingBooked: meetingIds.length > 0,
    dateEnteredStage: props[dateEnteredProp]
      ? new Date(parseInt(props[dateEnteredProp], 10)).toISOString()
      : null,
    leadSource: props.lead_source || props.hs_analytics_source || null,
    demoFormNotes,
    contactName,
    contactEmail: contact.email || null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) {
    console.error('[hubspot-deals] HUBSPOT_API_KEY not set');
    return res.status(500).json({ error: 'HubSpot API key not configured' });
  }

  // 8-second timeout guard
  const timeoutMs = 8000;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('HubSpot enrichment timed out')), timeoutMs)
  );

  try {
    const result = await Promise.race([
      (async () => {
        const stageId = await getStageId(apiKey);
        const deals = await searchDeals(apiKey, stageId);

        if (deals.length === 0) return [];

        const enriched = await Promise.all(
          deals.map(deal => enrichDeal(apiKey, deal, stageId))
        );
        return enriched;
      })(),
      timeoutPromise,
    ]);

    return res.status(200).json({ deals: result });
  } catch (err) {
    console.error('[hubspot-deals] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
