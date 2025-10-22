-- ============================================================================
-- ПРИМЕНЕНИЕ ТРИГГЕРОВ КО ВСЕМ ВЕРСИОНИРУЕМЫМ ТАБЛИЦАМ
-- ============================================================================

-- Удаляем существующие триггеры если есть
DROP TRIGGER IF EXISTS user_update_trigger ON "user";
DROP TRIGGER IF EXISTS organization_update_trigger ON organization;
DROP TRIGGER IF EXISTS order_update_trigger ON "order";
DROP TRIGGER IF EXISTS order_insert_trigger ON "order";
DROP TRIGGER IF EXISTS message_update_trigger ON message;
DROP TRIGGER IF EXISTS message_insert_trigger ON message;
DROP TRIGGER IF EXISTS notification_update_trigger ON notification;
DROP TRIGGER IF EXISTS notification_insert_trigger ON notification;
DROP TRIGGER IF EXISTS chat_update_trigger ON chat;
DROP TRIGGER IF EXISTS entity_permission_insert_trigger ON entity_permission;
DROP TRIGGER IF EXISTS entity_permission_delete_trigger ON entity_permission;

-- User table trigger
CREATE TRIGGER user_update_trigger
	BEFORE UPDATE ON "user"
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

-- Organization table trigger
CREATE TRIGGER organization_update_trigger
	BEFORE UPDATE ON organization
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

-- Order table trigger
CREATE TRIGGER order_update_trigger
	BEFORE UPDATE ON "order"
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

CREATE TRIGGER order_insert_trigger
	AFTER INSERT ON "order"
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

-- Message table trigger
CREATE TRIGGER message_update_trigger
	BEFORE UPDATE ON message
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

CREATE TRIGGER message_insert_trigger
	AFTER INSERT ON message
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

-- Notification table trigger
CREATE TRIGGER notification_update_trigger
	BEFORE UPDATE ON notification
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

CREATE TRIGGER notification_insert_trigger
	AFTER INSERT ON notification
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

-- Chat table trigger
CREATE TRIGGER chat_update_trigger
	BEFORE UPDATE ON chat
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

-- Entity Permission trigger (для отслеживания изменений прав доступа)
CREATE TRIGGER entity_permission_insert_trigger
	AFTER INSERT ON entity_permission
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

CREATE TRIGGER entity_permission_delete_trigger
	AFTER DELETE ON entity_permission
	FOR EACH ROW EXECUTE FUNCTION buffer_entity_notification();

-- Комментарий: триггеры применены ко всем основным таблицам
-- При необходимости можно добавить триггеры для других таблиц

