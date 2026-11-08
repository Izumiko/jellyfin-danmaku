/** 全局标记：同一个页面只允许一个插件实例启动 */
export const BOOT_GUARD_KEY = '__jellyfin_danmaku_booted__';

type GuardedWindow = Window & Record<string, unknown>;

/**
 * 占用启动标记。
 * 用户可能同时通过 Tampermonkey 和反向代理注入脚本，重复初始化会挂两套按钮/
 * 引擎/观察器，因此第二个实例必须直接退出。
 * @returns true 表示当前实例可以继续启动；false 表示已有实例在运行
 */
export function acquireBootGuard(target: Window = window): boolean {
    const guarded = target as GuardedWindow;
    if (guarded[BOOT_GUARD_KEY]) return false;
    guarded[BOOT_GUARD_KEY] = true;
    return true;
}

/** 启动失败时释放标记，允许用户重新加载脚本后重试 */
export function releaseBootGuard(target: Window = window): void {
    delete (target as GuardedWindow)[BOOT_GUARD_KEY];
}
