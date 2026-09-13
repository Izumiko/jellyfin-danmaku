const hostlist = { 'api.dandanplay.net': null };
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
};
const appId = '';
const appSecret = '';

function handleOptions(request) {
    let headers = request.headers;
    if (
        'OPTIONS' == request.method &&
        headers.get('Origin') &&
        headers.get('Access-Control-Request-Method') &&
        headers.get('Access-Control-Request-Headers')
    ) {
        let respHeaders = {
            ...corsHeaders,
            'Access-Control-Allow-Headers': headers.get('Access-Control-Request-Headers'),
        }
        return new Response(null, {
            headers: respHeaders,
        });
    } else {
        return new Response(null, {
            headers: {
                'Allow': 'GET, HEAD, POST, OPTIONS',
            },
        });
    }
}

async function generateSignature(appId, timestamp, path, appSecret) {
    const data = appId + timestamp + path + appSecret;
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashBase64 = btoa(String.fromCharCode.apply(null, hashArray));
    return hashBase64;
}

async function handleRequest(request) {
    let response;
    if (request.method === 'OPTIONS') {
        response = handleOptions(request);
    } else {
        const urlObj = new URL(request.url);
        let url = urlObj.href.replace(urlObj.origin + '/cors/', '').trim();
        if (0 !== url.indexOf('https://') && 0 === url.indexOf('https:')) {
            url = url.replace('https:/', 'https://');
        } else if (0 !== url.indexOf('http://') && 0 === url.indexOf('http:')) {
            url = url.replace('http:/', 'http://');
        }
        let tUrlObj = new URL(url);
        if (!(tUrlObj.hostname in hostlist)) {
            return Forbidden(tUrlObj);
        }

        const body = request.method === 'POST' ? await request.json() : null;

        // dandanplay login, compute sigh hash with appId and appSecret
        if (request.method === 'POST' && tUrlObj.pathname === '/api/v2/login') {
            if (body.userName.length == 0 || body.password.length == 0) {
                return new Response('{"error": "用户名或密码不能为空"}', {
                    status: 400,
                    headers: corsHeaders,
                });
            }
            const unixTimeStamp = Math.round(new Date().getTime() / 1000);
            const tmp = appId + body.password + unixTimeStamp + body.userName + appSecret;
            const hash = await crypto.subtle.digest('MD5', new TextEncoder().encode(tmp));
            body.appId = appId;
            body.unixTimeStamp = unixTimeStamp;
            body.hash = Array.from(new Uint8Array(hash))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        }

        // handle dandanplay api auth
        const timeStamp = Math.round(new Date().getTime() / 1000);
        const apiPath = tUrlObj.pathname;
        const signature = await generateSignature(appId, timeStamp, apiPath, appSecret);

        response = await fetch(url, {
            headers: {
                ...request.headers,
                'X-AppId': appId,
                'X-Signature': signature,
                'X-Timestamp': timeStamp,
                'X-Auth': '1',
            },
            body: body ? JSON.stringify(body) : null,
            method: request.method,
        });
        response = new Response(await response.body, response);
        response.headers.set('Access-Control-Allow-Origin', '*');
        response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    }
    return response;
}

function Forbidden(url) {
    return new Response(`Hostname ${url.hostname} not allowed.`, {
        status: 403,
    });
}

addEventListener('fetch', (event) => {
    return event.respondWith(handleRequest(event.request));
});
