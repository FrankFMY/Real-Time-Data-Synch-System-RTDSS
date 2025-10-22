import {
	pgTable,
	uuid,
	text,
	integer,
	timestamp,
	jsonb,
	pgEnum,
	boolean,
	varchar,
	index
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================================
// ENUMS
// ============================================================================

export const userRoleEnum = pgEnum('user_role', ['user', 'driver', 'admin']);
export const orderStatusEnum = pgEnum('order_status', [
	'pending',
	'accepted',
	'in_progress',
	'delivering',
	'delivered',
	'cancelled'
]);
export const permissionLevelEnum = pgEnum('permission_level', ['view', 'edit', 'admin']);

// ============================================================================
// USERS & AUTH
// ============================================================================

export const user = pgTable(
	'user',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		nickname: varchar('nickname', { length: 100 }).notNull(),
		email: varchar('email', { length: 255 }).notNull().unique(),
		phone: varchar('phone', { length: 20 }),
		avatarUrl: text('avatar_url'),
		role: userRoleEnum('role').notNull().default('user'),
		balance: integer('balance').notNull().default(0),

		// Версионирование для sync
		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [index('user_email_idx').on(table.email)]
);

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
});

// ============================================================================
// ORGANIZATIONS
// ============================================================================

export const organization = pgTable('organization', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: varchar('name', { length: 255 }).notNull(),
	description: text('description'),
	logoUrl: text('logo_url'),

	version: integer('version').notNull().default(1),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

export const organizationEmployee = pgTable(
	'organization_employee',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		organizationId: uuid('organization_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: varchar('role', { length: 50 }).notNull().default('employee'),

		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('org_employee_org_idx').on(table.organizationId),
		index('org_employee_user_idx').on(table.userId)
	]
);

// ============================================================================
// ORDERS
// ============================================================================

export const order = pgTable(
	'order',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		customerId: uuid('customer_id')
			.notNull()
			.references(() => user.id),
		driverId: uuid('driver_id').references(() => user.id),
		organizationId: uuid('organization_id').references(() => organization.id),

		status: orderStatusEnum('status').notNull().default('pending'),
		total: integer('total').notNull(),
		pickupAddress: text('pickup_address').notNull(),
		deliveryAddress: text('delivery_address').notNull(),
		description: text('description'),

		acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
		completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),

		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('order_customer_idx').on(table.customerId),
		index('order_driver_idx').on(table.driverId),
		index('order_status_idx').on(table.status),
		index('order_organization_idx').on(table.organizationId)
	]
);

export const orderHistory = pgTable('order_history', {
	id: uuid('id').primaryKey().defaultRandom(),
	orderId: uuid('order_id')
		.notNull()
		.references(() => order.id, { onDelete: 'cascade' }),
	userId: uuid('user_id')
		.notNull()
		.references(() => user.id),
	action: varchar('action', { length: 50 }).notNull(),
	details: jsonb('details'),

	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

// ============================================================================
// MESSAGES & CHATS
// ============================================================================

export const chat = pgTable('chat', {
	id: uuid('id').primaryKey().defaultRandom(),
	name: varchar('name', { length: 255 }),
	isGroup: boolean('is_group').notNull().default(false),

	version: integer('version').notNull().default(1),
	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

export const chatParticipant = pgTable(
	'chat_participant',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		chatId: uuid('chat_id')
			.notNull()
			.references(() => chat.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('chat_participant_chat_idx').on(table.chatId),
		index('chat_participant_user_idx').on(table.userId)
	]
);

export const message = pgTable(
	'message',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		chatId: uuid('chat_id')
			.notNull()
			.references(() => chat.id, { onDelete: 'cascade' }),
		senderId: uuid('sender_id')
			.notNull()
			.references(() => user.id),
		text: text('text').notNull(),

		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('message_chat_idx').on(table.chatId),
		index('message_created_idx').on(table.createdAt)
	]
);

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export const notification = pgTable(
	'notification',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		type: varchar('type', { length: 50 }).notNull(),
		title: varchar('title', { length: 255 }).notNull(),
		message: text('message').notNull(),
		read: boolean('read').notNull().default(false),
		data: jsonb('data'),

		version: integer('version').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('notification_user_idx').on(table.userId),
		index('notification_read_idx').on(table.read)
	]
);

// ============================================================================
// ENTITY PERMISSIONS (Динамические права доступа)
// ============================================================================

export const entityPermission = pgTable(
	'entity_permission',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		entityType: varchar('entity_type', { length: 50 }).notNull(),
		entityId: uuid('entity_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		permissionLevel: permissionLevelEnum('permission_level').notNull().default('view'),
		grantedBy: uuid('granted_by').references(() => user.id),
		expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),

		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [
		index('entity_permission_user_idx').on(table.userId),
		index('entity_permission_entity_idx').on(table.entityType, table.entityId)
	]
);

// ============================================================================
// SYNC INFRASTRUCTURE
// ============================================================================

export const pendingNotification = pgTable(
	'pending_notification',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		txId: text('tx_id').notNull(),
		eventType: varchar('event_type', { length: 50 }).notNull(),
		payload: jsonb('payload').notNull(),

		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
	},
	(table) => [index('pending_notification_tx_idx').on(table.txId)]
);

export const collectionSchema = pgTable('collection_schema', {
	collectionId: varchar('collection_id', { length: 100 }).primaryKey(),
	baseTable: varchar('base_table', { length: 100 }).notNull(),
	filterRules: jsonb('filter_rules').notNull(),
	accessRules: jsonb('access_rules').notNull(),
	includes: jsonb('includes'),
	fields: jsonb('fields'),
	cacheStrategy: jsonb('cache_strategy'),

	createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

// ============================================================================
// RELATIONS
// ============================================================================

export const userRelations = relations(user, ({ many }) => ({
	sessions: many(session),
	orders: many(order),
	organizations: many(organizationEmployee),
	notifications: many(notification),
	messages: many(message),
	chatParticipants: many(chatParticipant)
}));

export const organizationRelations = relations(organization, ({ many }) => ({
	employees: many(organizationEmployee),
	orders: many(order)
}));

export const orderRelations = relations(order, ({ one, many }) => ({
	customer: one(user, {
		fields: [order.customerId],
		references: [user.id]
	}),
	driver: one(user, {
		fields: [order.driverId],
		references: [user.id]
	}),
	organization: one(organization, {
		fields: [order.organizationId],
		references: [organization.id]
	}),
	history: many(orderHistory)
}));

export const chatRelations = relations(chat, ({ many }) => ({
	participants: many(chatParticipant),
	messages: many(message)
}));

export const messageRelations = relations(message, ({ one }) => ({
	chat: one(chat, {
		fields: [message.chatId],
		references: [chat.id]
	}),
	sender: one(user, {
		fields: [message.senderId],
		references: [user.id]
	})
}));

// ============================================================================
// TYPES
// ============================================================================

export type Session = typeof session.$inferSelect;
export type User = typeof user.$inferSelect;
export type Organization = typeof organization.$inferSelect;
export type Order = typeof order.$inferSelect;
export type Message = typeof message.$inferSelect;
export type Notification = typeof notification.$inferSelect;
export type EntityPermission = typeof entityPermission.$inferSelect;
export type CollectionSchema = typeof collectionSchema.$inferSelect;
