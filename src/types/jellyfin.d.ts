interface JellyfinApiClient {
    getCurrentUserId(): string;
    deviceId(): string;
    _appVersion: string;
    getItem(userId: string, itemId: string): Promise<import('./index').JellyfinItem>;
    getSessions(options: { deviceId: string }): Promise<JellyfinSession[]>;
}

interface JellyfinSession {
    NowPlayingItem?: import('./index').JellyfinItem;
}

declare global {
    interface Window {
        ApiClient?: JellyfinApiClient;
    }
}

export {};
