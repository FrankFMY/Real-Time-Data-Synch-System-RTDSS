-- ============================================================================
-- SESSION CONFIGURATION
-- ============================================================================

-- Настройка кастомных session variables для приложения
-- Эти переменные используются для RLS и триггеров

-- Устанавливаем дефолтные значения для session variables
ALTER DATABASE local SET app.current_user_id TO DEFAULT;
ALTER DATABASE local SET app.initiator_client_id TO DEFAULT;

-- Комментарий: 
-- app.current_user_id - используется для RLS политик
-- app.initiator_client_id - используется для исключения initiator из SSE рассылки

