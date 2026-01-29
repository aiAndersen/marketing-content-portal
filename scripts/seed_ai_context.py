#!/usr/bin/env python3
"""
Seed the ai_context table with competitive intelligence and marketing context
"""

import psycopg2
from dotenv import load_dotenv
import os
from datetime import datetime

load_dotenv()

# Competitive intel gathered from web research + database analysis
CONTEXT_DATA = [
    # Naviance competitor intel
    {
        "category": "competitor_intel",
        "subcategory": "naviance",
        "title": "Naviance Market Position",
        "content": """Naviance (owned by PowerSchool/Vista Equity) is the largest CCR platform in the market. It's considered the legacy market leader but faces significant criticism for dated technology and poor support.

Key facts:
- Acquired by PowerSchool (now Vista Equity Partners)
- Pricing: ~$1-3 per student annually
- Typical 5-year contracts around $77,000 for mid-size districts
- Known for 'nickel and diming' on add-on features
- Work-based learning is an add-on, not integrated
- College application features are core strength""",
        "source_type": "web_scrape",
        "tags": ["naviance", "competitor", "pricing", "market-leader"],
        "confidence": 0.85,
        "is_verified": True
    },
    {
        "category": "competitor_intel",
        "subcategory": "naviance",
        "title": "Naviance User Complaints",
        "content": """Common Naviance complaints from G2, Reddit, and public reviews:

1. POOR CUSTOMER SUPPORT
- "Terrible support" with canned responses
- Support tickets go unresolved for weeks
- No dedicated account managers for smaller districts

2. DATED INTERFACE
- "Everything seems hidden behind tabs"
- Confusing navigation for students
- Not mobile-optimized
- Students require training to use effectively

3. PRIVACY CONCERNS
- Class action lawsuit (May 2024) for student data collection practices
- Concerns about data sharing with colleges
- FERPA compliance questions raised

4. LIMITED INNOVATION
- Feature requests ignored for years
- Slow to add modern capabilities
- Competing features require separate purchases

5. SILOED TOOLS
- Separate modules don't communicate well
- Data doesn't flow between features
- Requires manual data reconciliation""",
        "source_type": "web_scrape",
        "source_url": "https://www.g2.com/products/naviance/reviews",
        "tags": ["naviance", "complaints", "support", "privacy", "ux"],
        "confidence": 0.90,
        "is_verified": True
    },
    {
        "category": "competitor_intel",
        "subcategory": "naviance",
        "title": "SchooLinks Wins vs Naviance",
        "content": """Documented customer switches from Naviance to SchooLinks:

1. SPOKANE PUBLIC SCHOOLS (WA)
- Achieved 500%+ student engagement increase
- Students involved in platform selection
- Key factor: Modern UX, better student adoption

2. LINDBERGH SCHOOL DISTRICT (MO)
- Streamlined ICAP compliance
- Improved student experience
- Better counselor workflows

3. SARASOTA COUNTY SCHOOLS (FL)
- Transformed WBL initiatives
- Comprehensive platform vs add-ons
- Better career readiness tracking

4. BOW HIGH SCHOOL (NH)
- 640 students, improved counselor collaboration
- Streamlined FAFSA tracking
- Better parent engagement

5. TIPP CITY SCHOOLS (OH)
- Met state graduation tracking requirements
- Unified platform reduced vendor count
- Better reporting for compliance

6. ST. AUGUSTINE PREP (WI)
- Personalized career exploration
- Better student engagement
- Modern mobile experience

7. POMPERAUG RSD 15 (CT)
- Seamless PowerSchool integration
- Smooth implementation
- Exceptional support vs Naviance""",
        "source_type": "database",
        "tags": ["naviance", "wins", "customer-stories", "switching"],
        "confidence": 0.95,
        "is_verified": True
    },

    # Xello competitor intel
    {
        "category": "competitor_intel",
        "subcategory": "xello",
        "title": "Xello Market Position",
        "content": """Xello (formerly Career Cruising) positions as a student-focused career exploration platform. Strong in middle school/early high school career awareness, but weaker on college application support.

Key characteristics:
- Canadian company, strong presence in K-12
- Focus on career exploration and planning
- Gamified student experience
- Limited college application management
- No comprehensive WBL solution
- 4-year academic planning only (vs 6-year competitors)""",
        "source_type": "web_scrape",
        "tags": ["xello", "competitor", "career-exploration"],
        "confidence": 0.85,
        "is_verified": True
    },
    {
        "category": "competitor_intel",
        "subcategory": "xello",
        "title": "Xello User Complaints",
        "content": """Common Xello complaints from reviews and customer feedback:

1. NAVIGATION ISSUES
- "Students get stuck without teacher guidance"
- Requires more hand-holding than expected
- Not as intuitive as marketing suggests

2. SURFACE-LEVEL CONTENT
- "Mediocre videos" for career exploration
- Basic career information, lacks depth
- Limited industry-specific content

3. LIMITED ACADEMIC PLANNING
- Only 4-year plans (competitors offer 6-year)
- Weak graduation tracking
- No course registration integration

4. MANUAL SETUP REQUIRED
- Custom lessons require extensive pre-building
- Teachers spend too much time on setup
- Content customization is labor-intensive

5. TRANSFER STUDENT PROBLEMS
- Liberty Hill TX cited this as switching reason
- Poor handling of mid-year transfers
- Data doesn't migrate cleanly

6. NO TRUE WBL
- Basic career exposure only
- No internship/placement management
- Missing industry partner portal""",
        "source_type": "web_scrape",
        "tags": ["xello", "complaints", "navigation", "content", "wbl"],
        "confidence": 0.88,
        "is_verified": True
    },
    {
        "category": "competitor_intel",
        "subcategory": "xello",
        "title": "SchooLinks Wins vs Xello",
        "content": """Documented customer switches from Xello to SchooLinks:

1. LIBERTY HILL ISD (TX)
- Fixed transfer student issues
- Improved CCMR tracking
- Lead counselor: "Xello couldn't handle transfer students effectively"
- Comprehensive solution for growing district

2. MEAD SCHOOL DISTRICT (WA)
- High student engagement rates
- Switched from combination of Xello/Naviance
- Unified platform advantage

3. WASHINGTON STATE
- State-level consideration of SchooLinks over Xello
- Better compliance reporting
- KRI analytics advantage""",
        "source_type": "database",
        "tags": ["xello", "wins", "customer-stories", "switching", "texas"],
        "confidence": 0.95,
        "is_verified": True
    },

    # Other competitors
    {
        "category": "competitor_intel",
        "subcategory": "other",
        "title": "MajorClarity Overview",
        "content": """MajorClarity (acquired by Paper) positions as one-stop CCR solution.

Characteristics:
- Career pathway focused
- Limited college readiness depth
- Basic reporting capabilities
- No graduation tracking integration
- Smaller market presence than Naviance/Xello

SchooLinks advantage: Broader functionality, unified platform, better compliance features.""",
        "source_type": "web_scrape",
        "tags": ["majorclarity", "competitor", "career-pathways"],
        "confidence": 0.80,
        "is_verified": False
    },
    {
        "category": "competitor_intel",
        "subcategory": "other",
        "title": "YouScience Brightpath Overview",
        "content": """YouScience Brightpath focuses on aptitude assessments and career matching.

Characteristics:
- Strong aptitude/skills assessments
- Career recommendation engine
- Weak college application support
- Limited course planning
- No comprehensive WBL

SchooLinks advantage: Complete K-12 solution, not just assessments. Better college readiness tools.""",
        "source_type": "web_scrape",
        "tags": ["youscience", "competitor", "assessments", "aptitude"],
        "confidence": 0.80,
        "is_verified": False
    },
    {
        "category": "competitor_intel",
        "subcategory": "other",
        "title": "Kuder Navigator Overview",
        "content": """Kuder Navigator is a legacy career assessment platform.

Characteristics:
- Assessment-focused approach
- Aging interface
- Limited actionable workflows
- Poor mobile experience
- Basic career exploration

SchooLinks advantage: Modern UX, comprehensive features, mobile-first design.""",
        "source_type": "web_scrape",
        "tags": ["kuder", "competitor", "legacy", "assessments"],
        "confidence": 0.75,
        "is_verified": False
    },

    # SchooLinks positioning
    {
        "category": "product_features",
        "subcategory": "differentiators",
        "title": "SchooLinks Key Differentiators",
        "content": """SchooLinks unique advantages vs all competitors:

1. UNIFIED PLATFORM
- Single sign-on experience
- All data flows between features
- No separate purchases for WBL, transcripts, etc.
- Reduces vendor count for districts

2. KEY READINESS INDICATOR (KRI)
- Proprietary analytics showing student readiness
- Actionable insights, not just data dumps
- District-wide visibility into progress
- Turns lagging indicators into leading predictors

3. MODERN UX
- Built mobile-first for Gen Z
- Gamification elements (Game of Life)
- Intuitive navigation without training
- High organic adoption rates

4. COMPREHENSIVE WBL
- Industry partner portal
- Experience tracking
- Digital badging
- Internship management
- Full placement lifecycle

5. STATE COMPLIANCE BUILT-IN
- ICAP, ECAP, PGP, HSBP support
- Graduation pathway tracking
- Audit-ready reporting
- Adapts to legislative changes

6. CUSTOMER SUCCESS
- Dedicated support (not call center)
- Implementation specialists
- Ongoing training resources
- Responsive to feature requests""",
        "source_type": "manual",
        "tags": ["schoolinks", "differentiators", "kri", "wbl", "unified"],
        "confidence": 0.95,
        "is_verified": True
    },

    # Battlecard content
    {
        "category": "messaging",
        "subcategory": "battlecards",
        "title": "Anti-Naviance Battlecard",
        "content": """When competing against Naviance:

OBJECTION: "We've always used Naviance"
RESPONSE: Districts switching report 500%+ engagement increases. Spokane, Tipp City, Lindbergh all left for better student experiences. Legacy doesn't mean better.

OBJECTION: "PowerSchool integration"
RESPONSE: SchooLinks has seamless PowerSchool/SIS integration AND better data flow across features. We integrate with the same systems.

OBJECTION: "Feature parity"
RESPONSE: Naviance charges extra for WBL, has dated UX, limited KRI-style analytics. SchooLinks includes everything in one platform.

OBJECTION: "Migration is hard"
RESPONSE: Our implementation team has migrated dozens of Naviance districts. Scope & sequence drives change management. Typical migration is 6-8 weeks.

KEY PROOF POINTS:
- 500%+ engagement at Spokane Public Schools
- 9 documented Naviance-to-SchooLinks customer stories
- Privacy lawsuits against Naviance (May 2024)
- Modern UX vs dated interface""",
        "source_type": "manual",
        "tags": ["battlecard", "naviance", "objections", "sales"],
        "confidence": 0.90,
        "is_verified": True
    },
    {
        "category": "messaging",
        "subcategory": "battlecards",
        "title": "Anti-Xello Battlecard",
        "content": """When competing against Xello:

OBJECTION: "Students like Xello's career tools"
RESPONSE: SchooLinks career tools are equally engaging PLUS college application management, WBL, graduation tracking. Students get more value.

OBJECTION: "Good for middle school"
RESPONSE: SchooLinks spans K-12 with age-appropriate experiences at each level. One platform from elementary through post-secondary.

OBJECTION: "Lower price"
RESPONSE: Calculate total cost including missing features - WBL, college apps, compliance tools are separate purchases or don't exist in Xello.

OBJECTION: "Already implemented"
RESPONSE: Liberty Hill TX switched mid-implementation when Xello couldn't handle transfer students. Our migration support is included.

KEY PROOF POINTS:
- Liberty Hill TX switched due to transfer student issues
- Xello only offers 4-year plans (we do 6-year)
- No true WBL management in Xello
- Washington state districts choosing SchooLinks over Xello""",
        "source_type": "manual",
        "tags": ["battlecard", "xello", "objections", "sales"],
        "confidence": 0.90,
        "is_verified": True
    },

    # Customer quotes
    {
        "category": "customer_quotes",
        "subcategory": "engagement",
        "title": "Spokane Public Schools Quote",
        "content": """Source: Spokane Public Schools (WA) - Customer Story

"We achieved over 500% growth in student engagement by switching from Naviance to SchooLinks. The platform's approach to involving students in the selection process made all the difference."

Context: Large district switch from Naviance, focused on student adoption as key metric.""",
        "source_type": "database",
        "tags": ["quote", "engagement", "naviance", "washington"],
        "confidence": 0.95,
        "is_verified": True
    },
    {
        "category": "customer_quotes",
        "subcategory": "wbl",
        "title": "Sarasota County Schools Quote",
        "content": """Source: Sarasota County Schools (FL) - Customer Story

"SchooLinks transformed our work-based learning initiatives. The comprehensive platform enhances career readiness and student engagement in ways Naviance never could."

Context: Florida district focused on WBL transformation, switched from Naviance.""",
        "source_type": "database",
        "tags": ["quote", "wbl", "naviance", "florida"],
        "confidence": 0.95,
        "is_verified": True
    },
    {
        "category": "customer_quotes",
        "subcategory": "transfer-students",
        "title": "Liberty Hill ISD Quote",
        "content": """Source: Liberty Hill ISD (TX) - Customer Story

"Xello couldn't handle transfer students effectively. SchooLinks provides a comprehensive, user-friendly solution that actually works for our CCMR program."

Context: Texas district with growth/transfer student challenges, switched from Xello.""",
        "source_type": "database",
        "tags": ["quote", "transfer", "xello", "texas", "ccmr"],
        "confidence": 0.95,
        "is_verified": True
    },
    {
        "category": "customer_quotes",
        "subcategory": "implementation",
        "title": "Pomperaug RSD 15 Quote",
        "content": """Source: Pomperaug Regional School District 15 (CT) - Customer Story

"The seamless integration with PowerSchool and user-friendly design made SchooLinks the preferred choice. The implementation was smooth and support is unmatched."

Context: Connecticut district praising implementation experience vs Naviance.""",
        "source_type": "database",
        "tags": ["quote", "implementation", "support", "naviance", "connecticut"],
        "confidence": 0.95,
        "is_verified": True
    },

    # Market research
    {
        "category": "market_research",
        "subcategory": "trends",
        "title": "CCR Market Trends 2024-2025",
        "content": """Key trends in College & Career Readiness market:

1. CONSOLIDATION PRESSURE
- Districts want fewer vendors
- Budget constraints driving platform consolidation
- "All-in-one" solutions preferred

2. COMPLIANCE COMPLEXITY
- State requirements increasing
- FAFSA completion mandates
- Graduation tracking requirements
- WBL documentation needs

3. STUDENT ENGAGEMENT FOCUS
- Gen Z expects mobile-first
- Gamification becoming standard
- Self-service over training-required

4. DATA-DRIVEN DECISION MAKING
- Districts want predictive analytics
- Real-time reporting vs annual
- Student-level drill-down required

5. WBL SCALING
- Post-COVID emphasis on career readiness
- Industry partnerships more important
- Documentation for compliance

6. PRIVACY CONCERNS
- Increased scrutiny on student data
- Naviance lawsuit raising awareness
- FERPA compliance top of mind""",
        "source_type": "web_scrape",
        "tags": ["market", "trends", "ccr", "consolidation", "compliance"],
        "confidence": 0.85,
        "is_verified": False
    }
]


def seed_context():
    """Seed the ai_context table with competitive intelligence"""
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    cur = conn.cursor()

    print(f"Seeding {len(CONTEXT_DATA)} context records...")

    for item in CONTEXT_DATA:
        cur.execute("""
            INSERT INTO ai_context (category, subcategory, title, content, source_type, source_url, tags, confidence, is_verified)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
        """, (
            item["category"],
            item.get("subcategory"),
            item["title"],
            item["content"],
            item.get("source_type"),
            item.get("source_url"),
            item.get("tags"),
            item.get("confidence"),
            item.get("is_verified", False)
        ))

    conn.commit()
    print("Seeding complete!")

    # Show what was inserted
    cur.execute("SELECT category, COUNT(*) FROM ai_context GROUP BY category ORDER BY category")
    counts = cur.fetchall()
    print("\nRecords by category:")
    for cat, count in counts:
        print(f"  - {cat}: {count}")

    cur.close()
    conn.close()


if __name__ == '__main__':
    seed_context()
