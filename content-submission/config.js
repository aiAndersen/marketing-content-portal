// Supabase Configuration
// Set these values in your environment or replace with your actual keys
const SUPABASE_CONFIG = {
    url: window.SUPABASE_URL || 'YOUR_SUPABASE_URL',
    anonKey: window.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY'
};

// OpenAI Configuration
const OPENAI_CONFIG = {
    apiKey: window.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY',
    model: 'gpt-4o-mini',
    maxTokens: 1000,
    temperature: 0.3
};
