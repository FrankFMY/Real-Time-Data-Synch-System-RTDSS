/**
 * Collection Schema Registry
 *
 * Централизованное описание всех коллекций данных для системы синхронизации.
 * Каждая коллекция определяет:
 * - base_table: базовую таблицу PostgreSQL
 * - filter: фильтры для выборки записей
 * - includes: связанные таблицы (joins)
 * - fields: какие поля возвращать (sparse fieldsets)
 * - cache_strategy: стратегия кэширования на клиенте
 * - access_control: правила доступа
 */

export interface CollectionSchema {
	collection_id: string;
	base_table: string;
	filter?: Record<string, unknown>;
	includes?: Record<
		string,
		{
			table: string;
			fk: string;
		}
	>;
	fields: Record<string, string[]>;
	cache_strategy: {
		ttl: number; // Time to live в миллисекундах
		persist_offline: boolean; // Сохранять в IndexedDB?
		revalidate_on_focus?: boolean; // Обновлять при возврате на вкладку?
		stale_while_revalidate?: boolean; // Показывать старое + обновлять фоном?
		max_items?: number; // Максимум элементов в кэше
		priority?: 'high' | 'medium' | 'low';
	};
	access_control: {
		type: 'row_level' | 'collection_level' | 'custom' | 'implicit';
		rules?: string[]; // Названия RLS политик
		check_function?: string; // Кастомная функция проверки
		owner_field?: string; // Поле владельца для implicit
	};
}

/**
 * Реестр всех коллекций
 */
export const COLLECTIONS: Record<string, CollectionSchema> = {
	// ========================================================================
	// ORDERS
	// ========================================================================

	/**
	 * Активные заказы (pending, accepted, in_progress, delivering)
	 */
	orders_active: {
		collection_id: 'orders_active',
		base_table: 'order',
		filter: {
			status: ['pending', 'accepted', 'in_progress', 'delivering']
		},
		includes: {
			customer: { table: 'user', fk: 'customer_id' },
			driver: { table: 'user', fk: 'driver_id' },
			organization: { table: 'organization', fk: 'organization_id' }
		},
		fields: {
			order: [
				'id',
				'status',
				'total',
				'pickup_address',
				'delivery_address',
				'description',
				'accepted_at',
				'created_at',
				'version'
			],
			user: ['id', 'nickname', 'avatar_url', 'phone'],
			organization: ['id', 'name', 'logo_url']
		},
		cache_strategy: {
			ttl: 30000, // 30 секунд
			persist_offline: true,
			revalidate_on_focus: true,
			stale_while_revalidate: false,
			priority: 'high'
		},
		access_control: {
			type: 'row_level',
			rules: ['is_driver', 'is_customer', 'is_organization_member', 'is_admin']
		}
	},

	/**
	 * История заказов (delivered, cancelled)
	 */
	orders_history: {
		collection_id: 'orders_history',
		base_table: 'order',
		filter: {
			status: ['delivered', 'cancelled']
		},
		includes: {
			customer: { table: 'user', fk: 'customer_id' },
			driver: { table: 'user', fk: 'driver_id' }
		},
		fields: {
			order: [
				'id',
				'status',
				'total',
				'pickup_address',
				'delivery_address',
				'completed_at',
				'created_at'
			],
			user: ['id', 'nickname', 'avatar_url']
		},
		cache_strategy: {
			ttl: 300000, // 5 минут
			persist_offline: true,
			stale_while_revalidate: true,
			max_items: 50,
			priority: 'low'
		},
		access_control: {
			type: 'row_level',
			rules: ['is_customer', 'is_driver', 'is_organization_member']
		}
	},

	/**
	 * Мои заказы как клиента
	 */
	orders_my_customer: {
		collection_id: 'orders_my_customer',
		base_table: 'order',
		filter: {
			customer_id: '$current_user'
		},
		includes: {
			driver: { table: 'user', fk: 'driver_id' }
		},
		fields: {
			order: [
				'id',
				'status',
				'total',
				'pickup_address',
				'delivery_address',
				'created_at',
				'updated_at',
				'version'
			],
			user: ['id', 'nickname', 'avatar_url', 'phone']
		},
		cache_strategy: {
			ttl: 60000, // 1 минута
			persist_offline: true,
			revalidate_on_focus: true,
			priority: 'high'
		},
		access_control: {
			type: 'implicit',
			owner_field: 'customer_id'
		}
	},

	/**
	 * Мои заказы как водителя
	 */
	orders_my_driver: {
		collection_id: 'orders_my_driver',
		base_table: 'order',
		filter: {
			driver_id: '$current_user'
		},
		includes: {
			customer: { table: 'user', fk: 'customer_id' }
		},
		fields: {
			order: [
				'id',
				'status',
				'total',
				'pickup_address',
				'delivery_address',
				'accepted_at',
				'created_at',
				'version'
			],
			user: ['id', 'nickname', 'avatar_url', 'phone']
		},
		cache_strategy: {
			ttl: 30000, // 30 секунд
			persist_offline: true,
			revalidate_on_focus: true,
			priority: 'high'
		},
		access_control: {
			type: 'implicit',
			owner_field: 'driver_id'
		}
	},

	// ========================================================================
	// CHATS & MESSAGES
	// ========================================================================

	/**
	 * Сообщения чата (параметризованная коллекция)
	 * Использование: chat_messages:chat_id
	 */
	'chat_messages:*': {
		collection_id: 'chat_messages',
		base_table: 'message',
		filter: {
			chat_id: '$param' // Параметр из subscription
		},
		includes: {
			sender: { table: 'user', fk: 'sender_id' }
		},
		fields: {
			message: ['id', 'text', 'created_at', 'updated_at', 'version'],
			user: ['id', 'nickname', 'avatar_url']
		},
		cache_strategy: {
			ttl: 60000, // 1 минута
			persist_offline: true,
			max_items: 100, // Последние 100 сообщений
			priority: 'high'
		},
		access_control: {
			type: 'custom',
			check_function: 'check_chat_membership'
		}
	},

	/**
	 * Список моих чатов
	 */
	chats_my: {
		collection_id: 'chats_my',
		base_table: 'chat',
		filter: {
			// Чаты где я участник
			participant_user_id: '$current_user'
		},
		fields: {
			chat: ['id', 'name', 'is_group', 'updated_at', 'version']
		},
		cache_strategy: {
			ttl: 120000, // 2 минуты
			persist_offline: true,
			revalidate_on_focus: true,
			priority: 'medium'
		},
		access_control: {
			type: 'custom',
			check_function: 'check_chat_membership'
		}
	},

	// ========================================================================
	// NOTIFICATIONS
	// ========================================================================

	/**
	 * Мои уведомления
	 */
	user_notifications: {
		collection_id: 'user_notifications',
		base_table: 'notification',
		filter: {
			user_id: '$current_user'
		},
		fields: {
			notification: ['id', 'type', 'title', 'message', 'read', 'data', 'created_at', 'version']
		},
		cache_strategy: {
			ttl: 10000, // 10 секунд (часто обновляются)
			persist_offline: true,
			max_items: 50,
			priority: 'high'
		},
		access_control: {
			type: 'implicit',
			owner_field: 'user_id'
		}
	},

	/**
	 * Непрочитанные уведомления
	 */
	user_notifications_unread: {
		collection_id: 'user_notifications_unread',
		base_table: 'notification',
		filter: {
			user_id: '$current_user',
			read: false
		},
		fields: {
			notification: ['id', 'type', 'title', 'message', 'created_at']
		},
		cache_strategy: {
			ttl: 5000, // 5 секунд
			persist_offline: true,
			priority: 'high'
		},
		access_control: {
			type: 'implicit',
			owner_field: 'user_id'
		}
	},

	// ========================================================================
	// ORGANIZATIONS
	// ========================================================================

	/**
	 * Мои организации
	 */
	organizations_my: {
		collection_id: 'organizations_my',
		base_table: 'organization',
		filter: {
			employee_user_id: '$current_user'
		},
		fields: {
			organization: ['id', 'name', 'description', 'logo_url', 'version']
		},
		cache_strategy: {
			ttl: 300000, // 5 минут
			persist_offline: true,
			stale_while_revalidate: true,
			priority: 'medium'
		},
		access_control: {
			type: 'custom',
			check_function: 'check_organization_membership'
		}
	},

	// ========================================================================
	// USERS
	// ========================================================================

	/**
	 * Профиль пользователя (параметризованная коллекция)
	 */
	'user_profile:*': {
		collection_id: 'user_profile',
		base_table: 'user',
		filter: {
			id: '$param'
		},
		fields: {
			user: ['id', 'nickname', 'email', 'phone', 'avatar_url', 'role', 'balance', 'version']
		},
		cache_strategy: {
			ttl: 60000, // 1 минута
			persist_offline: true,
			stale_while_revalidate: true,
			priority: 'medium'
		},
		access_control: {
			type: 'row_level',
			rules: ['user_own_profile', 'user_in_chats', 'user_in_orders']
		}
	}
};

/**
 * Типы для type-safety
 */
export type CollectionId = keyof typeof COLLECTIONS;

/**
 * Вспомогательная функция для резолва параметризованных коллекций
 */
export function resolveCollectionId(collectionId: string, param?: string): string {
	if (collectionId.includes(':*') && param) {
		return collectionId.replace(':*', `:${param}`);
	}
	return collectionId;
}

/**
 * Получить schema коллекции
 */
export function getCollectionSchema(collectionId: string): CollectionSchema | null {
	// Прямое совпадение
	if (COLLECTIONS[collectionId]) {
		return COLLECTIONS[collectionId];
	}

	// Параметризованная коллекция (например, chat_messages:123 -> chat_messages:*)
	const baseId = collectionId.split(':')[0];
	const wildcardId = `${baseId}:*`;

	if (COLLECTIONS[wildcardId]) {
		return COLLECTIONS[wildcardId];
	}

	return null;
}
