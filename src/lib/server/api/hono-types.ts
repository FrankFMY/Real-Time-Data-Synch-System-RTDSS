/**
 * Типы для Hono Context
 */

export type HonoEnv = {
	Variables: {
		userId: string;
		clientId?: string;
	};
};
