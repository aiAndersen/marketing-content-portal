# Webflow Webhook Integration

This API endpoint automatically syncs new content from Webflow CMS to Supabase when items are published.

## Setup Instructions

### 1. Add Environment Variables in Vercel

Go to your Vercel project settings → Environment Variables and add:

```
SUPABASE_URL=https://wbjkncpkucmtjusfczdy.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key-here
```

**Important:** Use the Supabase **service role key** (not the anon key) for server-side writes. You can find this in Supabase Dashboard → Settings → API → Service Role Key.

### 2. Deploy to Vercel

Push this code to trigger a new deployment. The API endpoint will be available at:

```
https://your-vercel-app.vercel.app/api/webflow-webhook
```

### 3. Configure Webflow Webhooks

1. Go to Webflow Dashboard → Site Settings → Integrations → Webhooks
2. Click "Add Webhook"
3. Configure:
   - **Trigger Type:** `Collection item created` (or `changed`)
   - **URL:** `https://your-vercel-app.vercel.app/api/webflow-webhook`
   - **Collection:** Select your Resources collection

4. Repeat for other collections you want to sync:
   - Landing Pages
   - Blog Posts
   - etc.

### 4. Test the Webhook

1. Create a new item in your Webflow CMS
2. Publish the changes
3. Check Vercel Function Logs to see the webhook processing
4. Verify the item appears in your Supabase `marketing_content` table

## Supported Webhook Events

| Event | Action |
|-------|--------|
| `collection_item_created` | Inserts new record (checks for duplicates first) |
| `collection_item_changed` | Updates existing record if found, or inserts new |
| `collection_item_deleted` | Logged but NOT auto-deleted (requires manual review) |

## Duplicate Detection

The webhook handler checks for duplicates using:
1. **URL match** - Compares normalized live_link URLs
2. **Title match** - Compares normalized titles (case-insensitive)

If a duplicate is found, the existing record is **updated** instead of creating a new one.

## Collection ID Reference

| Collection | ID |
|------------|-----|
| Resources | `6751db0aa481dcef9c9f387a` |
| Resource Types | `6751daf28e1af86441a0593a` |
| Resource Topics | `6751dae129876320ee925de2` |

## Type Mapping

Webflow resource types are mapped to database types:

| Webflow Type ID | Database Type |
|-----------------|---------------|
| `67626bc6c3c7b15c804c0426` | Award |
| `675223f253981c726ff23303` | Webinar |
| `675223f2984c60080643fd9a` | Video |
| `675223f1552c4c30b0ddced4` | Ebook |
| `675223f1c7d4029beaea5081` | Customer Story |
| `675223f1d5bb34dc72fc6709` | Event |
| `675223f1bba77df9f4a65aca` | Blog |
| `675223f1e57b8177a6e5f8f2` | 1 Pager |
| `675223f146c059050c3effe6` | Press Release |

## Troubleshooting

### Webhook not triggering
- Ensure the webhook URL is correct and accessible
- Check Webflow webhook logs for delivery status
- Make sure you're publishing changes (not just saving drafts)

### Content not appearing in Supabase
- Check Vercel Function Logs for errors
- Verify environment variables are set correctly
- Ensure the Supabase service key has write permissions

### Duplicates being created
- The duplicate check requires either a matching URL or title
- If both are different from existing content, a new record will be created

## Manual Sync

For bulk imports or catching up on missed content, use the existing Python scripts:

```bash
cd scripts
python import_webflow_resources.py --dry-run  # Preview
python import_webflow_resources.py            # Full import
```
