#!/bin/bash

# Скрипт для запуска database SQL тестов

echo "🧪 Running PostgreSQL database tests..."
echo ""

# Проверка что PostgreSQL запущен
if ! docker ps | grep -q sandbox-db; then
    echo "❌ PostgreSQL container not running!"
    echo "Run: pnpm db:start"
    exit 1
fi

echo "✅ PostgreSQL container running"
echo ""

# Запуск SQL тестов
echo "Running tests/database/triggers.test.sql..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

docker exec -i sandbox-db-1 psql -U root -d local < tests/database/triggers.test.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ All database tests passed!"
else
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "❌ Database tests failed!"
    exit 1
fi

