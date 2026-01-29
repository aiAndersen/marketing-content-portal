const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../frontend/.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function queryCompetitors() {
  // Get Naviance-related content
  const { data: navianceData } = await supabase
    .from('marketing_content')
    .select('title, type, state, tags, auto_tags, summary, enhanced_summary')
    .or('title.ilike.%naviance%,tags.ilike.%naviance%,auto_tags.ilike.%naviance%,summary.ilike.%naviance%')
    .order('last_updated', { ascending: false });

  // Get Xello-related content
  const { data: xelloData } = await supabase
    .from('marketing_content')
    .select('title, type, state, tags, auto_tags, summary, enhanced_summary')
    .or('title.ilike.%xello%,tags.ilike.%xello%,auto_tags.ilike.%xello%,summary.ilike.%xello%')
    .order('last_updated', { ascending: false });

  // Get customer stories that mention competitors
  const { data: customerStories } = await supabase
    .from('marketing_content')
    .select('title, type, state, tags, auto_tags, summary, enhanced_summary')
    .eq('type', 'Customer Story')
    .order('last_updated', { ascending: false });

  // Get comparison guides
  const { data: comparisons } = await supabase
    .from('marketing_content')
    .select('title, type, state, tags, auto_tags, summary, enhanced_summary')
    .or('title.ilike.%comparison%,title.ilike.%vs%,tags.ilike.%comparison%')
    .order('last_updated', { ascending: false });

  console.log('=== NAVIANCE-RELATED CONTENT ===');
  console.log('Found ' + (navianceData ? navianceData.length : 0) + ' items');
  if (navianceData) {
    navianceData.forEach(function(item) {
      console.log('\n[' + item.type + '] ' + (item.state || 'National') + ': ' + item.title);
      console.log('  Tags: ' + (item.tags || 'none'));
      console.log('  Auto Tags: ' + (item.auto_tags || 'none'));
      if (item.enhanced_summary) console.log('  Summary: ' + item.enhanced_summary.substring(0, 200) + '...');
    });
  }

  console.log('\n\n=== XELLO-RELATED CONTENT ===');
  console.log('Found ' + (xelloData ? xelloData.length : 0) + ' items');
  if (xelloData) {
    xelloData.forEach(function(item) {
      console.log('\n[' + item.type + '] ' + (item.state || 'National') + ': ' + item.title);
      console.log('  Tags: ' + (item.tags || 'none'));
      console.log('  Auto Tags: ' + (item.auto_tags || 'none'));
      if (item.enhanced_summary) console.log('  Summary: ' + item.enhanced_summary.substring(0, 200) + '...');
    });
  }

  console.log('\n\n=== COMPARISON GUIDES ===');
  console.log('Found ' + (comparisons ? comparisons.length : 0) + ' items');
  if (comparisons) {
    comparisons.forEach(function(item) {
      console.log('\n[' + item.type + '] ' + item.title);
      console.log('  Tags: ' + (item.tags || 'none'));
    });
  }

  console.log('\n\n=== CUSTOMER STORIES MENTIONING COMPETITORS ===');
  if (customerStories) {
    customerStories.forEach(function(item) {
      var allText = ((item.tags || '') + ' ' + (item.auto_tags || '') + ' ' + (item.summary || '') + ' ' + (item.enhanced_summary || '')).toLowerCase();
      var mentionsNaviance = allText.includes('naviance');
      var mentionsXello = allText.includes('xello');
      if (mentionsNaviance || mentionsXello) {
        console.log('\n[' + (item.state || 'National') + '] ' + item.title);
        console.log('  Mentions: ' + (mentionsNaviance ? 'Naviance ' : '') + (mentionsXello ? 'Xello' : ''));
        console.log('  Tags: ' + (item.tags || 'none'));
        if (item.enhanced_summary) console.log('  Summary: ' + item.enhanced_summary.substring(0, 300) + '...');
      }
    });
  }
}

queryCompetitors().catch(console.error);
