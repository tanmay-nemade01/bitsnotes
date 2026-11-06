/**
 * Chatbot model configuration.
 *
 * The admin-selected OpenRouter model is persisted in `app_settings` under the
 * `chatbot_model` key. When unset, the historical default model list is used so
 * existing deployments keep working without a migration seed.
 */

import type { AuthDb } from './auth/db';

export const CHATBOT_MODEL_SETTING_KEY = 'chatbot_model';

export const DEFAULT_CHATBOT_MODELS = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3.5-lightning:free',
];

export interface ChatbotModelConfig {
  /** Selected model, or null when the deployment is using the defaults. */
  model: string | null;
  /** Ordered fallback list passed to OpenRouter. */
  models: string[];
  isDefault: boolean;
}

/** Validate an OpenRouter-style model id. */
export function isValidModelId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^[A-Za-z0-9~][A-Za-z0-9._:~/-]{2,200}$/.test(value.trim());
}

/** Resolve the active chatbot model configuration. */
export async function getChatbotModel(db: AuthDb): Promise<ChatbotModelConfig> {
  try {
    const row = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(CHATBOT_MODEL_SETTING_KEY)
      .first<{ value: string }>();

    const value = row?.value?.trim();
    if (value && isValidModelId(value)) {
      return { model: value, models: [value], isDefault: false };
    }
  } catch (err) {
    // The app_settings table may not be migrated yet — fall back to defaults.
    console.error('[chatbotSettings] Could not read model setting:', err);
  }

  return { model: null, models: [...DEFAULT_CHATBOT_MODELS], isDefault: true };
}

/** Persist the admin-selected model. */
export async function setChatbotModel(
  db: AuthDb,
  model: string,
  updatedBy: string | null
): Promise<void> {
  const value = model.trim();
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
    )
    .bind(CHATBOT_MODEL_SETTING_KEY, value, Date.now(), updatedBy)
    .run();
}

/** Remove the override so the default model list is used again. */
export async function clearChatbotModel(db: AuthDb): Promise<void> {
  await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(CHATBOT_MODEL_SETTING_KEY).run();
}
