-- ============================================================================
-- HELPER FUNCTIONS ДЛЯ SYNC INFRASTRUCTURE
-- ============================================================================

-- Функция для проверки соответствия фильтру коллекции
CREATE OR REPLACE FUNCTION matches_collection_filter(
	record_data JSONB,
	filter_rules JSONB
) RETURNS BOOLEAN AS $$
DECLARE
	filter_key TEXT;
	filter_value JSONB;
	record_value JSONB;
BEGIN
	-- Если фильтров нет, запись подходит
	IF filter_rules IS NULL OR jsonb_typeof(filter_rules) = 'null' THEN
		RETURN TRUE;
	END IF;

	-- Проверяем каждое правило фильтра
	FOR filter_key, filter_value IN SELECT * FROM jsonb_each(filter_rules)
	LOOP
		record_value := record_data -> filter_key;

		-- Если поле отсутствует в записи, не подходит
		IF record_value IS NULL THEN
			RETURN FALSE;
		END IF;

		-- Если фильтр - массив значений (IN operator)
		IF jsonb_typeof(filter_value) = 'array' THEN
			IF NOT (record_value <@ filter_value) THEN
				RETURN FALSE;
			END IF;
		-- Если фильтр - одно значение (equals)
		ELSE
			IF record_value != filter_value THEN
				RETURN FALSE;
			END IF;
		END IF;
	END LOOP;

	RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Функция для определения затронутых коллекций
CREATE OR REPLACE FUNCTION resolve_affected_collections(
	table_name TEXT,
	record_data JSONB
) RETURNS TEXT[] AS $$
DECLARE
	result TEXT[] := ARRAY[]::TEXT[];
	schema_row RECORD;
BEGIN
	FOR schema_row IN
		SELECT collection_id, filter_rules
		FROM collection_schema
		WHERE base_table = table_name
	LOOP
		-- Проверяем: запись подходит под фильтр коллекции?
		IF matches_collection_filter(record_data, schema_row.filter_rules) THEN
			result := array_append(result, schema_row.collection_id);
		END IF;
	END LOOP;

	RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Функция для применения access rules и определения affected users
CREATE OR REPLACE FUNCTION apply_access_rules(
	record_data JSONB,
	access_rules JSONB
) RETURNS UUID[] AS $$
DECLARE
	result UUID[] := ARRAY[]::UUID[];
	rule_type TEXT;
	owner_field TEXT;
	entity_type TEXT;
	entity_id UUID;
BEGIN
	rule_type := access_rules->>'type';

	-- Implicit owner (owner_field)
	IF rule_type = 'implicit' AND access_rules ? 'owner_field' THEN
		owner_field := access_rules->>'owner_field';
		result := array_append(result, (record_data->>owner_field)::UUID);
		RETURN result;
	END IF;

	-- Row-level security (определяем из связей)
	IF rule_type = 'row_level' THEN
		-- Для orders: customer_id, driver_id, organization members
		IF record_data ? 'customer_id' THEN
			result := array_append(result, (record_data->>'customer_id')::UUID);
		END IF;
		IF record_data ? 'driver_id' AND record_data->>'driver_id' IS NOT NULL THEN
			result := array_append(result, (record_data->>'driver_id')::UUID);
		END IF;
		
		-- Добавить членов организации
		IF record_data ? 'organization_id' AND record_data->>'organization_id' IS NOT NULL THEN
			result := array_cat(result, ARRAY(
				SELECT user_id FROM organization_employee 
				WHERE organization_id = (record_data->>'organization_id')::UUID
			));
		END IF;
	END IF;

	-- Custom check function
	IF rule_type = 'custom' AND access_rules ? 'check_function' THEN
		-- Оставляем для будущей реализации специфичных проверок
		-- Например, для chat_messages: проверка членства в чате
	END IF;

	-- Collection-level (все пользователи с доступом к коллекции)
	IF rule_type = 'collection_level' THEN
		-- Для глобальных коллекций (например, public notifications)
		RETURN result;
	END IF;

	-- Дедупликация
	SELECT ARRAY_AGG(DISTINCT user_id) INTO result FROM unnest(result) AS user_id;
	
	RETURN COALESCE(result, ARRAY[]::UUID[]);
END;
$$ LANGUAGE plpgsql;

-- Функция для определения affected users на основе коллекций
CREATE OR REPLACE FUNCTION resolve_affected_users(
	table_name TEXT,
	record_data JSONB,
	collections TEXT[]
) RETURNS UUID[] AS $$
DECLARE
	result UUID[] := ARRAY[]::UUID[];
	collection_id TEXT;
	schema_row RECORD;
BEGIN
	FOREACH collection_id IN ARRAY collections
	LOOP
		SELECT access_rules INTO schema_row
		FROM collection_schema
		WHERE collection_schema.collection_id = collection_id;

		IF FOUND THEN
			-- Применяем access_rules для определения пользователей
			result := array_cat(
				result,
				apply_access_rules(record_data, schema_row.access_rules)
			);
		END IF;
	END LOOP;

	-- Дедупликация
	SELECT ARRAY_AGG(DISTINCT user_id) INTO result FROM unnest(result) AS user_id;
	
	RETURN COALESCE(result, ARRAY[]::UUID[]);
END;
$$ LANGUAGE plpgsql;

-- Функция для получения дедуплицированного массива UUID
CREATE OR REPLACE FUNCTION array_distinct_uuid(arr UUID[]) RETURNS UUID[] AS $$
	SELECT ARRAY_AGG(DISTINCT val) FROM unnest(arr) AS val;
$$ LANGUAGE SQL IMMUTABLE;

