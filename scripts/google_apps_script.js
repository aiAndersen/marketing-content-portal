/**
 * Google Apps Script for Real-Time Sync
 *
 * This script automatically syncs your Google Sheets data to Supabase
 * whenever the sheet is edited.
 *
 * Setup Instructions:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Delete any existing code
 * 4. Paste this entire script
 * 5. Run 'setupScriptProperties' once to configure your Supabase credentials
 *    OR manually add them in Project Settings > Script Properties
 * 6. Save and authorize the script
 * 7. Test by editing a cell - data should sync automatically
 *
 * Script Properties Required (set via setupScriptProperties or Project Settings):
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_ANON_KEY: Your Supabase anon/public key
 */

// ============================================================================
// CONFIGURATION - Credentials loaded from Script Properties
// ============================================================================

/**
 * Get configuration from Script Properties (secure storage)
 * See .env file in /scripts for reference values
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const syncOnEdit = props.getProperty('SYNC_ON_EDIT');
  return {
    SUPABASE_URL: props.getProperty('SUPABASE_URL') || '',
    SUPABASE_ANON_KEY: props.getProperty('SUPABASE_ANON_KEY') || '',
    SHEET_NAME: 'All Content - Data Lake',
    SYNC_ON_EDIT: syncOnEdit !== 'false',  // Default to true unless explicitly set to 'false'
    BATCH_SIZE: 50  // Number of rows to sync at once
  };
}

/**
 * ONE-TIME SETUP: Run this function once to set your Supabase credentials
 * After running, you can delete or comment out the credential values for security
 */
function setupScriptProperties() {
  const props = PropertiesService.getScriptProperties();

  // Update these values with your actual credentials, then run this function once
  props.setProperty('SUPABASE_URL', 'https://your-project.supabase.co');
  props.setProperty('SUPABASE_ANON_KEY', 'your-anon-key-here');

  SpreadsheetApp.getUi().alert('Script properties have been set! You can now test the connection.');
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Called automatically when the sheet is edited
 */
function onEdit(e) {
  const config = getConfig();
  if (!config.SYNC_ON_EDIT) return;

  // Only sync if edit is in the data sheet
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== config.SHEET_NAME) return;

  // Debounce: wait 2 seconds before syncing to batch multiple edits
  Utilities.sleep(2000);
  syncAllData();
}

/**
 * Manual sync function - run from Apps Script menu
 */
function syncAllData() {
  try {
    const config = getConfig();
    Logger.log('Starting sync...');

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(config.SHEET_NAME);
    if (!sheet) {
      throw new Error(`Sheet "${config.SHEET_NAME}" not found`);
    }

    // Get all data
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => h.toString().toLowerCase().replace(/ /g, '_'));
    const rows = data.slice(1);  // Skip header row

    Logger.log(`Found ${rows.length} rows to sync`);

    // Clear existing data first
    deleteAllRecords();

    // Insert in batches
    let successCount = 0;
    for (let i = 0; i < rows.length; i += config.BATCH_SIZE) {
      const batch = rows.slice(i, i + config.BATCH_SIZE);
      const records = batch.map(row => rowToRecord(row, headers)).filter(r => r !== null);

      if (records.length > 0) {
        const inserted = insertRecords(records);
        successCount += inserted;
        Logger.log(`Batch ${Math.floor(i / config.BATCH_SIZE) + 1}: Inserted ${inserted} records`);
      }
    }

    Logger.log(`Sync complete! Successfully synced ${successCount} records`);
    SpreadsheetApp.getUi().alert(`Sync complete! ${successCount} records updated.`);

  } catch (error) {
    Logger.log(`Error during sync: ${error.message}`);
    SpreadsheetApp.getUi().alert(`Sync failed: ${error.message}`);
  }
}

/**
 * Set up custom menu
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Supabase Sync')
    .addItem('Sync Now', 'syncAllData')
    .addItem('Test Connection', 'testConnection')
    .addSeparator()
    .addItem('Enable Auto-Sync', 'enableAutoSync')
    .addItem('Disable Auto-Sync', 'disableAutoSync')
    .addToUi();
}

// ============================================================================
// SUPABASE API FUNCTIONS
// ============================================================================

/**
 * Insert records into Supabase
 */
function insertRecords(records) {
  const config = getConfig();
  const url = `${config.SUPABASE_URL}/rest/v1/marketing_content`;

  const options = {
    method: 'post',
    headers: {
      'apikey': config.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${config.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    payload: JSON.stringify(records),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();

  if (responseCode === 201 || responseCode === 200) {
    return records.length;
  } else {
    throw new Error(`Insert failed: ${response.getContentText()}`);
  }
}

/**
 * Delete all records from Supabase
 */
function deleteAllRecords() {
  const config = getConfig();
  const url = `${config.SUPABASE_URL}/rest/v1/marketing_content?id=neq.00000000-0000-0000-0000-000000000000`;

  const options = {
    method: 'delete',
    headers: {
      'apikey': config.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${config.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  Logger.log(`Delete response: ${response.getResponseCode()}`);
}

/**
 * Test Supabase connection
 */
function testConnection() {
  try {
    const config = getConfig();

    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
      throw new Error('Credentials not set. Run setupScriptProperties first or add them in Project Settings > Script Properties');
    }

    const url = `${config.SUPABASE_URL}/rest/v1/marketing_content?limit=1`;

    const options = {
      method: 'get',
      headers: {
        'apikey': config.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${config.SUPABASE_ANON_KEY}`
      },
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();

    if (responseCode === 200) {
      SpreadsheetApp.getUi().alert('✓ Connection successful!');
      Logger.log('Connection test passed');
    } else {
      throw new Error(`Connection failed with code ${responseCode}`);
    }
  } catch (error) {
    SpreadsheetApp.getUi().alert(`✗ Connection failed: ${error.message}`);
    Logger.log(`Connection test failed: ${error.message}`);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert a sheet row to a database record
 */
function rowToRecord(row, headers) {
  // Skip empty rows
  if (!row[0] || row[0].toString().trim() === '') {
    return null;
  }
  
  const record = {};
  
  for (let i = 0; i < headers.length && i < row.length; i++) {
    const header = headers[i];
    const value = row[i];
    
    // Map column names
    if (header === 'type') record.type = value || '';
    else if (header === 'title') record.title = value || '';
    else if (header === 'live_link') record.live_link = value || null;
    else if (header === 'ungated_link') record.ungated_link = value || null;
    else if (header === 'platform') record.platform = value || null;
    else if (header === 'summary') record.summary = value || null;
    else if (header === 'state') record.state = value || null;
    else if (header === 'tags') record.tags = value || null;
    else if (header === 'last_updated') {
      if (value instanceof Date) {
        record.last_updated = value.toISOString();
      } else {
        record.last_updated = null;
      }
    }
  }
  
  // Validate required fields
  if (!record.type || !record.title) {
    return null;
  }
  
  return record;
}

/**
 * Enable auto-sync on edit
 */
function enableAutoSync() {
  PropertiesService.getScriptProperties().setProperty('SYNC_ON_EDIT', 'true');
  SpreadsheetApp.getUi().alert('Auto-sync enabled! Data will sync automatically when you edit the sheet.');
}

/**
 * Disable auto-sync on edit
 */
function disableAutoSync() {
  PropertiesService.getScriptProperties().setProperty('SYNC_ON_EDIT', 'false');
  SpreadsheetApp.getUi().alert('Auto-sync disabled. Use "Sync Now" from the menu to manually sync data.');
}

// ============================================================================
// SCHEDULED SYNC (Optional)
// ============================================================================

/**
 * Set up a daily sync trigger
 * Run this once to enable automatic daily syncs
 */
function setupDailySync() {
  // Delete existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncAllData') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create new trigger for 2 AM daily
  ScriptApp.newTrigger('syncAllData')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .create();
  
  SpreadsheetApp.getUi().alert('Daily sync enabled! Data will automatically sync at 2 AM every day.');
}

/**
 * Remove the daily sync trigger
 */
function removeDailySync() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncAllData') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  SpreadsheetApp.getUi().alert('Daily sync disabled.');
}

// ============================================================================
// USAGE INSTRUCTIONS
// ============================================================================

/**
 * Quick Start:
 *
 * 1. Update setupScriptProperties() with your Supabase credentials
 * 2. Run 'setupScriptProperties' once to save credentials securely
 * 3. Run 'testConnection' to verify setup
 * 4. Run 'syncAllData' to do initial sync
 * 5. (Optional) Run 'setupDailySync' for automatic daily syncs
 *
 * Alternative Setup (Manual):
 * 1. Go to Project Settings (gear icon) > Script Properties
 * 2. Add SUPABASE_URL and SUPABASE_ANON_KEY properties
 *
 * Features:
 * - Manual sync via menu: Supabase Sync > Sync Now
 * - Auto-sync on edit (can be enabled/disabled)
 * - Scheduled daily sync (optional)
 * - Connection testing
 * - Secure credential storage via Script Properties
 *
 * Notes:
 * - First sync will clear and replace all data
 * - Large sheets may take a few minutes to sync
 * - Check the Logs (View > Logs) for sync details
 * - Auto-sync waits 2 seconds after edit to batch changes
 */
