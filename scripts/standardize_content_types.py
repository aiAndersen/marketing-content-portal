#!/usr/bin/env python3
"""
Standardize content type values in the database.

This script normalizes inconsistent type values like "1 Pager" to "1-Pager".

Usage:
    python scripts/standardize_content_types.py --dry-run  # Preview changes
    python scripts/standardize_content_types.py            # Apply changes
"""

import os
import argparse
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')

# Define standardization mappings (old value → new value)
TYPE_STANDARDIZATIONS = {
    '1 Pager': '1-Pager',
    '1 pager': '1-Pager',
    '1Pager': '1-Pager',
    'one pager': '1-Pager',
    'One Pager': '1-Pager',
    'VideoClip': 'Video Clip',
    'video clip': 'Video Clip',
    'Videoclip': 'Video Clip',
    'customer story': 'Customer Story',
    'customerstory': 'Customer Story',
    'case study': 'Customer Story',
    'ebook': 'Ebook',
    'EBook': 'Ebook',
    'e-book': 'Ebook',
    'webinar': 'Webinar',
    'blog': 'Blog',
    'video': 'Video',
}

def main():
    parser = argparse.ArgumentParser(description='Standardize content type values in database')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without applying')
    args = parser.parse_args()

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        print("Export it or add to scripts/.env:")
        print("  export DATABASE_URL='postgresql://...'")
        exit(1)

    print(f"Connecting to database...")
    
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # First, get counts of all current type values
        print("\n=== Current Type Distribution ===")
        cur.execute("""
            SELECT type, COUNT(*) as count 
            FROM marketing_content 
            GROUP BY type 
            ORDER BY count DESC
        """)
        rows = cur.fetchall()
        for type_val, count in rows:
            standardized = TYPE_STANDARDIZATIONS.get(type_val, type_val)
            needs_update = type_val != standardized
            marker = " ⚠️  → " + standardized if needs_update else ""
            print(f"  {type_val}: {count} records{marker}")

        # Find records that need updating
        print("\n=== Records to Update ===")
        total_updates = 0
        
        for old_type, new_type in TYPE_STANDARDIZATIONS.items():
            cur.execute("""
                SELECT COUNT(*) FROM marketing_content WHERE type = %s
            """, (old_type,))
            count = cur.fetchone()[0]
            
            if count > 0:
                total_updates += count
                print(f"  '{old_type}' → '{new_type}': {count} records")
                
                if not args.dry_run:
                    cur.execute("""
                        UPDATE marketing_content 
                        SET type = %s, updated_at = NOW()
                        WHERE type = %s
                    """, (new_type, old_type))

        if total_updates == 0:
            print("  No records need updating - types are already standardized!")
        elif args.dry_run:
            print(f"\n⚠️  DRY RUN: {total_updates} records would be updated")
            print("Run without --dry-run to apply changes")
        else:
            conn.commit()
            print(f"\n✅ Successfully updated {total_updates} records")

        # Show final distribution
        if not args.dry_run and total_updates > 0:
            print("\n=== Updated Type Distribution ===")
            cur.execute("""
                SELECT type, COUNT(*) as count 
                FROM marketing_content 
                GROUP BY type 
                ORDER BY count DESC
            """)
            rows = cur.fetchall()
            for type_val, count in rows:
                print(f"  {type_val}: {count} records")

        cur.close()
        conn.close()

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        exit(1)

if __name__ == '__main__':
    main()
