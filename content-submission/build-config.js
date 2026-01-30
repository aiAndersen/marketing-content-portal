/**
 * Build script that generates config.js from environment variables
 * Used by Vercel during deployment
 *
 * SECURITY: All secrets must be set via environment variables
 * Never commit hardcoded API keys to this file
 */

const fs = require('fs');

// Validate required environment variables
const requiredEnvVars = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'OPENAI_API_KEY'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    console.warn(`WARNING: Missing environment variables: ${missingVars.join(', ')}`);
    console.warn('The app may not function correctly without these.');
}

const config = `// Auto-generated config from environment variables
// SECURITY: This file should be gitignored - never commit secrets
// Supabase Configuration
const SUPABASE_CONFIG = {
    url: '${process.env.VITE_SUPABASE_URL || ''}',
    anonKey: '${process.env.VITE_SUPABASE_ANON_KEY || ''}'
};

// OpenAI Configuration
const OPENAI_CONFIG = {
    apiKey: '${process.env.OPENAI_API_KEY || ''}',
    model: 'gpt-4o-mini',
    maxTokens: 1000,
    temperature: 0.3
};
`;

fs.writeFileSync('config.js', config);
console.log('Generated config.js from environment variables');
if (missingVars.length === 0) {
    console.log('All required environment variables are set.');
}
