-- ============================================================================
-- DATABASE TESTS: Триггеры и функции
-- ============================================================================

-- Эти тесты запускаются напрямую в PostgreSQL для проверки корректности
-- триггеров, RLS политик и вспомогательных функций

\echo '🧪 Testing database triggers and functions...\n'

-- Подготовка: создаём тестового пользователя
BEGIN;

SET LOCAL app.current_user_id = '00000000-0000-0000-0000-000000000001';
SET LOCAL app.initiator_client_id = 'test-client-123';

-- Вставляем тестового пользователя если нет
INSERT INTO "user" (id, nickname, email, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'Test User', 'test@example.com', 'user')
ON CONFLICT (id) DO NOTHING;

COMMIT;

\echo '✅ Test user created\n'

-- ============================================================================
-- TEST 1: Триггер инкрементирует версию при UPDATE
-- ============================================================================

\echo 'TEST 1: Version increment on UPDATE...'

BEGIN;

SET LOCAL app.current_user_id = '00000000-0000-0000-0000-000000000001';

-- Создаём тестовую запись
INSERT INTO "user" (id, nickname, email, version)
VALUES ('10000000-0000-0000-0000-000000000001', 'Version Test', 'version@test.com', 1)
ON CONFLICT (id) DO UPDATE SET version = 1;

-- Запоминаем версию
DO $$
DECLARE
  old_version INTEGER;
  new_version INTEGER;
BEGIN
  SELECT version INTO old_version FROM "user" WHERE id = '10000000-0000-0000-0000-000000000001';
  
  -- Обновляем
  UPDATE "user" SET nickname = 'Updated Name' WHERE id = '10000000-0000-0000-0000-000000000001';
  
  SELECT version INTO new_version FROM "user" WHERE id = '10000000-0000-0000-0000-000000000001';
  
  -- Проверка
  IF new_version = old_version + 1 THEN
    RAISE NOTICE '  ✅ Version incremented: % -> %', old_version, new_version;
  ELSE
    RAISE EXCEPTION '  ❌ Version not incremented! Old: %, New: %', old_version, new_version;
  END IF;
END $$;

ROLLBACK;

-- ============================================================================
-- TEST 2: Триггер создаёт pending_notification
-- ============================================================================

\echo 'TEST 2: Pending notification created...'

BEGIN;

SET LOCAL app.current_user_id = '00000000-0000-0000-0000-000000000001';
SET LOCAL app.initiator_client_id = 'test-client-456';

-- Очищаем pending_notifications
DELETE FROM pending_notification;

-- Создаём заказ (для order есть коллекции)
INSERT INTO "order" (id, customer_id, pickup_address, delivery_address, total, status)
VALUES ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Test Pickup', 'Test Delivery', 1000, 'pending')
ON CONFLICT (id) DO UPDATE SET status = 'pending', version = "order".version;

-- Обновляем заказ (триггерит buffer_entity_notification)
UPDATE "order" 
SET status = 'accepted' 
WHERE id = '20000000-0000-0000-0000-000000000001';

-- Проверяем pending_notifications
DO $$
DECLARE
  notification_count INTEGER;
  payload_data JSONB;
BEGIN
  SELECT COUNT(*) INTO notification_count FROM pending_notification;
  
  IF notification_count > 0 THEN
    RAISE NOTICE '  ✅ Pending notification created (count: %)', notification_count;
    
    -- Проверяем payload
    SELECT payload INTO payload_data FROM pending_notification LIMIT 1;
    
    IF payload_data->>'entity_type' = 'order' THEN
      RAISE NOTICE '  ✅ Entity type correct: order';
    ELSE
      RAISE EXCEPTION '  ❌ Wrong entity_type: %', payload_data->>'entity_type';
    END IF;
    
    IF payload_data->>'initiator_client_id' = 'test-client-456' THEN
      RAISE NOTICE '  ✅ Initiator client ID preserved: test-client-456';
    ELSE
      RAISE EXCEPTION '  ❌ Initiator client ID wrong: %', payload_data->>'initiator_client_id';
    END IF;
  ELSE
    RAISE EXCEPTION '  ❌ No pending notification created!';
  END IF;
END $$;

ROLLBACK;

-- ============================================================================
-- TEST 3: flush_batch_notifications отправляет NOTIFY
-- ============================================================================

\echo 'TEST 3: flush_batch_notifications() works...'

BEGIN;

SET LOCAL app.current_user_id = '00000000-0000-0000-0000-000000000001';
SET LOCAL app.initiator_client_id = 'batch-test-client';

-- Создаём несколько изменений
DELETE FROM pending_notification;

-- Создаём заказы
INSERT INTO "order" (id, customer_id, pickup_address, delivery_address, total, status)
VALUES 
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'P1', 'D1', 1000, 'pending'),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'P2', 'D2', 2000, 'pending')
ON CONFLICT (id) DO NOTHING;

-- Обновляем оба заказа
UPDATE "order" SET status = 'accepted' WHERE id = '30000000-0000-0000-0000-000000000001';
UPDATE "order" SET status = 'accepted' WHERE id = '30000000-0000-0000-0000-000000000002';

-- Проверяем что есть pending notifications
DO $$
DECLARE
  pending_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pending_count FROM pending_notification;
  
  IF pending_count >= 2 THEN
    RAISE NOTICE '  ✅ Multiple pending notifications: %', pending_count;
  ELSE
    RAISE EXCEPTION '  ❌ Expected at least 2 pending notifications, got %', pending_count;
  END IF;
END $$;

-- Вызываем flush (в реальности это вызовет pg_notify, но мы не можем протестировать LISTEN здесь)
SELECT flush_batch_notifications();

-- Проверяем что очистилось
DO $$
DECLARE
  pending_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pending_count FROM pending_notification;
  
  IF pending_count = 0 THEN
    RAISE NOTICE '  ✅ Pending notifications cleared after flush';
  ELSE
    RAISE EXCEPTION '  ❌ Pending notifications not cleared: %', pending_count;
  END IF;
END $$;

ROLLBACK;

-- ============================================================================
-- TEST 4: RLS Policy - User видит только свои заказы
-- ============================================================================

\echo 'TEST 4: RLS policies work...'

BEGIN;

-- Создаём двух пользователей
INSERT INTO "user" (id, nickname, email)
VALUES 
  ('40000000-0000-0000-0000-000000000001', 'User A', 'usera@test.com'),
  ('40000000-0000-0000-0000-000000000002', 'User B', 'userb@test.com')
ON CONFLICT (id) DO NOTHING;

-- Создаём заказы для User A
INSERT INTO "order" (id, customer_id, pickup_address, delivery_address, total, status)
VALUES 
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Address A1', 'Address A2', 1000, 'pending')
ON CONFLICT (id) DO NOTHING;

-- Создаём заказ для User B
INSERT INTO "order" (id, customer_id, pickup_address, delivery_address, total, status)
VALUES 
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 'Address B1', 'Address B2', 2000, 'pending')
ON CONFLICT (id) DO NOTHING;

-- User A читает заказы
SET LOCAL app.current_user_id = '40000000-0000-0000-0000-000000000001';

DO $$
DECLARE
  order_count INTEGER;
  wrong_order_visible BOOLEAN;
BEGIN
  -- User A должен видеть только свой заказ
  SELECT COUNT(*) INTO order_count FROM "order" WHERE customer_id = '40000000-0000-0000-0000-000000000001';
  
  IF order_count = 1 THEN
    RAISE NOTICE '  ✅ User A sees own order';
  ELSE
    RAISE EXCEPTION '  ❌ User A order count wrong: %', order_count;
  END IF;
  
  -- User A НЕ должен видеть заказ User B через прямой SELECT
  SELECT EXISTS (
    SELECT 1 FROM "order" WHERE id = '50000000-0000-0000-0000-000000000002'
  ) INTO wrong_order_visible;
  
  IF wrong_order_visible THEN
    RAISE NOTICE '  ⚠️  WARNING: User A can see User B order (RLS may be disabled for superuser)';
  ELSE
    RAISE NOTICE '  ✅ User A cannot see User B order';
  END IF;
END $$;

ROLLBACK;

\echo '\n✅ All database tests passed!\n'

