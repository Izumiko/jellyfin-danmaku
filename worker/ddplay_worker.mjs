/**
 * dandanplay CORS proxy for Cloudflare Workers (ES Module)
 *
 * Features:
 * - Keeps AppId/AppSecret in Worker secrets.
 * - Compatible with the existing /cors/https://api.dandanplay.net/... URL form.
 * - Also supports direct /api/v2/... proxy paths.
 * - Explicit method/path allow-list to avoid turning the Worker into a generic signed proxy.
 * - L1 Cloudflare Cache API + optional L2 R2 persistent cache.
 * - R2 cache objects are gzip-compressed when worthwhile; existing plain objects remain readable.
 * - Caches comment/search/bangumi/related/extcomment and POST /match responses.
 * - Cache key includes the full normalized query string (so withRelated/chConvert are isolated).
 * - Per-client request limiting and stricter cache-miss/origin limiting.
 * - Durable Object daily + monthly origin quota protection across Cloudflare locations.
 * - Detects both HTTP 429 and dandanplay's HTTP-200 + { errorCode: 429 } responses.
 * - Serves stale R2 cache on upstream 429/5xx/network failure or local origin-quota rejection.
 * - Safely follows dandanplay CDN redirects without forwarding AppId/signature/Authorization.
 * - Preserves dandanplay login hash behavior with an in-file MD5 implementation.
 *
 * Expected bindings / secrets (all names are configurable only by renaming code):
 *   Secrets:
 *     APP_ID
 *     APP_SECRET
 *
 *   Optional R2 binding:
 *     DANMAKU_CACHE
 *
 *   Optional Workers Rate Limiting bindings:
 *     CLIENT_RATE_LIMITER   // e.g. 120 / 60s
 *     ORIGIN_RATE_LIMITER   // e.g. 20 / 60s; called only on true cache miss
 *
 *   Optional Durable Object binding:
 *     ORIGIN_QUOTA          // class: OriginQuotaLimiter
 *
 * Useful environment variables:
 *   CLIENT_RPM=120
 *   ORIGIN_RPM=20
 *   ORIGIN_HOURLY_LIMIT=60
 *   ORIGIN_DAILY_LIMIT_PER_IP=200
 *   GLOBAL_ORIGIN_DAILY_LIMIT=0       // 0 = disabled
 *   GLOBAL_ORIGIN_MONTHLY_LIMIT=0     // 0 = disabled
 *   GROUP_DAILY_LIMITS={}             // quota groups: search,bangumi,comment,send_comment,match
 *   GROUP_MONTHLY_LIMITS={}
 *   PROXY_TOKEN=                      // optional; if set, clients must send X-Proxy-Token
 *   ALLOWED_ORIGINS=*                 // CORS only; comma-separated browser origins
 *   UPSTREAM_TIMEOUT_MS=15000
 *   MAX_CACHEABLE_BYTES=12582912
 *   R2_GZIP_MIN_BYTES=1024          // gzip only when raw body is at least this large
 *   R2_GZIP_MIN_SAVINGS_BYTES=64   // keep gzip only when it saves at least this many bytes
 *   LOG_REQUESTS=0
 */

import { DurableObject } from 'cloudflare:workers';

const UPSTREAM_ORIGIN = 'https://api.dandanplay.net';
const UPSTREAM_HOST = 'api.dandanplay.net';
const CACHE_VERSION = 'v4';

const DEFAULTS = Object.freeze({
    CLIENT_RPM: 120,
    ORIGIN_RPM: 20,
    ORIGIN_HOURLY_LIMIT: 60,
    ORIGIN_DAILY_LIMIT_PER_IP: 200,
    GLOBAL_ORIGIN_DAILY_LIMIT: 0,
    GLOBAL_ORIGIN_MONTHLY_LIMIT: 0,
    UPSTREAM_TIMEOUT_MS: 15000,
    MAX_CACHEABLE_BYTES: 12 * 1024 * 1024,
    R2_GZIP_MIN_BYTES: 1024,
    R2_GZIP_MIN_SAVINGS_BYTES: 64,
});

// Cache TTLs. comment is replaced dynamically from bangumi.episodes[].airDate when known.
// Unknown comment age intentionally falls back to 3h so a brand-new episode is never cached
// for a whole day merely because its metadata has not reached this Worker instance yet.
// staleSeconds means "how long an expired object may still be served when revalidation is
// impossible"; it is deliberately much longer than the fresh TTL.
const CACHE_POLICIES = Object.freeze({
    comment:         { ttlSeconds: 3 * 3600,  staleSeconds: 90 * 86400 },
    search_episodes: { ttlSeconds: 7 * 86400, staleSeconds: 30 * 86400 },
    search_anime:    { ttlSeconds: 7 * 86400, staleSeconds: 30 * 86400 },
    bangumi:         { ttlSeconds: 3 * 86400, staleSeconds: 30 * 86400 },
    related:         { ttlSeconds: 24 * 3600, staleSeconds: 30 * 86400 },
    extcomment:      { ttlSeconds: 24 * 3600, staleSeconds: 30 * 86400 },
    match:           { ttlSeconds: 24 * 3600, staleSeconds: 14 * 86400 },
});

const COMMENT_DYNAMIC_TTLS = Object.freeze({
    sameDay: 3 * 3600,       // airDate is today
    oneToThreeDays: 24 * 3600, // airDate is 1-3 calendar days ago
    older: 3 * 86400,        // airDate is 4+ calendar days ago
    unknown: 3 * 3600,       // conservative fallback
    stale: 90 * 86400,
});

// dandanplay's documented bangumi detail response exposes episodes[].airDate.
// We index episodeId -> airDate into R2 whenever /bangumi/{id} is fetched successfully.
const EPISODE_META_PREFIX = `${CACHE_VERSION}/meta/episode-air-date/`;

const EMPTY_SEARCH_TTL_SECONDS = 30 * 60;
const EMPTY_COMMENT_TTL_SECONDS = 10 * 60;
const EMPTY_STALE_SECONDS = 6 * 3600;

// Per-isolate best-effort fallback counters. Native Rate Limiting bindings are preferred.
const memoryCounters = new Map();
const inFlightOrigins = new Map();
const memoryGlobalQuota = {
    day: '', month: '',
    dailyTotal: 0, monthlyTotal: 0,
    dailyGroups: Object.create(null), monthlyGroups: Object.create(null),
};
const episodeAirDateMemory = new Map();

export default {
    async fetch(request, env, ctx) {
        try {
            return await handleRequest(request, env, ctx);
        } catch (error) {
            console.error('Unhandled worker error:', error?.stack || error);
            return jsonResponse(
                request,
                env,
                { errorCode: 500, success: false, errorMessage: '代理服务器内部错误' },
                500,
                { 'X-Proxy-Error': 'internal' },
            );
        }
    },
};

/**
 * Optional Durable Object used for strict cross-PoP origin quotas.
 * It enforces both calendar-day and calendar-month counters. The Worker only calls it after
 * every cache layer has missed, immediately before an actual dandanplay request.
 */
export class OriginQuotaLimiter extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
    }

    async check(payload) {
        const day = String(payload?.day || utcDayKey());
        const month = String(payload?.month || utcMonthKey());
        const group = String(payload?.group || 'other');
        const globalDailyLimit = positiveInt(payload?.globalDailyLimit, 0);
        const globalMonthlyLimit = positiveInt(payload?.globalMonthlyLimit, 0);
        const groupDailyLimit = positiveInt(payload?.groupDailyLimit, 0);
        const groupMonthlyLimit = positiveInt(payload?.groupMonthlyLimit, 0);

        let state = await this.ctx.storage.get('quota');
        if (!state || typeof state !== 'object') {
            state = {
                day, month,
                dailyTotal: 0, monthlyTotal: 0,
                dailyGroups: {}, monthlyGroups: {},
            };
        }
        if (state.day !== day) {
            state.day = day;
            state.dailyTotal = 0;
            state.dailyGroups = {};
        }
        if (state.month !== month) {
            state.month = month;
            state.monthlyTotal = 0;
            state.monthlyGroups = {};
        }

        const dailyGroupCount = Number(state.dailyGroups?.[group] || 0);
        const monthlyGroupCount = Number(state.monthlyGroups?.[group] || 0);

        if (globalDailyLimit > 0 && state.dailyTotal >= globalDailyLimit) {
            return { allowed: false, reason: 'global_daily_limit' };
        }
        if (globalMonthlyLimit > 0 && state.monthlyTotal >= globalMonthlyLimit) {
            return { allowed: false, reason: 'global_monthly_limit' };
        }
        if (groupDailyLimit > 0 && dailyGroupCount >= groupDailyLimit) {
            return { allowed: false, reason: 'group_daily_limit', group, count: dailyGroupCount, limit: groupDailyLimit };
        }
        if (groupMonthlyLimit > 0 && monthlyGroupCount >= groupMonthlyLimit) {
            return { allowed: false, reason: 'group_monthly_limit', group, count: monthlyGroupCount, limit: groupMonthlyLimit };
        }

        state.dailyTotal += 1;
        state.monthlyTotal += 1;
        state.dailyGroups[group] = dailyGroupCount + 1;
        state.monthlyGroups[group] = monthlyGroupCount + 1;
        await this.ctx.storage.put('quota', state);

        return {
            allowed: true,
            reason: 'ok',
            day, month, group,
            dailyGroupCount: state.dailyGroups[group],
            monthlyGroupCount: state.monthlyGroups[group],
        };
    }
}

async function handleRequest(request, env, ctx) {
    if (request.method === 'OPTIONS') {
        return handleOptions(request, env);
    }

    const appId = String(env.APP_ID || env.DANDANPLAY_APP_ID || '').trim();
    const appSecret = String(env.APP_SECRET || env.DANDANPLAY_APP_SECRET || '').trim();
    if (!appId || !appSecret) {
        return jsonResponse(
            request,
            env,
            { errorCode: 500, success: false, errorMessage: 'Worker 未配置 APP_ID / APP_SECRET' },
            500,
        );
    }

    if (env.PROXY_TOKEN) {
        const supplied = request.headers.get('X-Proxy-Token') || '';
        if (supplied !== String(env.PROXY_TOKEN)) {
            return jsonResponse(
                request,
                env,
                { errorCode: 401, success: false, errorMessage: '代理访问令牌无效' },
                401,
            );
        }
    }

    let targetUrl;
    try {
        targetUrl = parseTargetUrl(request);
    } catch (error) {
        return jsonResponse(
            request,
            env,
            { errorCode: 400, success: false, errorMessage: error.message || '目标 URL 无效' },
            400,
        );
    }

    if (!isAllowedTarget(targetUrl)) {
        return jsonResponse(
            request,
            env,
            { errorCode: 403, success: false, errorMessage: '目标主机不允许访问' },
            403,
        );
    }

    const method = request.method.toUpperCase();
    const route = classifyRoute(method, targetUrl.pathname);
    if (!route.allowed) {
        return jsonResponse(
            request,
            env,
            { errorCode: 403, success: false, errorMessage: `接口未开放: ${method} ${targetUrl.pathname}` },
            403,
        );
    }

    const clientIP = getClientIP(request);
    const requestLimit = await checkClientRequestLimit(env, clientIP);
    if (!requestLimit.allowed) {
        console.warn(`Client rate limited: ip=${clientIP} path=${targetUrl.pathname}`);
        return localRateLimitResponse(request, env, '请求过于频繁，请稍后再试', requestLimit.retryAfter || 60, 'CLIENT');
    }

    let bodyText = null;
    if (method !== 'GET' && method !== 'HEAD') {
        bodyText = await request.text();
    }

    // dandanplay login needs appId/unixTimestamp/hash inserted into JSON body.
    if (method === 'POST' && targetUrl.pathname === '/api/v2/login') {
        const login = prepareLoginBody(bodyText, appId, appSecret);
        if (!login.ok) {
            return jsonResponse(
                request,
                env,
                { errorCode: 400, success: false, errorMessage: login.error },
                400,
            );
        }
        bodyText = login.bodyText;
    }

    const cachePlan = await buildCachePlan(request, env, targetUrl, route.group, bodyText);
    let staleCandidate = null;

    if (cachePlan) {
        const edgeHit = await readEdgeCache(request, cachePlan);
        if (edgeHit) {
            logRequest(env, `cache HIT-EDGE ip=${clientIP} group=${route.group} path=${targetUrl.pathname}`);
            return cachedResponse(request, env, edgeHit.body, edgeHit.ageSeconds, 'HIT-EDGE');
        }

        const r2Hit = await readR2Cache(env, ctx, cachePlan);
        if (r2Hit?.fresh) {
            logRequest(env, `cache HIT-R2 ip=${clientIP} group=${route.group} path=${targetUrl.pathname}`);
            ctx.waitUntil(writeEdgeCache(request, cachePlan, r2Hit.body, r2Hit.ttlRemainingSeconds).catch(() => {}));
            return cachedResponse(request, env, r2Hit.body, r2Hit.ageSeconds, 'HIT-R2');
        }
        if (r2Hit?.staleUsable) {
            staleCandidate = r2Hit;
        }
    }

    // Requests for the same cache key in the same isolate share one origin fetch.
    // A follower does not consume another origin quota slot.
    const flightKey = cachePlan?.cacheId || null;
    if (flightKey && inFlightOrigins.has(flightKey)) {
        const shared = await inFlightOrigins.get(flightKey);
        return finalizeOriginResult(request, env, shared, staleCandidate, targetUrl, route.group);
    }

    const originWork = (async () => {
        const quota = await checkOriginLimits(env, clientIP, route.group);
        if (!quota.allowed) {
            return { kind: 'quota', quota };
        }

        let upstream;
        try {
            upstream = await fetchDandanplay(request, targetUrl, bodyText, appId, appSecret, env);
        } catch (error) {
            return { kind: 'network_error', error };
        }

        const body = await upstream.response.text();
        const result = {
            kind: 'upstream',
            status: upstream.response.status,
            statusText: upstream.response.statusText,
            body,
            headers: pickUpstreamResponseHeaders(upstream.response.headers),
            limited: isUpstreamLimited(upstream.response.status, body),
        };

        if (isCacheableSuccessfulResponse(upstream.response.status, body)) {
            // /bangumi/{id} contains episodes[].airDate. Persist that immutable mapping so
            // future /comment/{episodeId} requests can choose 3h / 24h / 3d automatically.
            if (route.group === 'bangumi') {
                ctx.waitUntil(indexEpisodeAirDatesFromBangumi(env, body).catch((error) => {
                    console.warn('Episode airDate indexing failed:', error?.message || error);
                }));
            }
        }

        if (cachePlan && isCacheableSuccessfulResponse(upstream.response.status, body)) {
            const adjusted = adjustPolicyForBody(cachePlan.policy, route.group, body);
            const effectivePlan = { ...cachePlan, policy: adjusted };

            // Write L1 synchronously so the next request in this PoP can hit immediately.
            try {
                await writeEdgeCache(request, effectivePlan, body, adjusted.ttlSeconds);
            } catch (error) {
                console.warn('Edge cache put failed:', error?.message || error);
            }

            // R2 is persistent/global; do it in the background.
            if (env.DANMAKU_CACHE) {
                ctx.waitUntil(writeR2Cache(env, effectivePlan, body).catch((error) => {
                    console.warn('R2 cache put failed:', error?.message || error);
                }));
            }
        }

        return result;
    })();

    if (flightKey) {
        inFlightOrigins.set(flightKey, originWork);
        originWork.then(
            () => inFlightOrigins.delete(flightKey),
            () => inFlightOrigins.delete(flightKey),
        );
    }

    const result = await originWork;
    return finalizeOriginResult(request, env, result, staleCandidate, targetUrl, route.group);
}

function finalizeOriginResult(request, env, result, staleCandidate, targetUrl, group) {
    if (result.kind === 'quota') {
        if (staleCandidate) {
            return cachedResponse(request, env, staleCandidate.body, staleCandidate.ageSeconds, 'STALE-QUOTA', {
                'Warning': '110 - "Response is stale"',
            });
        }

        const retryAfter = result.quota.retryAfter || 60;
        const monthly = result.quota.reason === 'global_monthly_limit' || result.quota.reason === 'group_monthly_limit';
        const daily = result.quota.reason === 'global_daily_limit' || result.quota.reason === 'group_daily_limit';
        const message = monthly
            ? '代理本月回源配额已达到保护上限'
            : daily
                ? '代理今日回源配额已达到保护上限'
                : '该来源回源请求过于频繁';
        return localRateLimitResponse(request, env, message, retryAfter, 'ORIGIN');
    }

    if (result.kind === 'network_error') {
        console.warn(`Upstream network error: path=${targetUrl.pathname}`, result.error?.message || result.error);
        if (staleCandidate) {
            return cachedResponse(request, env, staleCandidate.body, staleCandidate.ageSeconds, 'STALE-ERROR', {
                'Warning': '111 - "Revalidation failed"',
            });
        }
        return jsonResponse(
            request,
            env,
            { errorCode: 502, success: false, errorMessage: '弹弹play 上游请求失败' },
            502,
            { 'X-Cache': 'MISS-ERROR' },
        );
    }

    if (result.kind === 'upstream') {
        const canUseStale = result.limited || result.status >= 500;
        if (canUseStale && staleCandidate) {
            return cachedResponse(request, env, staleCandidate.body, staleCandidate.ageSeconds, result.limited ? 'STALE-429' : 'STALE-5XX', {
                'Warning': '111 - "Revalidation failed"',
                ...(result.headers['retry-after'] ? { 'Retry-After': result.headers['retry-after'] } : {}),
            });
        }

        const headers = new Headers();
        headers.set('Content-Type', result.headers['content-type'] || 'application/json; charset=utf-8');
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Cache', 'MISS');
        if (result.limited) headers.set('X-Upstream-Limited', '1');
        if (result.headers['retry-after']) headers.set('Retry-After', result.headers['retry-after']);
        applyCorsHeaders(headers, request, env);

        logRequest(env, `upstream status=${result.status} limited=${result.limited ? 1 : 0} group=${group} path=${targetUrl.pathname}`);
        return new Response(request.method === 'HEAD' ? null : result.body, {
            // Keep dandanplay's status for API compatibility. A logical errorCode=429 may still be HTTP 200.
            status: result.status,
            statusText: result.statusText,
            headers,
        });
    }

    return jsonResponse(
        request,
        env,
        { errorCode: 500, success: false, errorMessage: '未知代理状态' },
        500,
    );
}

function parseTargetUrl(request) {
    const incoming = new URL(request.url);
    let raw;

    if (incoming.pathname.startsWith('/cors/')) {
        // Keep the query string as part of the target URL. This is compatible with the old Worker URL format:
        // /cors/https://api.dandanplay.net/api/v2/search/episodes?anime=...
        raw = incoming.href.slice(incoming.origin.length + '/cors/'.length).trim();
        if (raw.startsWith('https:/') && !raw.startsWith('https://')) {
            raw = raw.replace(/^https:\/(?!\/)/, 'https://');
        }
    } else if (incoming.pathname.startsWith('/api/v2/')) {
        raw = `${UPSTREAM_ORIGIN}${incoming.pathname}${incoming.search}`;
    } else {
        throw new Error('仅支持 /cors/https://api.dandanplay.net/... 或 /api/v2/...');
    }

    const target = new URL(raw);
    target.hash = '';
    return target;
}

function isAllowedTarget(url) {
    return url.protocol === 'https:'
        && url.hostname === UPSTREAM_HOST
        && (!url.port || url.port === '443')
        && !url.username
        && !url.password;
}

function classifyRoute(method, pathname) {
    const readMethod = method === 'GET' || method === 'HEAD';

    if (readMethod && pathname === '/api/v2/search/episodes') return { allowed: true, group: 'search_episodes' };
    if (readMethod && pathname === '/api/v2/search/anime') return { allowed: true, group: 'search_anime' };
    if (readMethod && pathname.startsWith('/api/v2/bangumi/')) return { allowed: true, group: 'bangumi' };
    if (readMethod && /^\/api\/v2\/comment\/[^/]+$/.test(pathname)) return { allowed: true, group: 'comment' };
    if (readMethod && /^\/api\/v2\/related\/[^/]+$/.test(pathname)) return { allowed: true, group: 'related' };
    if (readMethod && pathname === '/api/v2/extcomment') return { allowed: true, group: 'extcomment' };
    if (readMethod && pathname === '/api/v2/login/renew') return { allowed: true, group: 'auth' };
    if (readMethod && pathname === '/api/v2/version') return { allowed: true, group: 'other' };

    if (method === 'POST' && pathname === '/api/v2/login') return { allowed: true, group: 'auth' };
    if (method === 'POST' && pathname === '/api/v2/match') return { allowed: true, group: 'match' };
    if (method === 'POST' && /^\/api\/v2\/comment\/[^/]+$/.test(pathname)) return { allowed: true, group: 'comment_write' };
    if (method === 'POST' && /^\/api\/v2\/related\/[^/]+$/.test(pathname)) return { allowed: true, group: 'related_write' };

    return { allowed: false, group: 'other' };
}

async function buildCachePlan(request, env, targetUrl, group, bodyText) {
    let policy = CACHE_POLICIES[group];
    if (!policy) return null;

    const method = request.method.toUpperCase();
    if (group === 'comment' && method === 'GET') {
        const episodeId = extractEpisodeId(targetUrl.pathname);
        policy = await resolveCommentCachePolicy(env, episodeId);
    }
    if (method === 'HEAD') return null;
    if (method !== 'GET' && !(method === 'POST' && group === 'match')) return null;

    const canonicalUrl = canonicalizeUrl(targetUrl);
    let identity = `${CACHE_VERSION}\n${method}\n${canonicalUrl}`;
    if (method === 'POST') {
        identity += `\n${await sha256Hex(normalizeJsonText(bodyText || ''))}`;
    }

    const digest = await sha256Hex(identity);
    const cacheId = `${CACHE_VERSION}:${group}:${digest}`;
    const r2Key = `${CACHE_VERSION}/${group}/${digest}.json`;
    const edgeUrl = new URL(request.url);
    edgeUrl.pathname = `/_ddplay_cache/${encodeURIComponent(group)}/${digest}`;
    edgeUrl.search = '';
    edgeUrl.hash = '';

    return {
        group,
        cacheId,
        r2Key,
        edgeRequest: new Request(edgeUrl.toString(), { method: 'GET' }),
        policy: { ...policy },
    };
}

function extractEpisodeId(pathname) {
    const match = String(pathname || '').match(/^\/api\/v2\/comment\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : '';
}

async function resolveCommentCachePolicy(env, episodeId) {
    if (!episodeId) {
        return { ttlSeconds: COMMENT_DYNAMIC_TTLS.unknown, staleSeconds: COMMENT_DYNAMIC_TTLS.stale };
    }
    const airDate = await getEpisodeAirDate(env, episodeId);
    const dayAge = calendarDayAge(airDate);
    let ttlSeconds = COMMENT_DYNAMIC_TTLS.unknown;
    if (dayAge !== null) {
        if (dayAge <= 0) ttlSeconds = COMMENT_DYNAMIC_TTLS.sameDay;
        else if (dayAge <= 3) ttlSeconds = COMMENT_DYNAMIC_TTLS.oneToThreeDays;
        else ttlSeconds = COMMENT_DYNAMIC_TTLS.older;
    }
    return { ttlSeconds, staleSeconds: COMMENT_DYNAMIC_TTLS.stale };
}

function calendarDayAge(airDate) {
    if (!airDate) return null;
    const match = String(airDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const airDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (!Number.isFinite(airDay)) return null;
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.floor((today - airDay) / 86400_000);
}

async function getEpisodeAirDate(env, episodeId) {
    const key = String(episodeId);
    if (episodeAirDateMemory.has(key)) return episodeAirDateMemory.get(key);
    if (!env.DANMAKU_CACHE) return null;
    try {
        const obj = await env.DANMAKU_CACHE.get(`${EPISODE_META_PREFIX}${encodeURIComponent(key)}.json`);
        if (!obj) return null;
        const data = await obj.json();
        const airDate = typeof data?.airDate === 'string' ? data.airDate : null;
        if (airDate) {
            episodeAirDateMemory.set(key, airDate);
            trimEpisodeAirDateMemory();
        }
        return airDate;
    } catch (error) {
        console.warn('Episode airDate metadata read failed:', error?.message || error);
        return null;
    }
}

async function indexEpisodeAirDatesFromBangumi(env, body) {
    let parsed;
    try { parsed = JSON.parse(body); } catch { return; }
    const episodes = parsed?.bangumi?.episodes;
    if (!Array.isArray(episodes) || episodes.length === 0) return;

    const writes = [];
    for (const episode of episodes) {
        const episodeId = episode?.episodeId;
        const airDate = typeof episode?.airDate === 'string' ? episode.airDate : '';
        if (episodeId === undefined || episodeId === null || !airDate) continue;
        const key = String(episodeId);
        episodeAirDateMemory.set(key, airDate);
        if (env.DANMAKU_CACHE) {
            const payload = JSON.stringify({ episodeId: key, airDate });
            writes.push(env.DANMAKU_CACHE.put(
                `${EPISODE_META_PREFIX}${encodeURIComponent(key)}.json`,
                payload,
                {
                    httpMetadata: { contentType: 'application/json; charset=utf-8' },
                    customMetadata: { version: CACHE_VERSION, type: 'episode-air-date' },
                },
            ));
        }
    }
    trimEpisodeAirDateMemory();
    if (writes.length) await Promise.allSettled(writes);
}

function trimEpisodeAirDateMemory() {
    const max = 20_000;
    if (episodeAirDateMemory.size <= max) return;
    const remove = episodeAirDateMemory.size - 15_000;
    let i = 0;
    for (const key of episodeAirDateMemory.keys()) {
        episodeAirDateMemory.delete(key);
        if (++i >= remove) break;
    }
}

function canonicalizeUrl(input) {
    const url = new URL(input.toString());
    const entries = [...url.searchParams.entries()].sort((a, b) => {
        const byKey = a[0].localeCompare(b[0]);
        return byKey || a[1].localeCompare(b[1]);
    });
    url.search = '';
    for (const [key, value] of entries) url.searchParams.append(key, value);
    url.hash = '';
    return url.toString();
}

function normalizeJsonText(text) {
    if (!text) return '';
    try {
        return stableStringify(JSON.parse(text));
    } catch {
        return text;
    }
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

async function readEdgeCache(request, plan) {
    try {
        const cache = caches.default;
        const response = await cache.match(plan.edgeRequest);
        if (!response) return null;
        const body = await response.text();
        const storedAt = Number(response.headers.get('X-DDP-Stored-At') || Date.now());
        const ageSeconds = Math.max(0, Math.floor((Date.now() - storedAt) / 1000));
        return { body, ageSeconds };
    } catch (error) {
        console.warn('Edge cache read failed:', error?.message || error);
        return null;
    }
}

async function writeEdgeCache(request, plan, body, ttlSeconds) {
    if (!body || ttlSeconds <= 0) return;
    const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${Math.max(1, Math.floor(ttlSeconds))}`,
        'X-DDP-Stored-At': String(Date.now()),
    });
    await caches.default.put(plan.edgeRequest, new Response(body, { status: 200, headers }));
}

async function readR2Cache(env, ctx, plan) {
    if (!env.DANMAKU_CACHE) return null;

    try {
        const obj = await env.DANMAKU_CACHE.get(plan.r2Key);
        if (!obj || !obj.body) return null;

        const meta = obj.customMetadata || {};
        const storedAt = Number(meta.storedAt || obj.uploaded?.getTime?.() || 0);
        const ttlSeconds = positiveInt(meta.ttlSeconds, plan.policy.ttlSeconds);
        const staleSeconds = positiveInt(meta.staleSeconds, plan.policy.staleSeconds);
        const ageSeconds = Math.max(0, Math.floor((Date.now() - storedAt) / 1000));

        if (ageSeconds > staleSeconds) {
            ctx.waitUntil(env.DANMAKU_CACHE.delete(plan.r2Key).catch(() => {}));
            return null;
        }

        // Backward compatible:
        // - old objects: no encoding metadata -> read as plain UTF-8 JSON
        // - new objects: customMetadata.encoding=gzip (and httpMetadata.contentEncoding=gzip)
        //   -> transparently decompress before returning JSON to the caller/Edge Cache.
        const body = await readR2TextObject(obj);
        return {
            body,
            ageSeconds,
            fresh: ageSeconds <= ttlSeconds,
            staleUsable: ageSeconds > ttlSeconds && ageSeconds <= staleSeconds,
            ttlRemainingSeconds: Math.max(1, ttlSeconds - ageSeconds),
        };
    } catch (error) {
        console.warn('R2 cache read failed:', error?.message || error);
        return null;
    }
}

async function readR2TextObject(obj) {
    const meta = obj.customMetadata || {};
    const encoding = String(meta.encoding || obj.httpMetadata?.contentEncoding || '').toLowerCase();

    if (encoding !== 'gzip') {
        return await obj.text();
    }

    if (typeof DecompressionStream !== 'function') {
        throw new Error('gzip cached object found but DecompressionStream is unavailable');
    }

    const decompressed = obj.body.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(decompressed).text();
}

async function gzipUtf8(text) {
    if (typeof CompressionStream !== 'function') return null;

    const rawBytes = new TextEncoder().encode(text);
    const source = new Blob([rawBytes]).stream();
    const compressedStream = source.pipeThrough(new CompressionStream('gzip'));
    const compressed = await new Response(compressedStream).arrayBuffer();

    return {
        rawBytes: rawBytes.byteLength,
        compressedBytes: compressed.byteLength,
        body: compressed,
    };
}

async function writeR2Cache(env, plan, body) {
    if (!env.DANMAKU_CACHE || !body) return;

    const maxBytes = envNumber(env.MAX_CACHEABLE_BYTES, DEFAULTS.MAX_CACHEABLE_BYTES);
    const rawBytes = new TextEncoder().encode(body).byteLength;
    if (rawBytes > maxBytes) {
        console.warn(`Skip R2 cache: body too large (${rawBytes} bytes)`);
        return;
    }

    const gzipMinBytes = envNumber(env.R2_GZIP_MIN_BYTES, DEFAULTS.R2_GZIP_MIN_BYTES);
    const minSavings = envNumber(env.R2_GZIP_MIN_SAVINGS_BYTES, DEFAULTS.R2_GZIP_MIN_SAVINGS_BYTES);

    let storedBody = body;
    let encoding = 'identity';
    let storedBytes = rawBytes;

    if (rawBytes >= gzipMinBytes) {
        try {
            const gz = await gzipUtf8(body);
            if (gz && gz.compressedBytes + Math.max(0, minSavings) < gz.rawBytes) {
                storedBody = gz.body;
                encoding = 'gzip';
                storedBytes = gz.compressedBytes;
            }
        } catch (error) {
            // Compression is an optimization only. A failure must never make the proxy fail.
            console.warn('R2 gzip compression failed; storing plain JSON:', error?.message || error);
        }
    }

    const httpMetadata = { contentType: 'application/json; charset=utf-8' };
    if (encoding === 'gzip') {
        httpMetadata.contentEncoding = 'gzip';
    }

    await env.DANMAKU_CACHE.put(plan.r2Key, storedBody, {
        httpMetadata,
        customMetadata: {
            storedAt: String(Date.now()),
            ttlSeconds: String(plan.policy.ttlSeconds),
            staleSeconds: String(plan.policy.staleSeconds),
            version: CACHE_VERSION,
            group: plan.group,
            encoding,
            originalBytes: String(rawBytes),
            storedBytes: String(storedBytes),
        },
    });
}
function adjustPolicyForBody(policy, group, body) {
    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch {
        return { ...policy };
    }

    if ((group === 'search_episodes' || group === 'search_anime') && Array.isArray(parsed?.animes) && parsed.animes.length === 0) {
        return { ttlSeconds: EMPTY_SEARCH_TTL_SECONDS, staleSeconds: EMPTY_STALE_SECONDS };
    }
    if ((group === 'comment' || group === 'extcomment') && Array.isArray(parsed?.comments) && parsed.comments.length === 0) {
        return { ttlSeconds: EMPTY_COMMENT_TTL_SECONDS, staleSeconds: EMPTY_STALE_SECONDS };
    }
    return { ...policy };
}

function isCacheableSuccessfulResponse(status, body) {
    if (status !== 200 || !body) return false;
    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch {
        return false;
    }
    if (!parsed || typeof parsed !== 'object') return false;
    if (parsed.success === false) return false;
    if (typeof parsed.errorCode === 'number' && parsed.errorCode !== 0) return false;
    return true;
}

async function fetchDandanplay(request, targetUrl, bodyText, appId, appSecret, env) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await generateSignature(appId, timestamp, targetUrl.pathname, appSecret);
    const headers = buildUpstreamHeaders(request, appId, signature, timestamp);
    const method = request.method.toUpperCase();

    const init = {
        method,
        headers,
        redirect: 'manual',
    };
    if (method !== 'GET' && method !== 'HEAD') {
        init.body = bodyText ?? '';
    }

    let response = await fetchWithTimeout(targetUrl.toString(), init, envNumber(env.UPSTREAM_TIMEOUT_MS, DEFAULTS.UPSTREAM_TIMEOUT_MS));
    let currentUrl = targetUrl;

    // Comment downloads commonly redirect to cas.dandanplay.net. Follow manually so application
    // credentials and user Authorization are never forwarded to the redirected host.
    for (let i = 0; i < 3 && isRedirect(response.status); i += 1) {
        const location = response.headers.get('Location');
        if (!location) break;
        if (method !== 'GET' && method !== 'HEAD') break;

        const nextUrl = new URL(location, currentUrl);
        if (!isSafeDandanplayRedirect(nextUrl)) {
            throw new Error(`Unsafe upstream redirect blocked: ${nextUrl.hostname}`);
        }

        const redirectHeaders = new Headers();
        const accept = request.headers.get('Accept');
        const acceptLanguage = request.headers.get('Accept-Language');
        if (accept) redirectHeaders.set('Accept', accept);
        if (acceptLanguage) redirectHeaders.set('Accept-Language', acceptLanguage);
        redirectHeaders.set('User-Agent', 'jellyfin-danmaku-cf-worker/1.0');

        response = await fetchWithTimeout(nextUrl.toString(), {
            method,
            headers: redirectHeaders,
            redirect: 'manual',
        }, envNumber(env.UPSTREAM_TIMEOUT_MS, DEFAULTS.UPSTREAM_TIMEOUT_MS));
        currentUrl = nextUrl;
    }

    return { response, finalUrl: currentUrl };
}

function buildUpstreamHeaders(request, appId, signature, timestamp) {
    const headers = new Headers();

    // Explicit allow-list: do not forward CF/X-Forwarded/Host/Origin/Referer or client-supplied X-App* headers.
    for (const name of ['Accept', 'Accept-Language', 'Content-Type', 'Authorization']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
    }
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (!headers.has('Content-Type') && request.method !== 'GET' && request.method !== 'HEAD') {
        headers.set('Content-Type', 'application/json; charset=utf-8');
    }

    headers.set('User-Agent', 'jellyfin-danmaku-cf-worker/1.0');
    headers.set('X-AppId', appId);
    headers.set('X-Signature', signature);
    headers.set('X-Timestamp', String(timestamp));
    headers.set('X-Auth', '1');
    return headers;
}

async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('upstream timeout'), Math.max(1000, timeoutMs));
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function isSafeDandanplayRedirect(url) {
    return url.protocol === 'https:'
        && (!url.port || url.port === '443')
        && (url.hostname === 'dandanplay.net' || url.hostname.endsWith('.dandanplay.net'));
}

function isRedirect(status) {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function checkClientRequestLimit(env, clientIP) {
    const rpm = envNumber(env.CLIENT_RPM, DEFAULTS.CLIENT_RPM);
    if (rpm <= 0) return { allowed: true };

    if (env.CLIENT_RATE_LIMITER?.limit) {
        try {
            const result = await env.CLIENT_RATE_LIMITER.limit({ key: clientIP });
            return result.success ? { allowed: true } : { allowed: false, retryAfter: 60 };
        } catch (error) {
            console.warn('CLIENT_RATE_LIMITER failed; using in-memory fallback:', error?.message || error);
        }
    }

    return fixedWindowMemoryLimit(`client:${clientIP}`, rpm, 60_000, 60);
}

async function checkOriginLimits(env, clientIP, group) {
    const rpm = envNumber(env.ORIGIN_RPM, DEFAULTS.ORIGIN_RPM);
    if (rpm > 0) {
        if (env.ORIGIN_RATE_LIMITER?.limit) {
            try {
                const result = await env.ORIGIN_RATE_LIMITER.limit({ key: clientIP });
                if (!result.success) return { allowed: false, reason: 'origin_rpm', retryAfter: 60 };
            } catch (error) {
                console.warn('ORIGIN_RATE_LIMITER failed; using in-memory fallback:', error?.message || error);
                const fallback = fixedWindowMemoryLimit(`origin-rpm:${clientIP}`, rpm, 60_000, 60);
                if (!fallback.allowed) return { ...fallback, reason: 'origin_rpm' };
            }
        } else {
            const fallback = fixedWindowMemoryLimit(`origin-rpm:${clientIP}`, rpm, 60_000, 60);
            if (!fallback.allowed) return { ...fallback, reason: 'origin_rpm' };
        }
    }

    const hourly = envNumber(env.ORIGIN_HOURLY_LIMIT, DEFAULTS.ORIGIN_HOURLY_LIMIT);
    if (hourly > 0) {
        const result = fixedWindowMemoryLimit(`origin-hour:${clientIP}`, hourly, 3600_000, 3600);
        if (!result.allowed) return { ...result, reason: 'origin_hourly' };
    }

    const dailyPerIp = envNumber(env.ORIGIN_DAILY_LIMIT_PER_IP, DEFAULTS.ORIGIN_DAILY_LIMIT_PER_IP);
    if (dailyPerIp > 0) {
        const result = calendarDayMemoryLimit(`origin-day:${clientIP}`, dailyPerIp);
        if (!result.allowed) return { ...result, reason: 'origin_daily_per_ip' };
    }

    const strict = await checkGlobalOriginQuota(env, group);
    if (!strict.allowed) return strict;

    return { allowed: true };
}

async function checkGlobalOriginQuota(env, routeGroup) {
    const quotaGroup = quotaGroupForRoute(routeGroup);
    if (!quotaGroup) return { allowed: true };

    const globalDailyLimit = envNumber(env.GLOBAL_ORIGIN_DAILY_LIMIT, DEFAULTS.GLOBAL_ORIGIN_DAILY_LIMIT);
    const globalMonthlyLimit = envNumber(env.GLOBAL_ORIGIN_MONTHLY_LIMIT, DEFAULTS.GLOBAL_ORIGIN_MONTHLY_LIMIT);
    const dailyLimits = parseJsonObject(env.GROUP_DAILY_LIMITS);
    const monthlyLimits = parseJsonObject(env.GROUP_MONTHLY_LIMITS);
    const groupDailyLimit = positiveInt(dailyLimits[quotaGroup], 0);
    const groupMonthlyLimit = positiveInt(monthlyLimits[quotaGroup], 0);

    if (globalDailyLimit <= 0 && globalMonthlyLimit <= 0 && groupDailyLimit <= 0 && groupMonthlyLimit <= 0) {
        return { allowed: true };
    }

    const payload = {
        day: utcDayKey(),
        month: utcMonthKey(),
        group: quotaGroup,
        globalDailyLimit,
        globalMonthlyLimit,
        groupDailyLimit,
        groupMonthlyLimit,
    };

    if (env.ORIGIN_QUOTA?.idFromName) {
        try {
            const id = env.ORIGIN_QUOTA.idFromName('global');
            const stub = env.ORIGIN_QUOTA.get(id);
            const data = await stub.check(payload);
            if (data.allowed) return { allowed: true };
            const monthly = data.reason === 'global_monthly_limit' || data.reason === 'group_monthly_limit';
            return {
                allowed: false,
                reason: data.reason || 'group_daily_limit',
                retryAfter: monthly ? secondsUntilNextUtcMonth() : secondsUntilUtcMidnight(),
            };
        } catch (error) {
            // Fail open rather than taking the whole proxy offline; per-IP/native limits still apply.
            console.error('ORIGIN_QUOTA Durable Object failed; using in-memory fallback:', error?.message || error);
        }
    }

    // Best-effort fallback without a DO binding. This is only per isolate, not globally strict.
    const day = utcDayKey();
    const month = utcMonthKey();
    if (memoryGlobalQuota.day !== day) {
        memoryGlobalQuota.day = day;
        memoryGlobalQuota.dailyTotal = 0;
        memoryGlobalQuota.dailyGroups = Object.create(null);
    }
    if (memoryGlobalQuota.month !== month) {
        memoryGlobalQuota.month = month;
        memoryGlobalQuota.monthlyTotal = 0;
        memoryGlobalQuota.monthlyGroups = Object.create(null);
    }

    const dailyGroupCount = Number(memoryGlobalQuota.dailyGroups[quotaGroup] || 0);
    const monthlyGroupCount = Number(memoryGlobalQuota.monthlyGroups[quotaGroup] || 0);
    if (globalDailyLimit > 0 && memoryGlobalQuota.dailyTotal >= globalDailyLimit) {
        return { allowed: false, reason: 'global_daily_limit', retryAfter: secondsUntilUtcMidnight() };
    }
    if (globalMonthlyLimit > 0 && memoryGlobalQuota.monthlyTotal >= globalMonthlyLimit) {
        return { allowed: false, reason: 'global_monthly_limit', retryAfter: secondsUntilNextUtcMonth() };
    }
    if (groupDailyLimit > 0 && dailyGroupCount >= groupDailyLimit) {
        return { allowed: false, reason: 'group_daily_limit', retryAfter: secondsUntilUtcMidnight() };
    }
    if (groupMonthlyLimit > 0 && monthlyGroupCount >= groupMonthlyLimit) {
        return { allowed: false, reason: 'group_monthly_limit', retryAfter: secondsUntilNextUtcMonth() };
    }

    memoryGlobalQuota.dailyTotal += 1;
    memoryGlobalQuota.monthlyTotal += 1;
    memoryGlobalQuota.dailyGroups[quotaGroup] = dailyGroupCount + 1;
    memoryGlobalQuota.monthlyGroups[quotaGroup] = monthlyGroupCount + 1;
    return { allowed: true };
}

function quotaGroupForRoute(routeGroup) {
    switch (routeGroup) {
        case 'search_episodes':
        case 'search_anime':
            return 'search';
        case 'bangumi':
            return 'bangumi';
        case 'comment':
        case 'related':
        case 'extcomment':
            return 'comment';
        case 'comment_write':
        case 'related_write':
            return 'send_comment';
        case 'match':
            return 'match';
        // Login/token/version are intentionally not charged against the five documented
        // functional quotas unless you add a mapping here later.
        default:
            return null;
    }
}

function fixedWindowMemoryLimit(key, limit, windowMs, retryAfterSeconds) {
    const now = Date.now();
    let state = memoryCounters.get(key);
    if (!state || now - state.startedAt >= windowMs) {
        state = { startedAt: now, count: 0, lastSeen: now };
        memoryCounters.set(key, state);
    }
    state.lastSeen = now;

    if (state.count >= limit) {
        const remainingMs = Math.max(1000, windowMs - (now - state.startedAt));
        return { allowed: false, retryAfter: Math.max(1, Math.ceil(remainingMs / 1000)) };
    }
    state.count += 1;

    // Opportunistic cleanup to keep a long-lived isolate bounded.
    if (memoryCounters.size > 20_000 && Math.random() < 0.01) {
        const cutoff = now - 2 * 86400_000;
        for (const [k, v] of memoryCounters) {
            if (v.lastSeen < cutoff) memoryCounters.delete(k);
            if (memoryCounters.size <= 15_000) break;
        }
    }

    return { allowed: true, retryAfter: retryAfterSeconds };
}

function calendarDayMemoryLimit(key, limit) {
    const day = utcDayKey();
    const fullKey = `${key}:${day}`;
    const now = Date.now();
    let state = memoryCounters.get(fullKey);
    if (!state) {
        state = { startedAt: now, count: 0, lastSeen: now };
        memoryCounters.set(fullKey, state);
    }
    state.lastSeen = now;
    if (state.count >= limit) {
        return { allowed: false, retryAfter: secondsUntilUtcMidnight() };
    }
    state.count += 1;
    return { allowed: true };
}

function getClientIP(request) {
    return request.headers.get('CF-Connecting-IP') || 'local';
}

function prepareLoginBody(bodyText, appId, appSecret) {
    let body;
    try {
        body = JSON.parse(bodyText || '{}');
    } catch {
        return { ok: false, error: '登录请求必须是合法 JSON' };
    }

    const userName = String(body.userName || '');
    const password = String(body.password || '');
    if (!userName || !password) {
        return { ok: false, error: '用户名或密码不能为空' };
    }

    const unixTimestamp = Math.floor(Date.now() / 1000);
    const hashInput = `${appId}${password}${unixTimestamp}${userName}${appSecret}`;
    body.appId = appId;
    body.unixTimestamp = unixTimestamp;
    body.hash = md5Hex(hashInput);
    return { ok: true, bodyText: JSON.stringify(body) };
}

async function generateSignature(appId, timestamp, path, appSecret) {
    const input = new TextEncoder().encode(`${appId}${timestamp}${path}${appSecret}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
    let binary = '';
    for (const byte of hash) binary += String.fromCharCode(byte);
    return btoa(binary);
}

async function sha256Hex(text) {
    const input = new TextEncoder().encode(text);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
    return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Small UTF-8 MD5 implementation for /api/v2/login.
// Web Crypto intentionally does not provide MD5, while dandanplay's legacy login scheme requires it.
function md5Hex(text) {
    const input = new TextEncoder().encode(text);
    const originalLength = input.length;
    const paddedLength = (((originalLength + 8) >>> 6) + 1) * 64;
    const bytes = new Uint8Array(paddedLength);
    bytes.set(input);
    bytes[originalLength] = 0x80;

    const bitLength = BigInt(originalLength) * 8n;
    for (let i = 0; i < 8; i += 1) {
        bytes[paddedLength - 8 + i] = Number((bitLength >> BigInt(8 * i)) & 0xffn);
    }

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    const s = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

    for (let offset = 0; offset < bytes.length; offset += 64) {
        const m = new Uint32Array(16);
        for (let i = 0; i < 16; i += 1) {
            const p = offset + i * 4;
            m[i] = (bytes[p]
                | (bytes[p + 1] << 8)
                | (bytes[p + 2] << 16)
                | (bytes[p + 3] << 24)) >>> 0;
        }

        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;

        for (let i = 0; i < 64; i += 1) {
            let f;
            let g;
            if (i < 16) {
                f = ((b & c) | (~b & d)) >>> 0;
                g = i;
            } else if (i < 32) {
                f = ((d & b) | (~d & c)) >>> 0;
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                f = (b ^ c ^ d) >>> 0;
                g = (3 * i + 5) % 16;
            } else {
                f = (c ^ (b | ~d)) >>> 0;
                g = (7 * i) % 16;
            }

            const temp = d;
            d = c;
            c = b;
            const sum = (a + f + k[i] + m[g]) >>> 0;
            b = (b + leftRotate(sum, s[i])) >>> 0;
            a = temp;
        }

        a0 = (a0 + a) >>> 0;
        b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0;
        d0 = (d0 + d) >>> 0;
    }

    return [a0, b0, c0, d0].map(uint32ToLittleEndianHex).join('');
}

function leftRotate(value, count) {
    return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function uint32ToLittleEndianHex(value) {
    let out = '';
    for (let i = 0; i < 4; i += 1) {
        out += ((value >>> (8 * i)) & 0xff).toString(16).padStart(2, '0');
    }
    return out;
}

function isUpstreamLimited(httpStatus, body) {
    if (httpStatus === 429) return true;
    try {
        const parsed = JSON.parse(body);
        return Number(parsed?.errorCode) === 429;
    } catch {
        return false;
    }
}

function pickUpstreamResponseHeaders(headers) {
    const result = Object.create(null);
    for (const name of ['content-type', 'retry-after']) {
        const value = headers.get(name);
        if (value) result[name] = value;
    }
    return result;
}

function cachedResponse(request, env, body, ageSeconds, cacheState, extraHeaders = {}) {
    const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Cache': cacheState,
        'X-Cache-Age': String(Math.max(0, Math.floor(ageSeconds || 0))),
        ...extraHeaders,
    });
    applyCorsHeaders(headers, request, env);
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
}

function localRateLimitResponse(request, env, message, retryAfter, scope) {
    return jsonResponse(
        request,
        env,
        { errorCode: 429, success: false, errorMessage: message },
        429,
        {
            'Retry-After': String(Math.max(1, Math.floor(retryAfter || 60))),
            'X-Rate-Limit-Scope': scope,
            'X-Cache': 'BYPASS-RATE-LIMIT',
        },
    );
}

function jsonResponse(request, env, data, status = 200, extraHeaders = {}) {
    const headers = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders,
    });
    applyCorsHeaders(headers, request, env);
    return new Response(JSON.stringify(data), { status, headers });
}

function handleOptions(request, env) {
    const headers = new Headers();
    applyCorsHeaders(headers, request, env);
    headers.set('Access-Control-Max-Age', '86400');
    headers.set(
        'Access-Control-Allow-Headers',
        request.headers.get('Access-Control-Request-Headers') || 'Content-Type, Authorization, X-Proxy-Token',
    );
    return new Response(null, { status: 204, headers });
}

function applyCorsHeaders(headers, request, env) {
    const origin = request.headers.get('Origin');
    const configured = String(env.ALLOWED_ORIGINS || '*').trim();
    const allowed = configured === '*'
        ? '*'
        : chooseAllowedOrigin(origin, configured);

    if (allowed) headers.set('Access-Control-Allow-Origin', allowed);
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    headers.set('Access-Control-Expose-Headers', 'X-Cache, X-Cache-Age, X-Upstream-Limited, X-Rate-Limit-Scope, Retry-After');
    if (allowed !== '*') headers.append('Vary', 'Origin');
}

function chooseAllowedOrigin(origin, configured) {
    if (!origin) return null;
    const set = new Set(configured.split(',').map((s) => s.trim()).filter(Boolean));
    return set.has(origin) ? origin : null;
}

function envNumber(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function positiveInt(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.floor(n);
}

function parseJsonObject(value) {
    if (!value) return {};
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function utcDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function utcMonthKey(date = new Date()) {
    return date.toISOString().slice(0, 7);
}

function secondsUntilUtcMidnight() {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
    return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

function secondsUntilNextUtcMonth() {
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0);
    return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

function logRequest(env, message) {
    if (String(env.LOG_REQUESTS || '0') === '1') console.log(message);
}
