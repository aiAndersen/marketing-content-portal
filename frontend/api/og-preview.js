/**
 * og-preview.js — Vercel serverless function
 * Fetches Open Graph image from an external URL (bypasses CORS).
 * Returns: { image: string|null }
 * Cached 24hr at Vercel edge (s-maxage=86400).
 *
 * Usage: GET /api/og-preview?url=https://example.com/page
 */
export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ image: null, error: 'url parameter required' });
  }

  // Basic URL validation — must be http/https
  let targetUrl;
  try {
    targetUrl = new URL(url);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({ image: null, error: 'Invalid URL protocol' });
    }
  } catch {
    return res.status(400).json({ image: null, error: 'Invalid URL' });
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SchooLinksContentBot/1.0; +https://portal.schoolinks.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      return res.status(200).json({ image: null });
    }

    // Only read first 50KB to find OG tags without loading full page
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    const maxBytes = 50 * 1024;

    while (true) {
      const { done, value } = await reader.read();
      if (done || totalBytes >= maxBytes) {
        reader.cancel();
        break;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }

    const html = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.length + chunk.length);
        merged.set(acc);
        merged.set(chunk, acc.length);
        return merged;
      }, new Uint8Array())
    );

    // Parse og:image — handles both attribute order variants
    const ogImageMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

    const image = ogImageMatch ? ogImageMatch[1] : null;

    // Cache at Vercel edge for 24 hours
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
    return res.status(200).json({ image });
  } catch {
    // Timeouts, network errors, etc — return null gracefully
    return res.status(200).json({ image: null });
  }
}
