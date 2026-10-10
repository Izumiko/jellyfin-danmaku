import { get, post } from '../http';
import { Storage } from '../../core/storage';
import { logger } from '../../core/logger';
import type { DanDanPlayStatus } from '../../types/index';

export class DanDanPlayAuth {
    private status: DanDanPlayStatus;

    constructor(private apiPrefix: string) {
        this.status = Storage.loadDanDanPlayStatus() ?? {
            isLogin: false,
            token: '',
            tokenExpire: 0,
        };
    }

    setApiPrefix(apiPrefix: string): void {
        this.apiPrefix = apiPrefix;
    }

    get isLoggedIn(): boolean {
        return this.status.isLogin && this.status.tokenExpire > Date.now();
    }

    get token(): string {
        return this.status.token;
    }

    get userName(): string {
        return this.status.userName ?? '';
    }

    /**
     * 登录
     */
    async login(account: string, password: string): Promise<boolean> {
        try {
            const url = `${this.apiPrefix}/api/v2/login`;
            logger.debug('auth', `Logging in as ${account}`);

            const response = await post<{
                errorCode: number;
                token: string;
                tokenExpireTime: string;
                userName: string;
            }>(url, {
                userName: account,
                password,
            });

            if (response.errorCode !== 0) {
                logger.error('auth', 'Login failed', response);
                return false;
            }

            const tokenExpire = new Date(response.tokenExpireTime).getTime();
            if (!response.token || !Number.isFinite(tokenExpire) || tokenExpire <= Date.now()) {
                logger.error('auth', 'Login returned an invalid token or expiration');
                return false;
            }

            this.status = {
                isLogin: true,
                token: response.token,
                tokenExpire,
                userName: response.userName,
            };

            Storage.saveDanDanPlayStatus(this.status);
            logger.info('auth', `Logged in successfully as ${response.userName}`);

            return true;
        } catch (error) {
            logger.error('auth', 'Login failed', error);
            return false;
        }
    }

    /**
     * 检查 token 是否需要刷新，如需则自动刷新
     */
    async refreshIfNeeded(): Promise<void> {
        if (!this.status.isLogin) return;
        if (!this.status.token || !Number.isFinite(this.status.tokenExpire) || this.status.tokenExpire <= Date.now()) {
            this.logout();
            return;
        }

        const daysUntilExpire = (this.status.tokenExpire - Date.now()) / (24 * 60 * 60 * 1000);

        if (daysUntilExpire > 3) {
            // Token 还有 3 天以上有效期，不需要刷新
            return;
        }

        try {
            const url = `${this.apiPrefix}/api/v2/login/renew`;
            logger.debug('auth', 'Refreshing token');

            const response = await get<{
                errorCode: number;
                token: string;
                tokenExpireTime: string;
            }>(url, {
                headers: {
                    Authorization: `Bearer ${this.status.token}`,
                },
            });

            if (response.errorCode !== 0) {
                this.logout();
                return;
            }

            const tokenExpire = new Date(response.tokenExpireTime).getTime();
            if (!response.token || !Number.isFinite(tokenExpire) || tokenExpire <= Date.now()) {
                this.logout();
                return;
            }

            this.status.token = response.token;
            this.status.tokenExpire = tokenExpire;

            Storage.saveDanDanPlayStatus(this.status);
            logger.info('auth', 'Token refreshed successfully');
        } catch (error) {
            // 网络/代理暂时不可用：旧 token 仍在有效期内（上面已检查），保留登录态，下次启动再续期。
            // 与 ede.js 一致，只有服务端明确拒绝（errorCode != 0）才清除登录。
            logger.warn('auth', 'Token refresh failed, keeping current session', error);
        }
    }

    /**
     * 登出
     */
    logout(): void {
        this.status = {
            isLogin: false,
            token: '',
            tokenExpire: 0,
        };
        Storage.saveDanDanPlayStatus(this.status);
        logger.info('auth', 'Logged out');
    }
}
