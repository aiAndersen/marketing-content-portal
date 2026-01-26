#!/usr/bin/env python3
"""
Import Marketing Content from Excel to Supabase
Reads the Excel file and imports all content from the "All Content - Data Lake" tab
"""

import os
import sys
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client
from typing import List, Dict, Any

# Load environment variables from .env file in the same directory as this script
SCRIPT_DIR = Path(__file__).parent
load_dotenv(SCRIPT_DIR / '.env')

# Configuration
EXCEL_FILE_PATH = SCRIPT_DIR.parent / 'Marketing Content Portal (4).xlsx'
DATA_LAKE_SHEET = 'All Content - Data Lake'

def get_supabase_client() -> Client:
    """Initialize Supabase client from .env file"""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")

    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_KEY not found")
        print(f"\nPlease create a .env file at: {SCRIPT_DIR / '.env'}")
        print("With the following contents:")
        print("  SUPABASE_URL=https://your-project.supabase.co")
        print("  SUPABASE_KEY=your-anon-key")
        sys.exit(1)

    return create_client(url, key)

def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Clean and prepare dataframe for import"""
    # Replace NaN/NaT with None for proper NULL handling
    df = df.where(pd.notnull(df), None)
    
    # Clean column names to match database schema
    df.columns = [col.strip().replace(' ', '_').lower() for col in df.columns]
    
    # Rename columns to match schema
    column_mapping = {
        'ungated_link': 'ungated_link',
        'last_updated': 'last_updated'
    }
    df = df.rename(columns=column_mapping)
    
    return df

def convert_row_to_dict(row: pd.Series) -> Dict[str, Any]:
    """Convert a pandas row to a dictionary for Supabase"""
    data = {
        'type': str(row['type']) if row['type'] is not None else '',
        'title': str(row['title']) if row['title'] is not None else '',
        'live_link': str(row['live_link']) if row['live_link'] is not None else None,
        'ungated_link': str(row['ungated_link']) if row['ungated_link'] is not None else None,
        'platform': str(row['platform']) if row['platform'] is not None else None,
        'summary': str(row['summary']) if row['summary'] is not None else None,
        'state': str(row['state']) if row['state'] is not None else None,
        'tags': str(row['tags']) if row['tags'] is not None else None,
        'last_updated': row['last_updated'].isoformat() if pd.notnull(row['last_updated']) else None
    }
    
    return data

def import_data(batch_size: int = 100, clear_existing: bool = False):
    """Import data from Excel to Supabase"""
    
    print("=" * 70)
    print("Marketing Content Portal - Data Import")
    print("=" * 70)
    
    # Initialize Supabase client
    print("\n[1/6] Connecting to Supabase...")
    supabase = get_supabase_client()
    print("✓ Connected successfully")
    
    # Read Excel file
    print(f"\n[2/6] Reading Excel file: {EXCEL_FILE_PATH}")
    try:
        df = pd.read_excel(EXCEL_FILE_PATH, sheet_name=DATA_LAKE_SHEET)
        print(f"✓ Loaded {len(df)} rows from '{DATA_LAKE_SHEET}' sheet")
    except Exception as e:
        print(f"✗ Error reading Excel file: {e}")
        sys.exit(1)
    
    # Clean data
    print("\n[3/6] Cleaning and preparing data...")
    df = clean_dataframe(df)
    print("✓ Data cleaned and prepared")
    
    # Show data summary
    print(f"\n[4/6] Data Summary:")
    print(f"  - Total rows: {len(df)}")
    print(f"  - Content types: {df['type'].nunique()}")
    print(f"  - Type breakdown:")
    for content_type, count in df['type'].value_counts().head(10).items():
        print(f"    • {content_type}: {count}")
    
    # Clear existing data if requested
    if clear_existing:
        print("\n[5/6] Clearing existing data...")
        try:
            result = supabase.table('marketing_content').delete().neq('id', '00000000-0000-0000-0000-000000000000').execute()
            print("✓ Existing data cleared")
        except Exception as e:
            print(f"⚠ Warning: Could not clear existing data: {e}")
    else:
        print("\n[5/6] Skipping clear (keeping existing data)")
    
    # Import data in batches
    print(f"\n[6/6] Importing data to Supabase (batch size: {batch_size})...")
    
    total_rows = len(df)
    successful = 0
    failed = 0
    
    for i in range(0, total_rows, batch_size):
        batch = df.iloc[i:i+batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (total_rows + batch_size - 1) // batch_size
        
        try:
            # Convert batch to list of dictionaries
            records = [convert_row_to_dict(row) for _, row in batch.iterrows()]
            
            # Insert batch
            result = supabase.table('marketing_content').insert(records).execute()
            
            successful += len(batch)
            print(f"  ✓ Batch {batch_num}/{total_batches}: {len(batch)} rows imported")
            
        except Exception as e:
            failed += len(batch)
            print(f"  ✗ Batch {batch_num}/{total_batches} failed: {e}")
            
            # Try individual inserts for failed batch
            print(f"    Attempting individual inserts for failed batch...")
            for idx, row in batch.iterrows():
                try:
                    record = convert_row_to_dict(row)
                    supabase.table('marketing_content').insert(record).execute()
                    successful += 1
                    failed -= 1
                except Exception as row_error:
                    print(f"    ✗ Row {idx} failed: {row_error}")
    
    # Final summary
    print("\n" + "=" * 70)
    print("Import Complete!")
    print("=" * 70)
    print(f"✓ Successfully imported: {successful} rows")
    if failed > 0:
        print(f"✗ Failed: {failed} rows")
    print(f"\nYou can now query your data at:")
    print(f"  {os.environ.get('SUPABASE_URL')}")
    print("=" * 70)

def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Import marketing content from Excel to Supabase')
    parser.add_argument('--batch-size', type=int, default=100, help='Number of rows per batch (default: 100)')
    parser.add_argument('--clear', action='store_true', help='Clear existing data before import')
    parser.add_argument('--excel-file', type=str, help='Path to Excel file (optional, uses default if not specified)')
    
    args = parser.parse_args()
    
    # Update file path if provided
    if args.excel_file:
        global EXCEL_FILE_PATH
        EXCEL_FILE_PATH = args.excel_file
    
    try:
        import_data(batch_size=args.batch_size, clear_existing=args.clear)
    except KeyboardInterrupt:
        print("\n\nImport cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nUnexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
