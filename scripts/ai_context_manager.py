#!/usr/bin/env python3
"""
AI Context Manager - Query and manage the ai_context knowledge base
Usage:
  python ai_context_manager.py list                    # List all context
  python ai_context_manager.py search "naviance"      # Search by keyword
  python ai_context_manager.py category competitor_intel  # Filter by category
  python ai_context_manager.py add                     # Interactive add
  python ai_context_manager.py export                  # Export to JSON
"""

import psycopg2
from dotenv import load_dotenv
import os
import sys
import json

load_dotenv()

def get_connection():
    return psycopg2.connect(os.getenv('DATABASE_URL'))

def list_all():
    """List all context entries"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT id, category, subcategory, title, is_verified, created_at
        FROM ai_context
        ORDER BY category, subcategory, created_at DESC
    ''')
    rows = cur.fetchall()

    current_cat = None
    for row in rows:
        if row[1] != current_cat:
            current_cat = row[1]
            print(f"\n=== {current_cat.upper()} ===")
        verified = '✓' if row[4] else ' '
        subcat = f"[{row[2]}]" if row[2] else ""
        print(f"  {verified} {subcat} {row[3]}")

    print(f"\nTotal: {len(rows)} entries")
    cur.close()
    conn.close()

def search(keyword):
    """Search context by keyword"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT category, subcategory, title, content, tags
        FROM ai_context
        WHERE title ILIKE %s OR content ILIKE %s OR %s = ANY(tags)
        ORDER BY category
    ''', (f'%{keyword}%', f'%{keyword}%', keyword.lower()))
    rows = cur.fetchall()

    print(f"\nFound {len(rows)} results for '{keyword}':\n")
    for row in rows:
        print(f"[{row[0]}] {row[1] or 'general'}: {row[2]}")
        print(f"  Tags: {', '.join(row[4]) if row[4] else 'none'}")
        print(f"  Preview: {row[3][:200]}...\n")

    cur.close()
    conn.close()

def by_category(category):
    """Get all entries in a category"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT subcategory, title, content, tags, is_verified
        FROM ai_context
        WHERE category = %s
        ORDER BY subcategory, created_at DESC
    ''', (category,))
    rows = cur.fetchall()

    print(f"\n=== {category.upper()} ({len(rows)} entries) ===\n")
    for row in rows:
        verified = '✓' if row[4] else ' '
        print(f"{verified} [{row[0] or 'general'}] {row[1]}")
        print(f"  Tags: {', '.join(row[3]) if row[3] else 'none'}")
        print(f"  ---")
        print(f"  {row[2][:500]}{'...' if len(row[2]) > 500 else ''}\n")

    cur.close()
    conn.close()

def get_full_entry(title):
    """Get full content of an entry by title"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT * FROM ai_context WHERE title ILIKE %s
    ''', (f'%{title}%',))
    row = cur.fetchone()

    if row:
        print(f"\n=== {row[4]} ===")  # title
        print(f"Category: {row[1]} / {row[2]}")
        print(f"Verified: {'Yes' if row[12] else 'No'}")
        print(f"Confidence: {row[11] or 'N/A'}")
        print(f"Tags: {', '.join(row[10]) if row[10] else 'none'}")
        print(f"\n{row[5]}")  # content
    else:
        print(f"No entry found matching '{title}'")

    cur.close()
    conn.close()

def add_entry():
    """Interactive add new entry"""
    print("\n=== Add New AI Context Entry ===\n")

    categories = ['competitor_intel', 'product_features', 'customer_quotes', 'market_research', 'pricing', 'messaging', 'use_cases']
    print("Categories:", ', '.join(categories))
    category = input("Category: ").strip()
    subcategory = input("Subcategory (e.g., naviance, xello, wbl): ").strip() or None
    title = input("Title: ").strip()

    print("Content (enter 'END' on a new line when done):")
    lines = []
    while True:
        line = input()
        if line == 'END':
            break
        lines.append(line)
    content = '\n'.join(lines)

    source_type = input("Source type (web_scrape, document, manual, ai_generated): ").strip() or 'manual'
    source_url = input("Source URL (optional): ").strip() or None
    tags_input = input("Tags (comma-separated): ").strip()
    tags = [t.strip().lower() for t in tags_input.split(',')] if tags_input else None
    confidence = input("Confidence 0.0-1.0 (optional): ").strip()
    confidence = float(confidence) if confidence else None

    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO ai_context (category, subcategory, title, content, source_type, source_url, tags, confidence)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id
    ''', (category, subcategory, title, content, source_type, source_url, tags, confidence))
    new_id = cur.fetchone()[0]
    conn.commit()

    print(f"\n✓ Added entry with ID: {new_id}")
    cur.close()
    conn.close()

def export_json():
    """Export all context to JSON"""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT category, subcategory, title, content, summary, source_type, source_url, tags, confidence, is_verified
        FROM ai_context
        ORDER BY category, subcategory
    ''')
    rows = cur.fetchall()

    data = []
    for row in rows:
        data.append({
            "category": row[0],
            "subcategory": row[1],
            "title": row[2],
            "content": row[3],
            "summary": row[4],
            "source_type": row[5],
            "source_url": row[6],
            "tags": row[7],
            "confidence": float(row[8]) if row[8] else None,
            "is_verified": row[9]
        })

    output_file = 'ai_context_export.json'
    with open(output_file, 'w') as f:
        json.dump(data, f, indent=2)

    print(f"Exported {len(data)} entries to {output_file}")
    cur.close()
    conn.close()

def stats():
    """Show statistics"""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM ai_context")
    total = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM ai_context WHERE is_verified = true")
    verified = cur.fetchone()[0]

    cur.execute("SELECT category, COUNT(*) FROM ai_context GROUP BY category ORDER BY COUNT(*) DESC")
    by_cat = cur.fetchall()

    cur.execute("SELECT subcategory, COUNT(*) FROM ai_context WHERE subcategory IS NOT NULL GROUP BY subcategory ORDER BY COUNT(*) DESC LIMIT 10")
    by_subcat = cur.fetchall()

    print(f"\n=== AI Context Statistics ===")
    print(f"Total entries: {total}")
    print(f"Verified: {verified} ({verified*100//total}%)")
    print(f"\nBy category:")
    for cat, count in by_cat:
        print(f"  - {cat}: {count}")
    print(f"\nTop subcategories:")
    for subcat, count in by_subcat:
        print(f"  - {subcat}: {count}")

    cur.close()
    conn.close()

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == 'list':
        list_all()
    elif cmd == 'search' and len(sys.argv) > 2:
        search(sys.argv[2])
    elif cmd == 'category' and len(sys.argv) > 2:
        by_category(sys.argv[2])
    elif cmd == 'get' and len(sys.argv) > 2:
        get_full_entry(' '.join(sys.argv[2:]))
    elif cmd == 'add':
        add_entry()
    elif cmd == 'export':
        export_json()
    elif cmd == 'stats':
        stats()
    else:
        print(__doc__)
