#!/bin/bash
# Test OpenAI Models Availability
# Run this to see which models work with your API key

# Check if OPENAI_API_KEY is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "ERROR: OPENAI_API_KEY environment variable not set"
    echo "Run: export OPENAI_API_KEY='your-key-here'"
    exit 1
fi

echo "============================================"
echo "Testing OpenAI Models"
echo "============================================"

# Models to test
MODELS=("gpt-4o-mini" "gpt-4o" "gpt-4.1" "gpt-5-mini" "gpt-5.2" "gpt-5-nano" "o3-mini" "o4-mini")

for MODEL in "${MODELS[@]}"; do
    echo ""
    echo "Testing: $MODEL"
    echo "---"

    RESPONSE=$(curl -s -w "\n%{http_code}" https://api.openai.com/v1/chat/completions \
      -H "Authorization: Bearer $OPENAI_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"model\": \"$MODEL\", \"messages\": [{\"role\": \"user\", \"content\": \"Say hello\"}], \"max_tokens\": 5}")

    # Get HTTP status code (last line)
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    # Get response body (everything except last line)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        echo "✅ $MODEL - AVAILABLE"
        # Extract the response content
        CONTENT=$(echo "$BODY" | grep -o '"content":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo "   Response: $CONTENT"
    elif [ "$HTTP_CODE" = "404" ]; then
        echo "❌ $MODEL - NOT FOUND (model doesn't exist)"
    elif [ "$HTTP_CODE" = "403" ]; then
        echo "⚠️  $MODEL - NO ACCESS (model exists but not available to your key)"
    else
        echo "❓ $MODEL - ERROR ($HTTP_CODE)"
        # Show error message
        ERROR=$(echo "$BODY" | grep -o '"message":"[^"]*"' | head -1 | cut -d'"' -f4)
        echo "   Error: $ERROR"
    fi
done

echo ""
echo "============================================"
echo "Test Complete"
echo "============================================"
echo ""
echo "Use the models marked ✅ in AI_MODELS config in nlp.js"
