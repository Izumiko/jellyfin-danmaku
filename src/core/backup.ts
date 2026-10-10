import { DEFAULT_CONFIG, mergeConfig } from './config';
import { legacyConfigFrom } from './storage';
import type { DanmakuConfig } from '../types/index';

const BACKUP_APP = 'jellyfin-danmaku';
const BACKUP_VERSION = 3;
const LEGACY_ONLY_KEYS = ['danmakuopacity', 'danmakuspeed', 'danmakusize', 'danmakuheight', 'danmakuFilter', 'danmakuModeFilter', 'useAnitOverlap', 'danmakuBlockKeywords', 'danmakuBlockUsers'];

/** 备份不包含逐集偏移（运行时值，按集存在 IndexedDB） */
type BackupSettings = Omit<DanmakuConfig, 'curEpOffset'>;

function withoutOffset(config: DanmakuConfig): BackupSettings {
    const copy: Partial<DanmakuConfig> = { ...config };
    delete copy.curEpOffset;
    return copy as BackupSettings;
}

export function exportSettings(config: DanmakuConfig): string {
    const settings = withoutOffset(config);
    return JSON.stringify({ app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), settings }, null, 2);
}

/**
 * 解析设置备份。支持：
 * - 本版本导出的 JSON（settings 为新版字段）
 * - ede.js v1.62「设置备份」导出的 JSON（settings 为 localStorage 旧键，值为字符串）
 * - 直接粘贴的 settings 对象
 * @throws JSON 无法解析或结构不对时
 */
export function parseSettingsBackup(text: string): BackupSettings {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') throw new Error('不是有效的设置 JSON');

    const root = parsed as Record<string, unknown>;
    const settings = (root.settings && typeof root.settings === 'object' ? root.settings : root) as Record<string, unknown>;

    // danmakuSwitch 两种格式都有，只能用 ede.js 独有的键判断
    const looksLegacy = root.app !== BACKUP_APP && LEGACY_ONLY_KEYS.some((key) => key in settings);
    const knownKeys = Object.keys(DEFAULT_CONFIG).filter((key) => key in settings);
    if (!looksLegacy && knownKeys.length === 0) throw new Error('没有识别到任何弹幕设置项');

    const config = looksLegacy
        ? legacyConfigFrom((key) => (key in settings && settings[key] !== null && settings[key] !== undefined ? String(settings[key]) : null))
        : mergeConfig(settings);
    if (!config) throw new Error('设置内容无法解析');

    return withoutOffset(config);
}
