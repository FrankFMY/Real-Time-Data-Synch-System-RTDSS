-- ============================================================================
-- TRIGGER FUNCTIONS ДЛЯ БАТЧИНГА СОБЫТИЙ
-- ============================================================================

-- Функция для буферизации событий изменения
CREATE OR REPLACE FUNCTION buffer_entity_notification()
RETURNS TRIGGER AS $$
DECLARE
	affected_users UUID[];
	affected_collections TEXT[];
	initiator_client TEXT;
	record_json JSONB;
	current_record RECORD;
BEGIN
	-- Выбираем текущую запись в зависимости от операции
	IF TG_OP = 'DELETE' THEN
		current_record := OLD;
		record_json := to_jsonb(OLD);
	ELSE
		current_record := NEW;
		record_json := to_jsonb(NEW);
	END IF;

	-- Проверяем реальные изменения при UPDATE (пропускаем если нет изменений)
	IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
		RETURN NEW;
	END IF;

	-- Инкрементируем версию и updated_at при UPDATE
	IF TG_OP = 'UPDATE' THEN
		NEW.version = OLD.version + 1;
		NEW.updated_at = NOW();
		record_json := to_jsonb(NEW);
	END IF;

	-- Определяем затронутые коллекции на основе schema
	affected_collections := resolve_affected_collections(TG_TABLE_NAME, record_json);

	-- Если ни одна коллекция не затронута, пропускаем
	IF array_length(affected_collections, 1) IS NULL THEN
		RETURN NEW;
	END IF;

	-- Определяем затронутых пользователей на основе RLS + schema
	affected_users := resolve_affected_users(TG_TABLE_NAME, record_json, affected_collections);

	-- Если нет затронутых пользователей, пропускаем
	IF array_length(affected_users, 1) IS NULL THEN
		RETURN NEW;
	END IF;

	-- Получаем initiator_client_id из session variable (если есть)
	BEGIN
		initiator_client := current_setting('app.initiator_client_id', true);
	EXCEPTION
		WHEN OTHERS THEN
			initiator_client := NULL;
	END;

	-- Буферизуем событие в pending_notifications
	INSERT INTO pending_notification (tx_id, event_type, payload)
	VALUES (
		txid_current()::TEXT,
		'entity_updated',
		jsonb_build_object(
			'entity_type', TG_TABLE_NAME,
			'entity_id', NEW.id,
			'entity_version', NEW.version,
			'affected_collections', affected_collections,
			'affected_users', affected_users,
			'data_snapshot', record_json,
			'initiator_client_id', initiator_client,
			'operation', TG_OP
		)
	);

	-- Возвращаем правильное значение в зависимости от операции
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	ELSE
		RETURN NEW;
	END IF;
END;
$$ LANGUAGE plpgsql;

-- Функция для отправки батча после COMMIT
CREATE OR REPLACE FUNCTION flush_batch_notifications()
RETURNS void AS $$
DECLARE
	current_tx TEXT;
	batch_events JSONB;
	initiator_client TEXT;
	event_count INTEGER;
BEGIN
	current_tx := txid_current()::TEXT;

	-- Получаем initiator для этого батча из session
	BEGIN
		initiator_client := current_setting('app.initiator_client_id', true);
	EXCEPTION
		WHEN OTHERS THEN
			initiator_client := NULL;
	END;

	-- Собираем все события текущей транзакции
	SELECT jsonb_agg(payload ORDER BY created_at), COUNT(*)
	INTO batch_events, event_count
	FROM pending_notification
	WHERE tx_id = current_tx;

	-- Отправляем ОДИН NOTIFY с батчем
	IF batch_events IS NOT NULL AND event_count > 0 THEN
		PERFORM pg_notify(
			'batch_updates',
			jsonb_build_object(
				'tx_id', current_tx,
				'events', batch_events,
				'timestamp', extract(epoch from NOW()),
				'initiator_client_id', initiator_client,
				'event_count', event_count
			)::TEXT
		);
		
		RAISE NOTICE 'Batch % flushed: % events', current_tx, event_count;
	END IF;

	-- Очищаем буфер текущей транзакции
	DELETE FROM pending_notification WHERE tx_id = current_tx;
END;
$$ LANGUAGE plpgsql;

-- Функция для автоматической отправки батча при коммите транзакции
-- (альтернатива явному вызову flush_batch_notifications)
CREATE OR REPLACE FUNCTION auto_flush_batch_on_commit()
RETURNS event_trigger AS $$
BEGIN
	-- Эта функция будет вызвана автоматически при COMMIT
	-- Но в PostgreSQL нет event trigger для COMMIT,
	-- поэтому используем явный вызов в коде
END;
$$ LANGUAGE plpgsql;

