/**
 * Build script that generates config.js from environment variables
 * Used by Vercel during deployment
 *
 * SECURITY: OpenAI API key is handled server-side via /api/openai
 * Only Supabase public credentials are exposed to the browser
 */

const fs = require('fs');

// Validate required environment variables (Supabase only - OpenAI is server-side)
const requiredEnvVars = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    console.warn(`WARNING: Missing environment variables: ${missingVars.join(', ')}`);
    console.warn('The app may not function correctly without these.');
}

const config = `// Auto-generated config from environment variables
// Supabase Configuration (public credentials only)
const SUPABASE_CONFIG = {
    url: '${process.env.VITE_SUPABASE_URL || ''}',
    anonKey: '${process.env.VITE_SUPABASE_ANON_KEY || ''}'
};
`;

fs.writeFileSync('config.js', config);
console.log('Generated config.js from environment variables');
if (missingVars.length === 0) {
    console.log('All required environment variables are set.');
}
