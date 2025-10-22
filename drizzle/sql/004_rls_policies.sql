-- ============================================================================
-- ROW-LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Функция для получения текущего пользователя из session variable
CREATE OR REPLACE FUNCTION current_app_user_id() RETURNS UUID AS $$
BEGIN
	BEGIN
		RETURN current_setting('app.current_user_id', false)::UUID;
	EXCEPTION
		WHEN OTHERS THEN
			RETURN NULL;
	END;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- USER TABLE POLICIES
-- ============================================================================

ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;

-- Политика: видишь свой профиль
CREATE POLICY user_own_profile ON "user"
	FOR SELECT
	USING (id = current_app_user_id());

-- Политика: видишь пользователей в твоих чатах
CREATE POLICY user_in_chats ON "user"
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM chat_participant cp1
			INNER JOIN chat_participant cp2 ON cp1.chat_id = cp2.chat_id
			WHERE cp1.user_id = "user".id
				AND cp2.user_id = current_app_user_id()
		)
	);

-- Политика: видишь пользователей в твоих заказах
CREATE POLICY user_in_orders ON "user"
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM "order"
			WHERE (customer_id = current_app_user_id() OR driver_id = current_app_user_id())
				AND ("user".id = customer_id OR "user".id = driver_id)
		)
	);

-- Политика: админы видят всех
CREATE POLICY user_admin ON "user"
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM "user" u
			WHERE u.id = current_app_user_id()
				AND u.role = 'admin'
		)
	);

-- ============================================================================
-- ORDER TABLE POLICIES
-- ============================================================================

ALTER TABLE "order" ENABLE ROW LEVEL SECURITY;

-- Политика: видишь свои заказы как customer
CREATE POLICY order_as_customer ON "order"
	FOR SELECT
	USING (customer_id = current_app_user_id());

-- Политика: видишь свои заказы как driver
CREATE POLICY order_as_driver ON "order"
	FOR SELECT
	USING (driver_id = current_app_user_id());

-- Политика: сотрудник видит заказы организации
CREATE POLICY order_as_org_employee ON "order"
	FOR SELECT
	USING (
		organization_id IN (
			SELECT organization_id
			FROM organization_employee
			WHERE user_id = current_app_user_id()
		)
	);

-- Политика: динамические права доступа
CREATE POLICY order_dynamic_permissions ON "order"
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM entity_permission
			WHERE entity_type = 'order'
				AND entity_id = "order".id
				AND user_id = current_app_user_id()
				AND (expires_at IS NULL OR expires_at > NOW())
		)
	);

-- Политика: админы видят все заказы
CREATE POLICY order_admin ON "order"
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM "user"
			WHERE id = current_app_user_id()
				AND role = 'admin'
		)
	);

-- UPDATE политики для заказов
CREATE POLICY order_update_as_customer ON "order"
	FOR UPDATE
	USING (customer_id = current_app_user_id());

CREATE POLICY order_update_as_driver ON "order"
	FOR UPDATE
	USING (driver_id = current_app_user_id());

-- ============================================================================
-- MESSAGE TABLE POLICIES
-- ============================================================================

ALTER TABLE message ENABLE ROW LEVEL SECURITY;

-- Политика: видишь сообщения в своих чатах
CREATE POLICY message_in_own_chats ON message
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM chat_participant
			WHERE chat_id = message.chat_id
				AND user_id = current_app_user_id()
		)
	);

-- INSERT политика
CREATE POLICY message_insert_in_own_chats ON message
	FOR INSERT
	WITH CHECK (
		EXISTS (
			SELECT 1 FROM chat_participant
			WHERE chat_id = message.chat_id
				AND user_id = current_app_user_id()
		)
	);

-- ============================================================================
-- NOTIFICATION TABLE POLICIES
-- ============================================================================

ALTER TABLE notification ENABLE ROW LEVEL SECURITY;

-- Политика: видишь только свои уведомления
CREATE POLICY notification_own ON notification
	FOR SELECT
	USING (user_id = current_app_user_id());

-- UPDATE политика (для отметки прочитанным)
CREATE POLICY notification_update_own ON notification
	FOR UPDATE
	USING (user_id = current_app_user_id());

-- ============================================================================
-- ORGANIZATION TABLE POLICIES
-- ============================================================================

ALTER TABLE organization ENABLE ROW LEVEL SECURITY;

-- Политика: видишь организации, где ты сотрудник
CREATE POLICY organization_as_employee ON organization
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM organization_employee
			WHERE organization_id = organization.id
				AND user_id = current_app_user_id()
		)
	);

-- Политика: видишь организации из заказов
CREATE POLICY organization_in_orders ON organization
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM "order"
			WHERE organization_id = organization.id
				AND (customer_id = current_app_user_id() OR driver_id = current_app_user_id())
		)
	);

-- ============================================================================
-- CHAT TABLE POLICIES
-- ============================================================================

ALTER TABLE chat ENABLE ROW LEVEL SECURITY;

-- Политика: видишь чаты, где ты участник
CREATE POLICY chat_as_participant ON chat
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM chat_participant
			WHERE chat_id = chat.id
				AND user_id = current_app_user_id()
		)
	);

-- ============================================================================
-- ENTITY_PERMISSION TABLE POLICIES
-- ============================================================================

ALTER TABLE entity_permission ENABLE ROW LEVEL SECURITY;

-- Политика: видишь свои разрешения
CREATE POLICY entity_permission_own ON entity_permission
	FOR SELECT
	USING (user_id = current_app_user_id());

-- Политика: видишь разрешения на entity, к которым имеешь admin доступ
CREATE POLICY entity_permission_as_admin ON entity_permission
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM entity_permission ep
			WHERE ep.entity_type = entity_permission.entity_type
				AND ep.entity_id = entity_permission.entity_id
				AND ep.user_id = current_app_user_id()
				AND ep.permission_level = 'admin'
		)
	);

-- ============================================================================
-- CHAT_PARTICIPANT TABLE POLICIES
-- ============================================================================

ALTER TABLE chat_participant ENABLE ROW LEVEL SECURITY;

-- Политика: видишь участников своих чатов
CREATE POLICY chat_participant_in_own_chats ON chat_participant
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM chat_participant cp
			WHERE cp.chat_id = chat_participant.chat_id
				AND cp.user_id = current_app_user_id()
		)
	);

-- ============================================================================
-- ORGANIZATION_EMPLOYEE TABLE POLICIES
-- ============================================================================

ALTER TABLE organization_employee ENABLE ROW LEVEL SECURITY;

-- Политика: видишь сотрудников своих организаций
CREATE POLICY org_employee_same_org ON organization_employee
	FOR SELECT
	USING (
		EXISTS (
			SELECT 1 FROM organization_employee oe
			WHERE oe.organization_id = organization_employee.organization_id
				AND oe.user_id = current_app_user_id()
		)
	);

-- Комментарий: RLS политики обеспечивают персонализированный доступ
-- на уровне строк для каждого пользователя

