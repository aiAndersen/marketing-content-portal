/**
 * Build script that generates config.js from environment variables
 * Used by Vercel during deployment
 */

const fs = require('fs');

const config = `// Auto-generated config from environment variables
// Supabase Configuration
const SUPABASE_CONFIG = {
    url: '${process.env.VITE_SUPABASE_URL || 'https://wbjkncpkucmtjusfczdy.supabase.co'}',
    anonKey: '${process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiamtuY3BrdWNtdGp1c2ZjemR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxODc2MzgsImV4cCI6MjA4NDc2MzYzOH0.q1wcPkR2sRYLlW1EVG8KxnoBwX7U8ZdIVQwpSPHZZPE'}'
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
