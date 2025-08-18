// ==UserScript==
// @name         Jellyfin danmaku extension
// @description  Jellyfin弹幕插件
// @namespace    https://github.com/RyoLee
// @author       RyoLee
// @version      1.60
// @copyright    2022, RyoLee (https://github.com/RyoLee)
// @license      MIT; https://raw.githubusercontent.com/Izumiko/jellyfin-danmaku/jellyfin/LICENSE
// @icon         https://github.githubassets.com/pinned-octocat.svg
// @updateURL    https://cdn.jsdelivr.net/gh/Izumiko/jellyfin-danmaku@gh-pages/ede.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/Izumiko/jellyfin-danmaku@gh-pages/ede.user.js
// @connect      *
// @match        *://*/*/web/index.html
// @match        *://*/web/index.html
// @match        *://*/*/web/
// @match        *://*/web/
// @match        https://jellyfin-web.pages.dev/
// ==/UserScript==

(async function () {
    'use strict';
    if (document.querySelector('meta[name="application-name"]').content !== 'Jellyfin') {
        return;
    }
    // ------ configs start------
    const corsProxy = 'https://ddplay-api.930524.xyz/cors/';
    const apiPrefix = corsProxy + 'https://api.dandanplay.net';
    const authPrefix = corsProxy + 'https://api.dandanplay.net';  // 在Worker上计算Hash
    let ddplayStatus = JSON.parse(localStorage.getItem('ddplayStatus')) || { isLogin: false, token: '', tokenExpire: 0 };
    const check_interval = 200;
    // 0:当前状态关闭 1:当前状态打开
    let danmaku_icons = ['comments_disabled', 'comment'];
    const search_icon = 'find_replace';
    const source_icon = 'library_add';
    let log_icons = ['code_off', 'code'];
    const settings_icon = 'tune';
    const send_icon = 'send';
    const spanClass = 'xlargePaperIconButton material-icons ';
    const buttonOptions = {
        class: 'paper-icon-button-light',
        is: 'paper-icon-button-light',
    };
    const uiAnchorStr = 'pause';
    const uiQueryStr = '.btnPause';
    const mediaContainerQueryStr = "div[data-type='video-osd']";
    const mediaQueryStr = 'video';

    let isNewJellyfin = true;
    let itemId = '';
    const defaultFontFamily = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (_, url) {
        this.addEventListener('load', function () {
            if (url.endsWith('PlaybackInfo')) {
                const res = JSON.parse(this.responseText);
                itemId = res.MediaSources[0].Id;
            }
        });
        originalOpen.apply(this, arguments);
    };

    const displayButtonOpts = {
        title: '弹幕开关',
        id: 'displayDanmaku',
        onclick: () => {
            danmuShowSwitch();
        },
    };

    const sendDanmakuOpts = {
        title: '发送弹幕',
        id: 'sendDanmaku',
        class: send_icon,
        onclick: () => {
            // 登录窗口
            if (!document.getElementById('loginDialog')) {
                const modal = document.createElement('div');
                modal.id = 'loginDialog';
                modal.className = 'dialogContainer';
                modal.style.display = 'none';
                modal.innerHTML = `
                <div class="dialog" style="padding: 20px; border-radius: .3em; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);">
                <form id="loginForm">
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        <div style="display: flex;">
                            <span style="flex: auto;">请输入弹弹Play账号密码</span>
                        </div>
                        <div style="display: flex;">
                            <span style="flex: auto;">账号:</span>
                            <input id="ddPlayAccount" placeholder="账号" value="" style="width: 70%;" />
                        </div>
                        <div style="display: flex;">
                            <span style="flex: auto;">密码:</span>
                            <input id="ddPlayPassword" placeholder="密码" value="" style="width: 70%;" type="password" />
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 10px;">
                        <button id="loginBtn" class="raised button-submit block formDialogFooterItem emby-button" type="submit">登录</button>
                        <button id="cancelBtn" class="raised button-cancel block formDialogFooterItem emby-button" type="button">取消</button>
                    </div>
                </form>
                </div>
                `;
                document.body.appendChild(modal);

                document.getElementById('loginForm').onsubmit = (e) => {
                    e.preventDefault();
                    const account = document.getElementById('ddPlayAccount').value;
                    const password = document.getElementById('ddPlayPassword').value;
                    if (account && password) {
                        loginDanDanPlay(account, password).then(status => {
                            if (status) {
                                document.getElementById('loginBtn').innerText = '登录✔️';
                                let sleep = new Promise(resolve => setTimeout(resolve, 1500));
                                sleep.then(() => {
                                    document.getElementById('loginDialog').style.display = 'none';
                                });
                                modal.removeEventListener('keydown', event => event.stopPropagation(), true);
                            }
                        });
                    }
                };
                document.getElementById('cancelBtn').onclick = () => {
                    document.getElementById('loginDialog').style.display = 'none';
                    modal.removeEventListener('keydown', event => event.stopPropagation(), true);
                };
            }

            // 发送窗口
            if (!document.getElementById('sendDanmakuDialog')) {
                const modal = document.createElement('div');
                modal.id = 'sendDanmakuDialog';
                modal.className = 'dialogContainer';
                modal.style.display = 'none';
                modal.innerHTML = `
                <div class="dialog" style="padding: 20px; border-radius: .3em; position: fixed; left: 50%; bottom: 0; transform: translate(-50%, -50%); width: 40%;">
                <form id="sendDanmakuForm" autocomplete="off">
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        <div style="display: flex;">
                            <span id="lbAnimeTitle" style="flex: auto;"></span>
                        </div>
                        <div style="display: flex;">
                            <span id="lbEpisodeTitle" style="flex: auto;"></span>
                        </div>
                        <div style="display: flex;">
                            <div><input type="radio" id="danmakuMode1" name="danmakuMode" value="1" checked>
                            <label for="danmakuMode1">滚动</label></div>
                            <div><input type="radio" id="danmakuMode4" name="danmakuMode" value="4">
                            <label for="danmakuMode4">底部</label></div>
                            <div><input type="radio" id="danmakuMode5" name="danmakuMode" value="5">
                            <label for="danmakuMode5">顶部</label></div>
                        </div>
                        <div style="display: flex;">
                            <input style="flex-grow: 1;" id="danmakuText" placeholder="请输入弹幕内容" value="" />
                            <button id="sendDanmakuBtn" class="raised button-submit emby-button" style="padding: .2em .5em;" type="submit">发送</button>
                            <button id="cancelSendDanmakuBtn" class="raised button-cancel emby-button" style="padding: .2em .5em;" type="button">取消</button>
                        </div>
                    </div>
                </form>
                </div>
                `;
                document.body.appendChild(modal);
                document.getElementById('sendDanmakuForm').onsubmit = (e) => {
                    e.preventDefault();
                    const danmakuText = document.getElementById('danmakuText').value;
                    if (danmakuText === '') {
                        const txt = document.getElementById('danmakuText');
                        txt.placeholder = '弹幕内容不能为空！';
                        txt.focus();
                        return;
                    }
                    const _media = document.querySelector(mediaQueryStr);
                    const currentTime = _media.currentTime;
                    const mode = parseInt(document.querySelector('input[name="danmakuMode"]:checked').value);
                    sendDanmaku(danmakuText, currentTime, mode);
                    // 清空输入框的值
                    document.getElementById('danmakuText').value = '';
                    modal.style.display = 'none';
                    modal.removeEventListener('keydown', event => event.stopPropagation(), true);
                };
                document.getElementById('cancelSendDanmakuBtn').onclick = () => {
                    modal.style.display = 'none';
                    modal.removeEventListener('keydown', event => event.stopPropagation(), true);
                };
            }

            if (ddplayStatus.isLogin) {
                const txt = document.getElementById('danmakuText');
                txt.placeholder = '请输入弹幕内容';
                txt.value = '';
                txt.focus();
                document.getElementById('sendDanmakuDialog').style.display = 'block';
                document.getElementById('sendDanmakuDialog').addEventListener('keydown', event => event.stopPropagation(), true);
                const animeTitle = window.ede.episode_info ? window.ede.episode_info.animeTitle : '';
                const episodeTitle = window.ede.episode_info ? window.ede.episode_info.episodeTitle : '';
                document.getElementById('lbAnimeTitle').innerText = `当前番剧: ${animeTitle || ''}`;
                document.getElementById('lbEpisodeTitle').innerText = `当前集数: ${episodeTitle || ''}`;
            } else {
                document.getElementById('loginDialog').style.display = 'block';
                document.getElementById('loginDialog').addEventListener('keydown', event => event.stopPropagation(), true);
            }
        }
    };



    // ------ configs end------
    /* eslint-disable */
    /* https://cdn.jsdelivr.net/npm/danmaku/dist/danmaku.min.js */
    // prettier-ignore
    !function (t, e) { "object" == typeof exports && "undefined" != typeof module ? module.exports = e() : "function" == typeof define && define.amd ? define(e) : (t = "undefined" != typeof globalThis ? globalThis : t || self).Danmaku = e() }(this, (function () { "use strict"; var t = function () { if ("undefined" == typeof document) return "transform"; for (var t = ["oTransform", "msTransform", "mozTransform", "webkitTransform", "transform"], e = document.createElement("div").style, i = 0; i < t.length; i++)if (t[i] in e) return t[i]; return "transform" }(); function e(t) { var e = document.createElement("div"); if (e.style.cssText = "position:absolute;", "function" == typeof t.render) { var i = t.render(); if (i instanceof HTMLElement) return e.appendChild(i), e } if (e.textContent = t.text, t.style) for (var n in t.style) e.style[n] = t.style[n]; return e } var i = { name: "dom", init: function () { var t = document.createElement("div"); return t.style.cssText = "overflow:hidden;white-space:nowrap;transform:translateZ(0);", t }, clear: function (t) { for (var e = t.lastChild; e;)t.removeChild(e), e = t.lastChild }, resize: function (t, e, i) { t.style.width = e + "px", t.style.height = i + "px" }, framing: function () { }, setup: function (t, i) { var n = document.createDocumentFragment(), s = 0, r = null; for (s = 0; s < i.length; s++)(r = i[s]).node = r.node || e(r), n.appendChild(r.node); for (i.length && t.appendChild(n), s = 0; s < i.length; s++)(r = i[s]).width = r.width || r.node.offsetWidth, r.height = r.height || r.node.offsetHeight }, render: function (e, i) { i.node.style[t] = "translate(" + i.x + "px," + i.y + "px)" }, remove: function (t, e) { t.removeChild(e.node), this.media || (e.node = null) } }, n = "undefined" != typeof window && window.devicePixelRatio || 1, s = Object.create(null); function r(t, e) { if ("function" == typeof t.render) { var i = t.render(); if (i instanceof HTMLCanvasElement) return t.width = i.width, t.height = i.height, i } var r = document.createElement("canvas"), h = r.getContext("2d"), o = t.style || {}; o.font = o.font || "10px sans-serif", o.textBaseline = o.textBaseline || "bottom"; var a = 1 * o.lineWidth; for (var d in a = a > 0 && a !== 1 / 0 ? Math.ceil(a) : 1 * !!o.strokeStyle, h.font = o.font, t.width = t.width || Math.max(1, Math.ceil(h.measureText(t.text).width) + 2 * a), t.height = t.height || Math.ceil(function (t, e) { if (s[t]) return s[t]; var i = 12, n = t.match(/(\d+(?:\.\d+)?)(px|%|em|rem)(?:\s*\/\s*(\d+(?:\.\d+)?)(px|%|em|rem)?)?/); if (n) { var r = 1 * n[1] || 10, h = n[2], o = 1 * n[3] || 1.2, a = n[4]; "%" === h && (r *= e.container / 100), "em" === h && (r *= e.container), "rem" === h && (r *= e.root), "px" === a && (i = o), "%" === a && (i = r * o / 100), "em" === a && (i = r * o), "rem" === a && (i = e.root * o), void 0 === a && (i = r * o) } return s[t] = i, i }(o.font, e)) + 2 * a, r.width = t.width * n, r.height = t.height * n, h.scale(n, n), o) h[d] = o[d]; var u = 0; switch (o.textBaseline) { case "top": case "hanging": u = a; break; case "middle": u = t.height >> 1; break; default: u = t.height - a }return o.strokeStyle && h.strokeText(t.text, a, u), h.fillText(t.text, a, u), r } function h(t) { return 1 * window.getComputedStyle(t, null).getPropertyValue("font-size").match(/(.+)px/)[1] } var o = { name: "canvas", init: function (t) { var e = document.createElement("canvas"); return e.context = e.getContext("2d"), e._fontSize = { root: h(document.getElementsByTagName("html")[0]), container: h(t) }, e }, clear: function (t, e) { t.context.clearRect(0, 0, t.width, t.height); for (var i = 0; i < e.length; i++)e[i].canvas = null }, resize: function (t, e, i) { t.width = e * n, t.height = i * n, t.style.width = e + "px", t.style.height = i + "px" }, framing: function (t) { t.context.clearRect(0, 0, t.width, t.height) }, setup: function (t, e) { for (var i = 0; i < e.length; i++) { var n = e[i]; n.canvas = r(n, t._fontSize) } }, render: function (t, e) { t.context.drawImage(e.canvas, e.x * n, e.y * n) }, remove: function (t, e) { e.canvas = null } }, a = "undefined" != typeof window && (window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame) || function (t) { return setTimeout(t, 50 / 3) }, d = "undefined" != typeof window && (window.cancelAnimationFrame || window.mozCancelAnimationFrame || window.webkitCancelAnimationFrame) || clearTimeout; function u(t, e, i) { for (var n = 0, s = 0, r = t.length; s < r - 1;)i >= t[n = s + r >> 1][e] ? s = n : r = n; return t[s] && i < t[s][e] ? s : r } function m(t) { return /^(ltr|top|bottom)$/i.test(t) ? t.toLowerCase() : "rtl" } function c() { var t = 9007199254740991; return [{ range: 0, time: -t, width: t, height: 0 }, { range: t, time: t, width: 0, height: 0 }] } function l(t) { t.ltr = c(), t.rtl = c(), t.top = c(), t.bottom = c() } function f() { return void 0 !== window.performance && window.performance.now ? window.performance.now() : Date.now() } function p(t) { var e = this, i = this.media ? this.media.currentTime : f() / 1e3, n = this.media ? this.media.playbackRate : 1; function s(t, s) { if ("top" === s.mode || "bottom" === s.mode) return i - t.time < e._.duration; var r = (e._.width + t.width) * (i - t.time) * n / e._.duration; if (t.width > r) return !0; var h = e._.duration + t.time - i, o = e._.width + s.width, a = e.media ? s.time : s._utc, d = o * (i - a) * n / e._.duration, u = e._.width - d; return h > e._.duration * u / (e._.width + s.width) } for (var r = this._.space[t.mode], h = 0, o = 0, a = 1; a < r.length; a++) { var d = r[a], u = t.height; if ("top" !== t.mode && "bottom" !== t.mode || (u += d.height), d.range - d.height - r[h].range >= u) { o = a; break } s(d, t) && (h = a) } var m = r[h].range, c = { range: m + t.height, time: this.media ? t.time : t._utc, width: t.width, height: t.height }; return r.splice(h + 1, o - h - 1, c), "bottom" === t.mode ? this._.height - t.height - m % this._.height : m % (this._.height - t.height) } function g() { if (!this._.visible || !this._.paused) return this; if (this._.paused = !1, this.media) for (var t = 0; t < this._.runningList.length; t++) { var e = this._.runningList[t]; e._utc = f() / 1e3 - (this.media.currentTime - e.time) } var i = this, n = function (t, e, i, n) { return function (s) { t(this._.stage); var r = (s || f()) / 1e3, h = this.media ? this.media.currentTime : r, o = this.media ? this.media.playbackRate : 1, a = null, d = 0, u = 0; for (u = this._.runningList.length - 1; u >= 0; u--)a = this._.runningList[u], h - (d = this.media ? a.time : a._utc) > this._.duration && (n(this._.stage, a), this._.runningList.splice(u, 1)); for (var m = []; this._.position < this.comments.length && (a = this.comments[this._.position], !((d = this.media ? a.time : a._utc) >= h));)h - d > this._.duration || (this.media && (a._utc = r - (this.media.currentTime - a.time)), m.push(a)), ++this._.position; for (e(this._.stage, m), u = 0; u < m.length; u++)(a = m[u]).y = p.call(this, a), this._.runningList.push(a); for (u = 0; u < this._.runningList.length; u++) { a = this._.runningList[u]; var c = (this._.width + a.width) * (r - a._utc) * o / this._.duration; "ltr" === a.mode && (a.x = c - a.width), "rtl" === a.mode && (a.x = this._.width - c), "top" !== a.mode && "bottom" !== a.mode || (a.x = this._.width - a.width >> 1), i(this._.stage, a) } } }(this._.engine.framing.bind(this), this._.engine.setup.bind(this), this._.engine.render.bind(this), this._.engine.remove.bind(this)); return this._.requestID = a((function t(e) { n.call(i, e), i._.requestID = a(t) })), this } function _() { return !this._.visible || this._.paused || (this._.paused = !0, d(this._.requestID), this._.requestID = 0), this } function v() { if (!this.media) return this; this.clear(), l(this._.space); var t = u(this.comments, "time", this.media.currentTime); return this._.position = Math.max(0, t - 1), this } function w(t) { t.play = g.bind(this), t.pause = _.bind(this), t.seeking = v.bind(this), this.media.addEventListener("play", t.play), this.media.addEventListener("pause", t.pause), this.media.addEventListener("playing", t.play), this.media.addEventListener("waiting", t.pause), this.media.addEventListener("seeking", t.seeking) } function y(t) { this.media.removeEventListener("play", t.play), this.media.removeEventListener("pause", t.pause), this.media.removeEventListener("playing", t.play), this.media.removeEventListener("waiting", t.pause), this.media.removeEventListener("seeking", t.seeking), t.play = null, t.pause = null, t.seeking = null } function x(t) { this._ = {}, this.container = t.container || document.createElement("div"), this.media = t.media, this._.visible = !0, this.engine = (t.engine || "DOM").toLowerCase(), this._.engine = "canvas" === this.engine ? o : i, this._.requestID = 0, this._.speed = Math.max(0, t.speed) || 144, this._.duration = 4, this.comments = t.comments || [], this.comments.sort((function (t, e) { return t.time - e.time })); for (var e = 0; e < this.comments.length; e++)this.comments[e].mode = m(this.comments[e].mode); return this._.runningList = [], this._.position = 0, this._.paused = !0, this.media && (this._.listener = {}, w.call(this, this._.listener)), this._.stage = this._.engine.init(this.container), this._.stage.style.cssText += "position:relative;pointer-events:none;", this.resize(), this.container.appendChild(this._.stage), this._.space = {}, l(this._.space), this.media && this.media.paused || (v.call(this), g.call(this)), this } function b() { if (!this.container) return this; for (var t in _.call(this), this.clear(), this.container.removeChild(this._.stage), this.media && y.call(this, this._.listener), this) Object.prototype.hasOwnProperty.call(this, t) && (this[t] = null); return this } var L = ["mode", "time", "text", "render", "style"]; function T(t) { if (!t || "[object Object]" !== Object.prototype.toString.call(t)) return this; for (var e = {}, i = 0; i < L.length; i++)void 0 !== t[L[i]] && (e[L[i]] = t[L[i]]); if (e.text = (e.text || "").toString(), e.mode = m(e.mode), e._utc = f() / 1e3, this.media) { var n = 0; void 0 === e.time ? (e.time = this.media.currentTime, n = this._.position) : (n = u(this.comments, "time", e.time)) < this._.position && (this._.position += 1), this.comments.splice(n, 0, e) } else this.comments.push(e); return this } function E() { return this._.visible ? this : (this._.visible = !0, this.media && this.media.paused || (v.call(this), g.call(this)), this) } function k() { return this._.visible ? (_.call(this), this.clear(), this._.visible = !1, this) : this } function C() { return this._.engine.clear(this._.stage, this._.runningList), this._.runningList = [], this } function z() { return this._.width = this.container.offsetWidth, this._.height = this.container.offsetHeight, this._.engine.resize(this._.stage, this._.width, this._.height), this._.duration = this._.width / this._.speed, this } var D = { get: function () { return this._.speed }, set: function (t) { return "number" != typeof t || isNaN(t) || !isFinite(t) || t <= 0 ? this._.speed : (this._.speed = t, this._.width && (this._.duration = this._.width / t), t) } }; function M(t) { t && x.call(this, t) } return M.prototype.destroy = function () { return b.call(this) }, M.prototype.emit = function (t) { return T.call(this, t) }, M.prototype.show = function () { return E.call(this) }, M.prototype.hide = function () { return k.call(this) }, M.prototype.clear = function () { return C.call(this) }, M.prototype.resize = function () { return z.call(this) }, Object.defineProperty(M.prototype, "speed", D), M }));
    /* eslint-enable */


    class EDE {
        constructor() {
            // 简繁转换 0:不转换 1:简体 2:繁体
            const chConvert = window.localStorage.getItem('chConvert');
            this.chConvert = chConvert ? parseInt(chConvert) : 0;
            // 开关弹幕 0:关闭 1:打开
            const danmakuSwitch = window.localStorage.getItem('danmakuSwitch');
            this.danmakuSwitch = danmakuSwitch ? parseInt(danmakuSwitch) : 1;
            // 开关日志 0:关闭 1:打开
            const logSwitch = window.localStorage.getItem('logSwitch');
            this.logSwitch = logSwitch ? parseInt(logSwitch) : 0;
            // 弹幕透明度
            const opacityRecord = window.localStorage.getItem('danmakuopacity');
            this.opacity = opacityRecord ? parseFloatOfRange(opacityRecord, 0.0, 1.0) : 0.7
            // 弹幕速度
            const speedRecord = window.localStorage.getItem('danmakuspeed');
            this.speed = speedRecord ? parseFloatOfRange(speedRecord, 0.0, 1000.0) : 200
            // 弹幕字体大小
            const sizeRecord = window.localStorage.getItem('danmakusize');
            this.fontSize = sizeRecord ? parseFloatOfRange(sizeRecord, 0.0, 50.0) : 18
            // 弹幕高度
            const heightRecord = window.localStorage.getItem('danmakuheight');
            this.heightRatio = heightRecord ? parseFloatOfRange(heightRecord, 0.0, 1.0) : 0.9
            // 弹幕过滤
            const danmakuFilter = window.localStorage.getItem('danmakuFilter');
            this.danmakuFilter = danmakuFilter ? parseInt(danmakuFilter) : 0;
            this.danmakuFilter = this.danmakuFilter >= 0 && this.danmakuFilter < 16 ? this.danmakuFilter : 0;
            // 按弹幕模式过滤
            const danmakuModeFilter = window.localStorage.getItem('danmakuModeFilter');
            this.danmakuModeFilter = danmakuModeFilter ? parseInt(danmakuModeFilter) : 0;
            this.danmakuModeFilter = this.danmakuModeFilter >= 0 && this.danmakuModeFilter < 8 ? this.danmakuModeFilter : 0;
            // 弹幕密度限制等级 0:不限制 1:低 2:中 3:高
            const danmakuDensityLimit = window.localStorage.getItem('danmakuDensityLimit');
            this.danmakuDensityLimit = danmakuDensityLimit ? parseInt(danmakuDensityLimit) : 0;
            // 使用弹幕防重叠
            const useAnitOverlap = window.localStorage.getItem('useAnitOverlap');
            this.useAnitOverlap = useAnitOverlap ? parseInt(useAnitOverlap) : 0;
            // 使用Jellyfin弹幕插件提供的xml弹幕替代本脚本在线搜索的弹幕
            const useXmlDanmaku = window.localStorage.getItem('useXmlDanmaku');
            this.useXmlDanmaku = useXmlDanmaku ? parseInt(useXmlDanmaku) : 0;
            // 当前剧集弹幕偏移时间
            this.curEpOffset = 0;
            this.curEpOffsetModified = false;
            // 字体
            const fontFamily = window.localStorage.getItem('danmakuFontFamily');
            this.fontFamily = fontFamily ?? "sans-serif";
            // 字体选项
            const fontOptions = window.localStorage.getItem('danmakuFontOptions');
            this.fontOptions = fontOptions ?? "";

            this.danmaku = null;
            this.episode_info = null;
            this.obResize = null;
            this.obMutation = null;
            this.loading = false;
        }
    }

    //判断火狐浏览器
    function isFirefox() {
        return navigator.userAgent.toLowerCase().includes('firefox');
    }


    // 切换弹幕显示
    function danmuShowSwitch() {
        if (window.ede.loading) {
            showDebugInfo('正在加载,请稍后再试');
            return;
        }
        showDebugInfo('切换弹幕开关');
        window.ede.danmakuSwitch = (window.ede.danmakuSwitch + 1) % 2;
        window.localStorage.setItem('danmakuSwitch', window.ede.danmakuSwitch);
        document.querySelector('#displayDanmaku').children[0].className = spanClass + danmaku_icons[window.ede.danmakuSwitch];
        if (window.ede.danmaku) {
            window.ede.danmakuSwitch == 1 ? window.ede.danmaku.show() : window.ede.danmaku.hide();
        }
    }
    // 保存设置
    function saveSettings() {
        try {
            window.ede.opacity = parseFloatOfRange(document.getElementById('opacity').value, 0, 1);
            window.localStorage.setItem('danmakuopacity', window.ede.opacity.toString());
            showDebugInfo(`设置弹幕透明度：${window.ede.opacity}`);
            window.ede.speed = parseFloatOfRange(document.getElementById('speed').value, 20, 600);
            window.localStorage.setItem('danmakuspeed', window.ede.speed.toString());
            showDebugInfo(`设置弹幕速度：${window.ede.speed}`);
            window.ede.fontSize = parseFloatOfRange(document.getElementById('fontSize').value, 8, 40);
            window.localStorage.setItem('danmakusize', window.ede.fontSize.toString());
            showDebugInfo(`设置弹幕大小：${window.ede.fontSize}`);
            window.ede.heightRatio = parseFloatOfRange(document.getElementById('heightRatio').value, 0, 1);
            window.localStorage.setItem('danmakuheight', window.ede.heightRatio.toString());
            showDebugInfo(`设置弹幕高度：${window.ede.heightRatio}`);
            window.ede.danmakuFilter = 0;
            document.querySelectorAll('input[name="danmakuFilter"]:checked').forEach(element => {
                window.ede.danmakuFilter += parseInt(element.value, 10);
            });
            window.localStorage.setItem('danmakuFilter', window.ede.danmakuFilter);
            showDebugInfo(`设置弹幕过滤：${window.ede.danmakuFilter}`);
            window.ede.danmakuModeFilter = 0;
            document.querySelectorAll('input[name="danmakuModeFilter"]:checked').forEach(element => {
                window.ede.danmakuModeFilter += parseInt(element.value, 10);
            });
            window.localStorage.setItem('danmakuModeFilter', window.ede.danmakuModeFilter);
            showDebugInfo(`设置弹幕模式过滤：${window.ede.danmakuModeFilter}`);
            window.ede.danmakuDensityLimit = parseInt(document.getElementById('danmakuDensityLimit').value);
            window.localStorage.setItem('danmakuDensityLimit', window.ede.danmakuDensityLimit);
            showDebugInfo(`设置弹幕密度限制等级：${window.ede.danmakuDensityLimit}`);
            window.ede.useAnitOverlap = parseInt(document.querySelector('input[name="useAnitOverlap"]:checked').value);
            window.localStorage.setItem('useAnitOverlap', window.ede.useAnitOverlap);
            showDebugInfo(`是否使用弹幕防重叠：${window.ede.useAnitOverlap}`);
            window.ede.chConvert = parseInt(document.querySelector('input[name="chConvert"]:checked').value);
            window.localStorage.setItem('chConvert', window.ede.chConvert);
            showDebugInfo(`设置简繁转换：${window.ede.chConvert}`);
            window.ede.useXmlDanmaku = parseInt(document.querySelector('input[name="useXmlDanmaku"]:checked').value);
            window.localStorage.setItem('useXmlDanmaku', window.ede.useXmlDanmaku);
            showDebugInfo(`是否使用本地xml弹幕：${window.ede.useXmlDanmaku}`);
            const epOffset = parseFloat(document.getElementById('danmakuOffsetTime').value);
            window.ede.curEpOffsetModified = epOffset !== window.ede.curEpOffset;
            if (window.ede.curEpOffsetModified) {
                window.ede.curEpOffset = epOffset;
                showDebugInfo(`设置弹幕偏移时间：${window.ede.curEpOffset}`);
            }
            window.ede.fontFamily = document.getElementById("danmakuFontFamily").value || "sans-serif";
            window.localStorage.setItem('danmakuFontFamily', window.ede.fontFamily);
            showDebugInfo(`字体：${window.ede.fontFamily}`);
            window.ede.fontOptions = document.getElementById("danmakuFontOptions").value;
            window.localStorage.setItem('danmakuFontOptions', window.ede.fontOptions);
            showDebugInfo(`字体选项：${window.ede.fontOptions}`);
            reloadDanmaku('reload');
            closeDanmakuSidebar();
        } catch (e) {
            alert(`Invalid input: ${e.message}`);
        }
    }

    // 创建弹幕设置侧边栏
    function createDanmakuSidebar() {
        // 防止创建重复的侧边栏
        if (document.getElementById('danmakuSidebar')) {
            return;
        }

        // const dialog = originalModal.querySelector('.dialog');
        // if (!dialog) return;

        const sidebar = document.createElement('div');
        sidebar.id = 'danmakuSidebar';
        sidebar.className = 'danmakuSidebar';
        sidebar.style.cssText = `
            position: fixed;
            top: 0;
            right: 0;
            width: 450px;
            max-width: 90vw;
            height: 100vh;
            background: rgba(18, 18, 20, 0.95);
            backdrop-filter: blur(15px);
            z-index: 1000000;
            display: flex;
            flex-direction: column;
            box-shadow: -5px 0 25px rgba(0, 0, 0, 0.5);
            transform: translateX(100%);
            transition: transform 0.3s ease-in-out;
            overflow: hidden;
            box-sizing: border-box;
            border-radius: 20px 0 0 0;
        `;

        // 创建头部
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            min-height: 60px;
        `;

        const titleEl = document.createElement('h2');
        titleEl.textContent = '弹幕设置';
        titleEl.style.cssText = `
            color: #fff;
            margin: 0;
            font-size: 20px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;

        // 创建右侧按钮组
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.cssText = `
            display: flex;
            gap: 10px;
            align-items: center;
        `;

        // 保存按钮
        const saveButton = document.createElement('button');
        saveButton.innerHTML = '保存';
        saveButton.title = '保存设置';
        saveButton.style.cssText = `
            background: rgba(0, 164, 220, 1);
            border: none;
            color: #fff;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            padding: 10px 20px;
            border-radius: 8px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            min-width: 60px;
        `;
        saveButton.onclick = () => {
            saveSettings();
            closeDanmakuSidebar();
        };

        saveButton.addEventListener('mouseenter', function () {
            this.style.transform = 'translateY(-1px)';
            this.style.boxShadow = '0 4px 12px rgba(0, 164, 220, 0.4)';
        });

        saveButton.addEventListener('mouseleave', function () {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = 'none';
        });

        // 取消按钮
        const cancelButton = document.createElement('button');
        cancelButton.innerHTML = '取消';
        cancelButton.title = '取消设置';
        cancelButton.style.cssText = `
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #fff;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            padding: 10px 20px;
            border-radius: 8px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            min-width: 60px;
        `;
        cancelButton.onclick = () => {
            closeDanmakuSidebar();
        };

        cancelButton.addEventListener('mouseenter', function () {
            this.style.background = 'rgba(255, 255, 255, 0.15)';
            this.style.transform = 'translateY(-1px)';
            this.style.boxShadow = '0 4px 12px rgba(255, 255, 255, 0.1)';
        });

        cancelButton.addEventListener('mouseleave', function () {
            this.style.background = 'rgba(255, 255, 255, 0.1)';
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = 'none';
        });

        buttonsContainer.appendChild(saveButton);
        buttonsContainer.appendChild(cancelButton);

        header.appendChild(titleEl);
        header.appendChild(buttonsContainer);
        sidebar.appendChild(header);

        // 创建设置内容容器
        const settingsContainer = document.createElement('div');
        settingsContainer.className = 'danmaku-settings-container';
        settingsContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
        `;
        sidebar.appendChild(settingsContainer);

        // 处理设置项
        setTimeout(() => {
            setupDanmakuSettings(settingsContainer);
        }, 100);

        // 创建遮罩层，防止点击侧边栏外部时暂停视频
        const backdrop = document.createElement('div');
        backdrop.className = 'dialogBackdrop dialogBackdropOpened';
        backdrop.id = 'danmakuSidebarBackdrop';
        backdrop.style.cssText = `
            z-index: 999999;
        `;
        
        // 将遮罩和侧边栏都添加到body
        document.body.appendChild(backdrop);
        document.body.appendChild(sidebar);

        // 添加样式
        addDanmakuSidebarStyles();

        // ESC键关闭
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeDanmakuSidebar();
            }
        };
        document.addEventListener('keydown', handleEscape);
        sidebar._handleEscape = handleEscape;

        // 点击遮罩关闭侧边栏
        const handleBackdropClick = (e) => {
            // 只有点击遮罩本身时才关闭侧边栏
            if (e.target === backdrop) {
                closeDanmakuSidebar();
            }
        };

        setTimeout(() => {
            backdrop.addEventListener('click', handleBackdropClick);
            sidebar._handleBackdropClick = handleBackdropClick;
        }, 300);

        // 显示侧边栏
        setTimeout(() => {
            sidebar.style.transform = 'translateX(0)';
        }, 50);
    }

    // 关闭弹幕侧边栏
    function closeDanmakuSidebar() {
        const sidebar = document.getElementById('danmakuSidebar');
        const backdrop = document.getElementById('danmakuSidebarBackdrop');
        if (!sidebar) return;

        sidebar.style.transform = 'translateX(100%)';

        if (sidebar._handleEscape) {
            document.removeEventListener('keydown', sidebar._handleEscape);
        }

        if (sidebar._handleBackdropClick && backdrop) {
            backdrop.removeEventListener('click', sidebar._handleBackdropClick);
        }

        setTimeout(() => {
            sidebar.parentNode?.removeChild(sidebar);
            // 同时移除遮罩层
            if (backdrop && backdrop.parentNode) {
                backdrop.parentNode.removeChild(backdrop);
            }
        }, 300);
    }

    // 创建自定义输入对话框
    function createInputDialog(title, placeholder, defaultValue = '') {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(8px);
                z-index: 2000000;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: rgba(20, 20, 25, 0.65);
                backdrop-filter: blur(25px) saturate(1.5);
                border-radius: 16px;
                padding: 24px;
                width: 400px;
                max-width: 90vw;
                box-shadow: 
                    0 16px 40px rgba(0, 0, 0, 0.6),
                    0 8px 20px rgba(0, 0, 0, 0.4),
                    inset 0 1px 0 rgba(255, 255, 255, 0.2),
                    inset 0 -1px 0 rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.15);
                position: relative;
                overflow: hidden;
            `;

            dialog.innerHTML = `
                <h3 style="color: #fff; margin: 0 0 16px 0; font-size: 18px; font-weight: 600;">${title}</h3>
                <input type="text" id="dialogInput" placeholder="${placeholder}" value="${defaultValue}" style="
                    width: 100%;
                    margin-bottom: 20px;
                    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                " />
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="dialogCancel" style="
                        padding: 10px 20px;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                        border-radius: 8px;
                        background: rgba(255, 255, 255, 0.1);
                        color: #fff;
                        font-size: 14px;
                        cursor: pointer;
                        transition: all 0.3s;
                    ">取消</button>
                    <button id="dialogConfirm" style="
                        padding: 10px 20px;
                        border: none;
                        border-radius: 8px;
                        background: rgba(0, 164, 220, 1);
                        color: #fff;
                        font-size: 14px;
                        cursor: pointer;
                        transition: all 0.3s;
                    ">确认</button>
                </div>
            `;

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // 添加磨砂玻璃效果层
            const glassLayer = document.createElement('div');
            glassLayer.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(135deg, 
                    rgba(255, 255, 255, 0.1) 0%,
                    rgba(255, 255, 255, 0.05) 50%,
                    rgba(0, 0, 0, 0.1) 100%
                );
                border-radius: 16px;
                pointer-events: none;
                z-index: -1;
            `;
            dialog.appendChild(glassLayer);

            // 确保样式已经应用到页面
            addDanmakuSidebarStyles();

            const input = dialog.querySelector('#dialogInput');
            const cancelBtn = dialog.querySelector('#dialogCancel');
            const confirmBtn = dialog.querySelector('#dialogConfirm');

            input.focus();
            input.select();

            input.addEventListener('keydown', event => event.stopPropagation(), true);

            const cleanup = () => {
                document.body.removeChild(overlay);
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve(null);
            };

            confirmBtn.onclick = () => {
                const value = input.value.trim();
                cleanup();
                resolve(value || null);
            };

            // 添加按钮hover效果
            cancelBtn.onmouseenter = () => {
                cancelBtn.style.background = 'rgba(255, 255, 255, 0.15)';
                cancelBtn.style.transform = 'translateY(-1px)';
            };
            cancelBtn.onmouseleave = () => {
                cancelBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                cancelBtn.style.transform = 'translateY(0)';
            };

            confirmBtn.onmouseenter = () => {
                confirmBtn.style.background = 'rgba(0, 164, 220, 0.8)';
                confirmBtn.style.transform = 'translateY(-1px)';
            };
            confirmBtn.onmouseleave = () => {
                confirmBtn.style.background = 'rgba(0, 164, 220, 1)';
                confirmBtn.style.transform = 'translateY(0)';
            };

            input.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    confirmBtn.click();
                } else if (e.key === 'Escape') {
                    cancelBtn.click();
                }
            };

            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    cancelBtn.click();
                }
            };
        });
    }

    // 创建自定义选择对话框
    function createSelectDialog(title, options, defaultIndex = 0) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(8px);
                z-index: 2000000;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: rgba(20, 20, 25, 0.65);
                backdrop-filter: blur(25px) saturate(1.5);
                border-radius: 16px;
                padding: 24px;
                width: 500px;
                max-width: 90vw;
                max-height: 80vh;
                box-shadow: 
                    0 16px 40px rgba(0, 0, 0, 0.6),
                    0 8px 20px rgba(0, 0, 0, 0.4),
                    inset 0 1px 0 rgba(255, 255, 255, 0.2),
                    inset 0 -1px 0 rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.15);
                display: flex;
                flex-direction: column;
                position: relative;
                overflow: hidden;
            `;

            const titleEl = document.createElement('h3');
            titleEl.style.cssText = `
                color: #fff;
                margin: 0 0 16px 0;
                font-size: 18px;
                font-weight: 600;
            `;
            titleEl.textContent = title;

            const listContainer = document.createElement('div');
            listContainer.style.cssText = `
                flex: 1;
                overflow-y: auto;
                margin-bottom: 20px;
                max-height: 400px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                background: rgba(255, 255, 255, 0.05);
                scrollbar-width: thin;
                scrollbar-color: rgba(0, 164, 220, 0.5) rgba(0, 0, 0, 0.1);
            `;

            // 添加webkit滚动条样式
            const style = document.createElement('style');
            style.textContent = `
                .danmaku-select-list::-webkit-scrollbar {
                    width: 8px;
                }
                .danmaku-select-list::-webkit-scrollbar-track {
                    background: rgba(0, 0, 0, 0.1);
                    border-radius: 4px;
                }
                .danmaku-select-list::-webkit-scrollbar-thumb {
                    background: rgba(0, 164, 220, 0.5);
                    border-radius: 4px;
                }
                .danmaku-select-list::-webkit-scrollbar-thumb:hover {
                    background: rgba(0, 164, 220, 0.7);
                }
            `;
            document.head.appendChild(style);
            listContainer.className = 'danmaku-select-list';

            let selectedIndex = defaultIndex;

            options.forEach((option, index) => {
                const item = document.createElement('div');
                item.style.cssText = `
                    padding: 12px 16px;
                    color: #fff;
                    cursor: pointer;
                    transition: all 0.3s;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    background: ${index === selectedIndex ? 'rgba(0, 164, 220, 0.2)' : 'transparent'};
                `;
                item.textContent = option;

                item.onmouseenter = () => {
                    if (index !== selectedIndex) {
                        item.style.background = 'rgba(255, 255, 255, 0.08)';
                    }
                };

                item.onmouseleave = () => {
                    item.style.background = index === selectedIndex ? 'rgba(0, 164, 220, 0.2)' : 'transparent';
                };

                item.onclick = () => {
                    // 更新选中状态
                    listContainer.querySelectorAll('div').forEach((el, i) => {
                        el.style.background = i === index ? 'rgba(0, 164, 220, 0.2)' : 'transparent';
                    });
                    selectedIndex = index;
                };

                listContainer.appendChild(item);
            });

            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.cssText = `
                display: flex;
                gap: 12px;
                justify-content: flex-end;
            `;

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.style.cssText = `
                padding: 10px 20px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.3s;
            `;

            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = '确认';
            confirmBtn.style.cssText = `
                padding: 10px 20px;
                border: none;
                border-radius: 8px;
                background: rgba(0, 164, 220, 1);
                color: #fff;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.3s;
            `;

            buttonsContainer.appendChild(cancelBtn);
            buttonsContainer.appendChild(confirmBtn);

            dialog.appendChild(titleEl);
            dialog.appendChild(listContainer);
            dialog.appendChild(buttonsContainer);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // 添加磨砂玻璃效果层
            const glassLayer = document.createElement('div');
            glassLayer.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(135deg, 
                    rgba(255, 255, 255, 0.1) 0%,
                    rgba(255, 255, 255, 0.05) 50%,
                    rgba(0, 0, 0, 0.1) 100%
                );
                border-radius: 16px;
                pointer-events: none;
                z-index: -1;
            `;
            dialog.appendChild(glassLayer);

            // 确保样式已经应用到页面
            addDanmakuSidebarStyles();

            const cleanup = () => {
                document.body.removeChild(overlay);
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve(null);
            };

            confirmBtn.onclick = () => {
                cleanup();
                resolve(selectedIndex);
            };

            // 添加按钮hover效果
            cancelBtn.onmouseenter = () => {
                cancelBtn.style.background = 'rgba(255, 255, 255, 0.15)';
                cancelBtn.style.transform = 'translateY(-1px)';
            };
            cancelBtn.onmouseleave = () => {
                cancelBtn.style.background = 'rgba(255, 255, 255, 0.1)';
                cancelBtn.style.transform = 'translateY(0)';
            };

            confirmBtn.onmouseenter = () => {
                confirmBtn.style.background = 'rgba(0, 164, 220, 0.8)';
                confirmBtn.style.transform = 'translateY(-1px)';
            };
            confirmBtn.onmouseleave = () => {
                confirmBtn.style.background = 'rgba(0, 164, 220, 1)';
                confirmBtn.style.transform = 'translateY(0)';
            };

            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    cancelBtn.click();
                }
            };

            document.onkeydown = (e) => {
                if (e.key === 'Escape') {
                    cancelBtn.click();
                    document.onkeydown = null;
                } else if (e.key === 'Enter') {
                    confirmBtn.click();
                    document.onkeydown = null;
                }
            };
        });
    }


    // 设置弹幕设置内容
    function setupDanmakuSettings(container) {
        function htmlToElement(html) {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.innerHTML = html;
            return wrapper;
        }

        const categories = {
            controls: [],
            display: [
                htmlToElement(`
            <span id="lbdanmakuDensityLimit" style="flex: auto;">密度限制等级:</span>
            <input style="width: 50%;" type="range" id="danmakuDensityLimit"  min="0" max="3" step="1" value="${window.ede.danmakuDensityLimit}" />
        `),
                htmlToElement(`                            
            <label style="flex: auto;">弹幕防重叠:</label>
            <div><input type="radio" id="enableAntiOverlap" name="useAnitOverlap" value="1" ${(window.ede.useAnitOverlap === 1) ? 'checked' : ''}>
                <label for="enableAntiOverlap">是</label></div>
            <div><input type="radio" id="disableAntiOverlap" name="useAnitOverlap" value="0" ${(window.ede.useAnitOverlap === 0) ? 'checked' : ''}>
                <label for="disableAntiOverlap">否</label></div>
        `),
                htmlToElement(`
            <label style="flex: auto;">简繁转换:</label>
            <div><input type="radio" id="chConvert0" name="chConvert" value="0" ${(window.ede.chConvert === 0) ? 'checked' : ''}>
                <label for="chConvert0">不转换</label></div>
            <div><input type="radio" id="chConvert1" name="chConvert" value="1" ${(window.ede.chConvert === 1) ? 'checked' : ''}>
                <label for="chConvert1">简体</label></div>
            <div><input type="radio" id="chConvert2" name="chConvert" value="2" ${(window.ede.chConvert === 2) ? 'checked' : ''}>
                <label for="chConvert2">繁体</label></div>
        `),
                htmlToElement(`
            <label style="flex: auto;">使用本地xml弹幕:</label>
            <div><input type="radio" id="enableXmlDanmaku" name="useXmlDanmaku" value="1" ${(window.ede.useXmlDanmaku === 1) ? 'checked' : ''}>
                <label for="chConvert0">是</label></div>
            <div><input type="radio" id="disableXmlDanmaku" name="useXmlDanmaku" value="0" ${(window.ede.useXmlDanmaku === 0) ? 'checked' : ''}>
                <label for="chConvert1">否</label></div>
        `),
                htmlToElement(`
            <label style="flex: auto;">当前弹幕偏移时间:</label>
            <div><input style="flex-grow: 1;" id="danmakuOffsetTime" placeholder="秒" value="${window.ede.curEpOffset || 0}" /></div>
        `),
            ],
            style: [
                htmlToElement(`
            <span id="lbopacity" style="flex: auto;">透明度:</span>
            <input style="width: 50%;" type="range" id="opacity" min="0" max="1" step="0.1" value="${window.ede.opacity || 0.7}" />
        `),
                htmlToElement(`
            <span id="lbspeed" style="flex: auto;">弹幕速度:</span>
            <input style="width: 50%;" type="range" id="speed" min="20" max="600" step="10" value="${window.ede.speed || 200}" />
        `),
                htmlToElement(`
            <label style="flex: auto;">字体:</label>
            <div><input style="flex-grow: 1;" id="danmakuFontFamily" placeholder="sans-serif" value="${window.ede.fontFamily?.replaceAll('"', "&quot;") ?? defaultFontFamily}" /></div>
        `),
                htmlToElement(`
            <span id="lbfontSize" style="flex: auto;">字体大小:</span>
            <input style="width: 50%;" type="range" id="fontSize" min="8" max="80" step="1" value="${window.ede.fontSize || 18}" />
        `),
                htmlToElement(`
            <label style="flex: auto;">其他字体选项:</label>
            <div><input style="flex-grow: 1;" id="danmakuFontOptions" placeholder="" value="${window.ede.fontOptions?.replaceAll('"', "&quot;") ?? ""}" /></div>
        `),
                htmlToElement(`
            <span id="lbheightRatio" style="flex: auto;">高度比例:</span>
            <input style="width: 50%;" type="range" id="heightRatio" min="0" max="1" step="0.05" value="${window.ede.heightRatio || 0.9}" />
        `),
            ],
            filter: [
                htmlToElement(`
            <label style="flex: auto;">弹幕过滤:</label>
            <div><input type="checkbox" id="filterBilibili" name="danmakuFilter" value="1" ${((window.ede.danmakuFilter & 1) === 1) ? 'checked' : ''} />
                <label for="filterBilibili">B站</label></div>
            <div><input type="checkbox" id="filterGamer" name="danmakuFilter" value="2" ${((window.ede.danmakuFilter & 2) === 2) ? 'checked' : ''} />
                <label for="filterGamer">巴哈</label></div>
            <div><input type="checkbox" id="filterDanDanPlay" name="danmakuFilter" value="4" ${((window.ede.danmakuFilter & 4) === 4) ? 'checked' : ''} />
                <label for="filterDanDanPlay">弹弹</label></div>
            <div><input type="checkbox" id="filterOthers" name="danmakuFilter" value="8" ${((window.ede.danmakuFilter & 8) === 8) ? 'checked' : ''} />
                <label for="filterOthers">其他</label></div>
        `),
                htmlToElement(`
            <label style="flex: auto;">弹幕类型过滤:</label>
            <div><input type="checkbox" id="filterBottom" name="danmakuModeFilter" value="1" ${((window.ede.danmakuModeFilter & 1) === 1) ? 'checked' : ''} />
                <label for="filterBottom">底部</label></div>
            <div><input type="checkbox" id="filterTop" name="danmakuModeFilter" value="2" ${((window.ede.danmakuModeFilter & 2) === 2) ? 'checked' : ''} />
                <label for="filterTop">顶部</label></div>
            <div><input type="checkbox" id="filterRoll" name="danmakuModeFilter" value="4" ${((window.ede.danmakuModeFilter & 4) === 4) ? 'checked' : ''} />
                <label for="filterRoll">滚动</label></div>
        `),
            ],
        };


        // 创建控制功能卡片
        const controlItems = createControlFunctions();
        if (controlItems && controlItems.length > 0) {
            categories.controls.push(...controlItems);
        }

        // 清空容器
        container.innerHTML = '';

        // 创建标签页结构
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'danmaku-tabs-container';
        tabsContainer.style.cssText = `
        display: flex;
        overflow-x: auto;
        padding: 16px 20px;
        background: rgba(0, 0, 0, 0.2);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        scrollbar-width: thin;
        scrollbar-color: rgba(0, 164, 220, 0.5) rgba(0, 0, 0, 0.1);
        margin: -16px -16px 20px -16px;
        backdrop-filter: blur(10px);
        gap: 4px;
    `;

        container.appendChild(tabsContainer);

        const tabs = [
            { id: 'controls', title: '控制功能', items: categories.controls },
            { id: 'style', title: '显示样式', items: categories.style },
            { id: 'display', title: '显示设置', items: categories.display },
            { id: 'filter', title: '过滤设置', items: categories.filter },
        ];

        // 先清空容器的旧内容（除了tabsContainer）
        Array.from(container.children)
            .filter(child => child !== tabsContainer)
            .forEach(child => child.remove());

        // 一次性创建所有标签页内容区域，并加入container
        tabs.forEach(tab => {
            const tabContent = document.createElement('div');
            tabContent.className = 'danmaku-tab-content';
            tabContent.dataset.tabId = tab.id;
            // 默认隐藏，后面根据activeTabId显示
            tabContent.style.display = 'none';
            tabContent.style.padding = '10px 0';

            if (tab.id === 'controls') {
                tabContent.style.display = 'flex'; // 作为默认显示，flex布局
                tabContent.style.flexWrap = 'wrap';
                tabContent.style.gap = '16px';
                tabContent.style.marginBottom = '20px';
                tabContent.style.padding = '0';

                tab.items.forEach(item => {
                    tabContent.appendChild(item);
                });
            } else {
                tab.items.forEach(item => {
                    styleSettingItemForContent(item);
                    tabContent.appendChild(item);
                });
            }

            container.appendChild(tabContent);
        });

        // 设置默认活动标签
        let activeTabId = tabs.length > 0 ? tabs[0].id : null;

        // 创建标签按钮并绑定切换事件
        tabs.forEach(tab => {
            const tabButton = document.createElement('button');
            tabButton.textContent = tab.title;
            tabButton.dataset.tabId = tab.id;
            tabButton.className = 'danmaku-tab-button';
            tabButton.style.cssText = `
            padding: 10px 18px;
            border: none;
            border-radius: 8px;
            background: ${tab.id === activeTabId ? 'rgba(0, 164, 220, 1)' : 'rgba(255, 255, 255, 0.08)'};
            color: white;
            font-weight: ${tab.id === activeTabId ? '600' : '500'};
            font-size: 14px;
            cursor: pointer;
            white-space: nowrap;
            flex-shrink: 0;
            border: 1px solid ${tab.id === activeTabId ? 'transparent' : 'rgba(255, 255, 255, 0.1)'};
            backdrop-filter: blur(10px);
        `;

            tabButton.addEventListener('click', function () {
                // 切换按钮样式
                document.querySelectorAll('.danmaku-tab-button').forEach(btn => {
                    btn.style.background = 'rgba(255, 255, 255, 0.08)';
                    btn.style.fontWeight = '500';
                    btn.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                });
                this.style.background = 'rgba(0, 164, 220, 1)';
                this.style.fontWeight = '600';
                this.style.borderColor = 'transparent';

                // 显示对应标签内容
                showTabContent(this.dataset.tabId);
            });

            tabsContainer.appendChild(tabButton);
        });

        // 切换显示标签内容
        function showTabContent(tabId) {
            activeTabId = tabId;

            // 隐藏所有标签页内容
            container.querySelectorAll('.danmaku-tab-content').forEach(div => {
                div.style.display = 'none';
            });

            // 显示当前激活的标签内容
            const activeContent = container.querySelector(`.danmaku-tab-content[data-tab-id="${tabId}"]`);
            if (activeContent) {
                if (tabId === 'controls') {
                    activeContent.style.display = 'flex'; // controls使用flex布局
                } else {
                    activeContent.style.display = 'block';
                }
            }
        }
        document.getElementById('danmakuFontOptions').addEventListener('keydown', event => event.stopPropagation(), true);
        document.getElementById('danmakuFontFamily').addEventListener('keydown', event => event.stopPropagation(), true);
        document.getElementById('danmakuOffsetTime').addEventListener('keydown', event => event.stopPropagation(), true);
        // 初始化显示默认标签内容
        if (activeTabId) {
            showTabContent(activeTabId);
        }
    }

    // 创建控制功能区域
    function createControlFunctions() {
        const controlItems = [];
        // 添加弹幕开关控制项
        {
            let isDanmukuEnabled = window.localStorage.getItem('danmakuSwitch') === '1';
            const danmakuSwitchItem = document.createElement('div');
            danmakuSwitchItem.className = 'control-item control-card';
            danmakuSwitchItem.style.cssText = `
                display: flex;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                min-height: 64px;
                flex: 1 1 calc(50% - 8px);
                min-width: 280px;
                backdrop-filter: blur(10px);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            `;

            danmakuSwitchItem.innerHTML = `
                <div class="control-info" style="display: flex; align-items: center; flex: 1;">
                    <div class="control-text">
                        <div style="font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 2px;">弹幕显示</div>
                        <div style="font-size: 12px; color: rgba(255, 255, 255, 0.7);">控制弹幕的显示与隐藏</div>
                    </div>
                </div>
                <label class="modern-switch">
                    <input type="checkbox" ${isDanmukuEnabled ? 'checked' : ''}>
                    <span class="modern-slider"></span>
                </label>
            `;

            // 添加hover效果
            danmakuSwitchItem.addEventListener('mouseenter', function () {
                this.style.background = 'linear-gradient(135deg, rgba(0, 164, 220, 0.12), rgba(0, 164, 219, 0.12))';
                this.style.border = '2px solid rgba(0, 164, 220, 0.4)';
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 8px 25px rgba(0, 164, 220, 0.15)';
            });

            danmakuSwitchItem.addEventListener('mouseleave', function () {
                this.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))';
                this.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
            });

            const checkbox = danmakuSwitchItem.querySelector('input[type="checkbox"]');
            const switchLabel = danmakuSwitchItem.querySelector('.modern-switch');

            // 为checkbox添加change事件
            checkbox.addEventListener('change', function (e) {
                e.stopPropagation();
                danmuShowSwitch();
            });

            // 为了修复Firefox兼容性问题，为label添加点击事件
            if (isFirefox()) {
                switchLabel.addEventListener('click', function (e) {
                    // 防止点击事件冒泡到卡片
                    e.stopPropagation();

                    // 如果点击的不是checkbox本身，手动切换checkbox状态
                    if (e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                        // 手动触发change事件
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            }

            controlItems.push(danmakuSwitchItem);
        }

        // 添加日志开关控制项
        {
            let isLogEnabled = window.localStorage.getItem('logSwitch') === '1';
            const logSwitchItem = document.createElement('div');
            logSwitchItem.className = 'control-item control-card';
            logSwitchItem.style.cssText = `
                display: flex;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                min-height: 64px;
                flex: 1 1 calc(50% - 8px);
                min-width: 280px;
                backdrop-filter: blur(10px);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            `;

            logSwitchItem.innerHTML = `
                <div class="control-info" style="display: flex; align-items: center; flex: 1;">
                    <div class="control-text">
                        <div style="font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 2px;">日志显示</div>
                        <div style="font-size: 12px; color: rgba(255, 255, 255, 0.7);">显示调试信息和日志</div>
                    </div>
                </div>
                <label class="modern-switch">
                    <input type="checkbox" ${isLogEnabled ? 'checked' : ''}>
                    <span class="modern-slider"></span>
                </label>
            `;

            // 添加hover效果
            logSwitchItem.addEventListener('mouseenter', function () {
                this.style.background = 'linear-gradient(135deg, rgba(76, 175, 80, 0.12), rgba(33, 150, 243, 0.12))';
                this.style.borderColor = 'rgba(76, 175, 80, 0.4)';
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 8px 25px rgba(76, 175, 80, 0.15)';
            });

            logSwitchItem.addEventListener('mouseleave', function () {
                this.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))';
                this.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
            });

            const checkbox = logSwitchItem.querySelector('input[type="checkbox"]');
            const switchLabel = logSwitchItem.querySelector('.modern-switch');

            // 为checkbox添加change事件
            checkbox.addEventListener('change', function (e) {
                e.stopPropagation();
                if (window.ede.loading) {
                    showDebugInfo('正在加载,请稍后再试');
                    return;
                }
                window.ede.logSwitch = (window.ede.logSwitch + 1) % 2;
                window.localStorage.setItem('logSwitch', window.ede.logSwitch);
                let logSpan = document.querySelector('#debugInfo');
                if (logSpan) {
                    window.ede.logSwitch == 1 ? (logSpan.style.display = 'block') && showDebugInfo('开启日志显示') : (logSpan.style.display = 'none');
                }
            });

            // 为了修复Firefox兼容性问题，为label添加点击事件
            if (isFirefox()) {
                switchLabel.addEventListener('click', function (e) {
                    // 防止点击事件冒泡到卡片
                    e.stopPropagation();

                    // 如果点击的不是checkbox本身，手动切换checkbox状态
                    if (e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                        // 手动触发change事件
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            }
            controlItems.push(logSwitchItem);
        }

        // 添加搜索弹幕控制项
        {
            const searchItem = document.createElement('div');
            searchItem.className = 'control-item control-card';
            searchItem.style.cssText = `
                display: flex;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                min-height: 64px;
                flex: 1 1 calc(50% - 8px);
                min-width: 280px;
                backdrop-filter: blur(10px);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            `;

            searchItem.innerHTML = `
                <div class="control-info" style="display: flex; align-items: center; flex: 1;">
                    <div class="control-text">
                        <div style="font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 2px;">弹幕搜索</div>
                        <div style="font-size: 12px; color: rgba(255, 255, 255, 0.7);">搜索视频弹幕</div>
                    </div>
                </div>
                <div class="control-action" style="
                    padding: 6px 12px;
                    background: rgba(0, 188, 212, 0.15);
                    border-radius: 6px;
                    color: #00BCD4;
                    font-size: 12px;
                    font-weight: 500;
                    border: 1px solid rgba(0, 188, 212, 0.25);
                ">搜索</div>
            `;

            searchItem.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                // searchButton.click();
                if (window.ede.loading) {
                    showDebugInfo('正在加载,请稍后再试');
                    return;
                }
                showDebugInfo('手动匹配弹幕');
                reloadDanmaku('search');
            });

            searchItem.addEventListener('mouseenter', function () {
                this.style.background = 'linear-gradient(135deg, rgba(0, 188, 212, 0.12), rgba(0, 229, 255, 0.12))';
                this.style.borderColor = 'rgba(0, 188, 212, 0.4)';
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 8px 25px rgba(0, 188, 212, 0.15)';
            });

            searchItem.addEventListener('mouseleave', function () {
                this.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))';
                this.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
            });

            controlItems.push(searchItem);
        }

        // 添加增加弹幕源控制项
        {
            const addSourceItem = document.createElement('div');
            addSourceItem.className = 'control-item control-card';
            addSourceItem.style.cssText = `
                display: flex;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                min-height: 64px;
                flex: 1 1 calc(50% - 8px);
                min-width: 280px;
                backdrop-filter: blur(10px);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            `;

            addSourceItem.innerHTML = `
                <div class="control-info" style="display: flex; align-items: center; flex: 1;">
                    <div class="control-text">
                        <div style="font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 2px;">增加弹幕源</div>
                        <div style="font-size: 12px; color: rgba(255, 255, 255, 0.7);">添加新的弹幕数据源，如B站播放链接</div>
                    </div>
                </div>
                <div class="control-action" style="
                    padding: 6px 12px;
                    background: rgba(255, 152, 0, 0.15);
                    border-radius: 6px;
                    color: #FF9800;
                    font-size: 12px;
                    font-weight: 500;
                    border: 1px solid rgba(255, 152, 0, 0.25);
                ">添加</div>
            `;

            addSourceItem.addEventListener('click', async function (e) {
                e.preventDefault();
                e.stopPropagation();
                // addSourceButton.click();
                showDebugInfo('手动增加弹幕源');
                let source = await createInputDialog('添加弹幕源', '请输入弹幕源地址(如B站播放链接)', '');
                if (source) {
                    getCommentsByUrl(source)
                        .then(comments => {
                            if (comments !== null) {
                                createDanmaku(comments)
                                    .then(() => {
                                        showDebugInfo('弹幕就位');

                                        // 如果已经登录，把弹幕源提交给弹弹Play
                                        if (ddplayStatus.isLogin) {
                                            postRelatedSource(source);
                                        }
                                    })
                                    .catch(error => {
                                        console.error('创建弹幕失败:', error);
                                    });
                            }
                        }
                        )
                } else {
                    showDebugInfo('未获取弹幕源地址');
                }
            });

            addSourceItem.addEventListener('mouseenter', function () {
                this.style.background = 'linear-gradient(135deg, rgba(255, 152, 0, 0.12), rgba(255, 193, 7, 0.12))';
                this.style.borderColor = 'rgba(255, 152, 0, 0.4)';
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 8px 25px rgba(255, 152, 0, 0.15)';
            });

            addSourceItem.addEventListener('mouseleave', function () {
                this.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))';
                this.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
            });

            controlItems.push(addSourceItem);
            // }
        }

        return controlItems.length > 0 ? controlItems : null;
    }

    // 添加弹幕设置到播放器设置菜单
    function addDanmakuSettingsToMenu(actionSheet) {
        console.log('[Danmaku Settings] 检测到播放器设置菜单');

        // 为播放器设置菜单添加特殊标识类
        actionSheet.classList.add('video-player-settings-menu');

        const scroller = actionSheet.querySelector('.actionSheetScroller');
        if (!scroller || scroller.querySelector('[data-id="danmaku-settings"]')) {
            console.log('[Danmaku Settings] 菜单已存在或找不到滚动容器');
            return;
        }

        // 延迟执行，确保菜单完全加载
        setTimeout(() => {
            // 创建弹幕设置菜单项
            const danmakuMenuItem = document.createElement('button');
            danmakuMenuItem.setAttribute('is', 'emby-button');
            danmakuMenuItem.setAttribute('type', 'button');
            danmakuMenuItem.className = 'listItem listItem-button actionSheetMenuItem emby-button';
            danmakuMenuItem.setAttribute('data-id', 'danmaku-settings');

            danmakuMenuItem.innerHTML = `
                <div class="listItemBody actionsheetListItemBody">
                    <div class="listItemBodyText actionSheetItemText">弹幕设置</div>
                </div>
            `;

            // 添加点击事件
            danmakuMenuItem.addEventListener('click', function (e) {
                console.log('[Danmaku Settings] 弹幕设置菜单项被点击');

                createDanmakuSidebar();
            });

            // 将弹幕设置添加到循环模式之前，如果没有循环模式就添加到播放信息之前
            const repeatModeItem = scroller.querySelector('[data-id="repeatmode"]');
            const statsItem = scroller.querySelector('[data-id="stats"]');

            if (repeatModeItem) {
                scroller.insertBefore(danmakuMenuItem, repeatModeItem);
            } else if (statsItem) {
                scroller.insertBefore(danmakuMenuItem, statsItem);
            } else {
                scroller.appendChild(danmakuMenuItem);
            }

            console.log('[Danmaku Settings] 弹幕设置已添加到播放器设置菜单');
        }, 50);
    }

    // 监听DOM变化，检测弹幕设置对话框的创建
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) {
                    // 检测播放器设置菜单的创建 - 更精确的选择器
                    if (node.classList && node.classList.contains('actionSheet') &&
                        node.querySelector('[data-id="aspectratio"]') &&
                        node.querySelector('[data-id="playbackrate"]')) {
                        addDanmakuSettingsToMenu(node);
                    }
                    // 也检查子节点，以防菜单是在容器内添加的
                    const actionSheet = node.querySelector && node.querySelector('.actionSheet');
                    if (actionSheet &&
                        actionSheet.querySelector('[data-id="aspectratio"]') &&
                        actionSheet.querySelector('[data-id="playbackrate"]')) {
                        addDanmakuSettingsToMenu(actionSheet);
                    }
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    const parseFloatOfRange = (str, lb, hb) => {
        let parsedValue = parseFloat(str);
        if (isNaN(parsedValue)) {
            throw new Error('输入无效!');
        }
        return Math.min(Math.max(parsedValue, lb), hb);
    };

    function createButton(opt) {
        let button = document.createElement('button');
        button.className = buttonOptions.class;
        button.setAttribute('is', buttonOptions.is);
        button.setAttribute('title', opt.title);
        button.setAttribute('id', opt.id);
        let icon = document.createElement('span');
        icon.className = spanClass + opt.class;
        button.appendChild(icon);
        button.onclick = opt.onclick;
        return button;
    }

    function initListener() {
        let container = document.querySelector(mediaQueryStr);
        // 页面未加载
        if (!container) {
            if (window.ede.episode_info) {
                window.ede.episode_info = null;
            }
            return;
        }
    }

    function initUI() {
        // 页面未加载
        let uiAnchor = document.getElementsByClassName(uiAnchorStr);
        if (!uiAnchor || !uiAnchor[0]) {
            return;
        }
        // 已初始化
        if (document.getElementById('danmakuCtr')) {
            return;
        }
        showDebugInfo('正在初始化UI');
        // 弹幕按钮容器div
        let uiEle = null;
        document.querySelectorAll(uiQueryStr).forEach(function (element) {
            if (element.offsetParent != null) {
                uiEle = element.parentNode;
            }
        });
        if (uiEle == null) {
            return;
        }

        let parent = uiEle.parentNode;
        let menubar = document.createElement('div');
        menubar.id = 'danmakuCtr';
        if (!window.ede.episode_info) {
            menubar.style.opacity = 0.5;
        }

        parent.insertBefore(menubar, uiEle.nextSibling);
        // 弹幕开关
        displayButtonOpts.class = danmaku_icons[window.ede.danmakuSwitch];
        menubar.appendChild(createButton(displayButtonOpts));
        // 发送弹幕
        // menubar.appendChild(createButton(sendDanmakuOpts));

        let _container = null;
        document.querySelectorAll(mediaContainerQueryStr).forEach(function (element) {
            if (!element.classList.contains('hide')) {
                _container = element;
            }
        });
        let span = document.createElement('span');
        span.id = 'debugInfo';
        span.style.position = 'absolute';
        span.style.overflow = 'auto';
        span.style.zIndex = '99';
        span.style.right = '50px';
        span.style.top = '50px';
        span.style.background = 'rgba(28, 28, 28, .8)';
        span.style.color = '#fff';
        span.style.padding = '20px';
        span.style.borderRadius = '.3em';
        span.style.maxHeight = '50%'
        window.ede.logSwitch == 1 ? (span.style.display = 'block') : (span.style.display = 'none');
        _container.appendChild(span);


        showDebugInfo('UI初始化完成');
        reloadDanmaku('init');
        refreshDanDanPlayToken();
    }

    async function loginDanDanPlay(account, passwd) {
        const loginUrl = authPrefix + '/api/v2/login';
        const params = {
            'userName': account,
            'password': passwd
        };

        try {
            const resp = await fetch(loginUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': navigator.userAgent
                },
                body: JSON.stringify(params)
            });

            if (resp.status !== 200) {
                showDebugInfo('登录失败 http error:' + resp.status);
                alert('登录失败 http error:' + resp.status);
                return false;
            }

            const json = await resp.json();
            if (json.errorCode !== 0) {
                showDebugInfo('登录失败 ' + json.errorMessage);
                alert('登录失败 ' + json.errorMessage);
                return false;
            }

            ddplayStatus.isLogin = true;
            ddplayStatus.token = json.token;
            ddplayStatus.tokenExpire = json.tokenExpireTime;
            window.localStorage.setItem('ddplayStatus', JSON.stringify(ddplayStatus));
            showDebugInfo('登录成功');
            return true;
        } catch (error) {
            console.error('登录失败', error);
            alert('登录失败');
            return false;
        }
    }

    async function refreshDanDanPlayToken() {
        if (ddplayStatus.isLogin) {
            const now = Math.floor(Date.now() / 1000);
            const expire = new Date(ddplayStatus.tokenExpire).getTime() / 1000;
            if (expire < now) {
                ddplayStatus.isLogin = false;
                return;
            } else if (expire - now > 259200) { // Token expires in more than 3 days, no need to refresh
                return;
            } else { // Refresh token before 3 days
                const refreshUrl = apiPrefix + '/api/v2/login/renew';
                try {
                    const resp = await fetch(refreshUrl, {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                            'User-Agent': navigator.userAgent,
                            'Authorization': 'Bearer ' + ddplayStatus.token
                        }
                    });

                    if (resp.status !== 200) {
                        showDebugInfo('刷新弹弹Play Token失败 http error:' + resp.status);
                        return;
                    }

                    const json = await resp.json();
                    if (json.errorCode === 0) {
                        ddplayStatus.isLogin = true;
                        ddplayStatus.token = json.token;
                        ddplayStatus.tokenExpire = json.tokenExpireTime;
                    } else {
                        showDebugInfo('刷新弹弹Play Token失败');
                        showDebugInfo(json.errorMessage);
                    }
                } catch (error) {
                    console.error('刷新弹弹Play Token失败', error);
                }
            }
        }
    }

    async function sendDanmaku(danmakuText, time, mode = 1, color = 0xffffff) {
        if (ddplayStatus.isLogin) {
            if (!window.ede.episode_info || !window.ede.episode_info.episodeId) {
                showDebugInfo('发送弹幕失败 未获取到弹幕信息');
                alert('请先获取弹幕信息');
                return;
            }
            const danmakuUrl = apiPrefix + '/api/v2/comment/' + window.ede.episode_info.episodeId;
            const params = {
                'time': time,
                'mode': mode,
                'color': color,
                'comment': danmakuText
            };
            try {
                const resp = await fetch(danmakuUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'User-Agent': navigator.userAgent,
                        'Authorization': 'Bearer ' + ddplayStatus.token
                    },
                    body: JSON.stringify(params)
                });

                if (resp.status !== 200) {
                    showDebugInfo('发送弹幕失败 http error:' + resp.status);
                    return;
                }

                const json = await resp.json();
                if (json.errorCode === 0) {
                    const colorStr = `000000${color.toString(16)}`.slice(-6);
                    const modemap = { 6: 'ltr', 1: 'rtl', 5: 'top', 4: 'bottom' }[mode];
                    const comment = {
                        text: danmakuText,
                        mode: modemap,
                        time: time,
                        style: {
                            font: `${window.ede.fontOptions} ${window.ede.fontSize}px ${window.ede.fontFamily}`,
                            fillStyle: `#${colorStr}`,
                            strokeStyle: colorStr === '000000' ? '#fff' : '#000',
                            lineWidth: 2.0,
                        },
                    };
                    window.ede.danmaku.emit(comment);
                    showDebugInfo('发送弹幕成功');
                } else {
                    showDebugInfo('发送弹幕失败');
                    showDebugInfo(json.errorMessage);
                    alert('发送失败：' + json.errorMessage);
                }
            } catch (error) {
                console.error('发送弹幕失败', error);
                showDebugInfo('发送弹幕失败');
            }
        }
    }

    async function postRelatedSource(relatedUrl) {
        if (!ddplayStatus.isLogin) {
            showDebugInfo('发送相关链接失败 未登录');
            alert('请先登录');
            return;
        }
        if (!window.ede.episode_info || !window.ede.episode_info.episodeId) {
            showDebugInfo('发送弹幕失败 未获取到弹幕信息');
            alert('请先获取弹幕信息');
            return;
        }
        const url = apiPrefix + '/api/v2/related/' + window.ede.episode_info.episodeId;
        const params = {
            'episodeId': window.ede.episode_info.episodeId,
            'url': relatedUrl,
            'shift': 0
        };
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': navigator.userAgent,
                    'Authorization': 'Bearer ' + ddplayStatus.token
                },
                body: JSON.stringify(params)
            });
            if (resp.status !== 200) {
                showDebugInfo('发送相关链接失败 http error:' + resp.code);
                return;
            }
            const json = await resp.json();
            if (json.errorCode === 0) {
                showDebugInfo('发送相关链接成功');
            } else {
                showDebugInfo('发送相关链接失败');
                showDebugInfo(json.errorMessage);
                alert('弹幕源提交弹弹Play失败：' + json.errorMessage);
            }
        } catch (error) {
            console.error('发送相关链接失败', error);
            showDebugInfo('发送相关链接失败');
        }
    }

    async function showDebugInfo(msg) {
        let span = document.getElementById('debugInfo');
        while (!span) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            span = document.getElementById('debugInfo');
        }
        let msgStr = msg;
        if (typeof msg !== 'string') {
            msgStr = JSON.stringify(msg);
        }

        let lastLine = span.innerHTML.slice(span.innerHTML.lastIndexOf('<br>') + 4);
        let baseLine = lastLine.replace(/ X\d+$/, '');
        if (baseLine === msgStr) {
            let count = 2;
            if (lastLine.match(/ X(\d+)$/)) {
                count = parseInt(lastLine.match(/ X(\d+)$/)[1]) + 1;
            }
            msgStr = `${msgStr} X${count}`;
            span.innerHTML = span.innerHTML.slice(0, span.innerHTML.lastIndexOf('<br>') + 4) + msgStr;
        } else {
            span.innerHTML += span.innerHTML === '' ? msgStr : '<br>' + msgStr;
        }

        console.log(msg);
    }

    async function getEmbyItemInfo() {
        let playingInfo = null;
        while (!playingInfo) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            if (isNewJellyfin) {
                // params: userId, itemId
                playingInfo = await ApiClient.getItem(ApiClient.getCurrentUserId(), itemId);
            } else {
                let sessionInfo = await ApiClient.getSessions({
                    userId: ApiClient.getCurrentUserId(),
                    deviceId: ApiClient.deviceId(),
                });
                if (!sessionInfo[0].NowPlayingItem) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                    continue;
                }
                playingInfo = sessionInfo[0].NowPlayingItem;
            }
        }
        showDebugInfo('获取Item信息成功: ' + (playingInfo.SeriesName || playingInfo.Name));
        return playingInfo;
    }

    function makeGetRequest(url) {
        return fetch(url, {
            method: 'GET',
            headers: {
                "Accept-Encoding": "gzip,br",
                "Accept": "application/json",
                "User-Agent": navigator.userAgent
            }
        });
    }

    async function getEpisodeInfo(is_auto = true) {
        let item = await getEmbyItemInfo();
        if (!item) {
            return null;
        }
        let _id;
        let animeName;
        let anime_id = -1;
        let episode;
        _id = item.SeasonId || item.Id;
        animeName = item.SeriesName || item.Name;
        episode = item.IndexNumber || 1;
        let session = item.ParentIndexNumber;
        if (session > 1) {
            animeName += session;
        }
        let _id_key = '_anime_id_rel_' + _id;
        let _name_key = '_anime_name_rel_' + _id;
        let _episode_key = '_episode_id_rel_' + _id + '_' + episode;
        if (is_auto) {
            //优先使用记忆设置
            if (window.localStorage.getItem(_episode_key)) {
                const episodeInfo = JSON.parse(window.localStorage.getItem(_episode_key));
                return episodeInfo;
            }
        }
        if (window.localStorage.getItem(_id_key)) {
            anime_id = window.localStorage.getItem(_id_key);
        }
        if (window.localStorage.getItem(_name_key)) {
            animeName = window.localStorage.getItem(_name_key);
        }
        if (!is_auto) {
            animeName = await createInputDialog('确认动画名', '请输入动画名称', animeName);
            if (animeName == null || animeName == '') {
                return null;
            }
        }
        const _episode_key_offset = _episode_key + '_offset';
        if (window.ede.curEpOffsetModified) {
            window.localStorage.setItem(_episode_key_offset, window.ede.curEpOffset);
        }
        window.ede.curEpOffset = window.localStorage.getItem(_episode_key_offset) || 0;

        let searchUrl = apiPrefix + '/api/v2/search/episodes?anime=' + animeName;
        let animaInfo = await makeGetRequest(searchUrl)
            .then((response) => response.json())
            .catch((error) => {
                showDebugInfo('查询失败:', error);
                return null;
            });
        if (animaInfo.animes.length == 0) {
            const seriesInfo = await ApiClient.getItem(ApiClient.getCurrentUserId(), item.SeriesId || item.Id);
            animeName = seriesInfo.OriginalTitle;
            if (animeName?.length > 0) {
                searchUrl = apiPrefix + '/api/v2/search/episodes?anime=' + animeName;
                animaInfo = await makeGetRequest(searchUrl)
                    .then((response) => response.json())
                    .catch((error) => {
                        showDebugInfo('查询失败:', error);
                        return null;
                    });
            }
        }
        if (animaInfo.animes.length == 0) {
            showDebugInfo('弹幕查询无结果');
            return null;
        }
        showDebugInfo('节目查询成功');

        let selecAnime_id = 1;
        if (anime_id != -1) {
            for (let index = 0; index < animaInfo.animes.length; index++) {
                if (animaInfo.animes[index].animeId == anime_id) {
                    selecAnime_id = index + 1;
                }
            }
        }
        if (!is_auto) {
            let anime_lists_str = list2string(animaInfo);
            showDebugInfo(anime_lists_str);

            // 创建选项数组供对话框使用
            const animeOptions = animaInfo.animes.map((anime) => {
                return anime.animeTitle + ' 类型:' + anime.typeDescription;
            });

            const selectedAnimeIndex = await createSelectDialog('选择节目', animeOptions, selecAnime_id - 1);
            if (selectedAnimeIndex === null) {
                return null;
            }
            selecAnime_id = selectedAnimeIndex;

            window.localStorage.setItem(_id_key, animaInfo.animes[selecAnime_id].animeId);
            window.localStorage.setItem(_name_key, animaInfo.animes[selecAnime_id].animeTitle);

            let episode_lists_str = ep2string(animaInfo.animes[selecAnime_id].episodes);

            // 创建剧集选项数组
            const episodeOptions = animaInfo.animes[selecAnime_id].episodes.map((ep) => {
                return ep.episodeTitle;
            });

            const selectedEpisodeIndex = await createSelectDialog('选择剧集', episodeOptions, (parseInt(episode) || 1) - 1);
            if (selectedEpisodeIndex === null) {
                return null;
            }
            episode = selectedEpisodeIndex;
        } else {
            selecAnime_id = parseInt(selecAnime_id) - 1;
            let initialTitle = animaInfo.animes[selecAnime_id].episodes[0].episodeTitle;
            const match = initialTitle.match(/第(\d+)话/);
            const initialep = match ? parseInt(match[1]) : 1;
            episode = (parseInt(episode) < initialep) ? parseInt(episode) - 1 : (parseInt(episode) - initialep);
        }

        if (episode + 1 > animaInfo.animes[selecAnime_id].episodes.length) {
            showDebugInfo('剧集不存在');
            return null;
        }

        const epTitlePrefix = animaInfo.animes[selecAnime_id].type === 'tvseries' ? `S${session}E${episode + 1}` : (animaInfo.animes[selecAnime_id].type);
        let episodeInfo = {
            episodeId: animaInfo.animes[selecAnime_id].episodes[episode].episodeId,
            animeTitle: animaInfo.animes[selecAnime_id].animeTitle,
            episodeTitle: epTitlePrefix + ' ' + animaInfo.animes[selecAnime_id].episodes[episode].episodeTitle,
        };
        window.localStorage.setItem(_episode_key, JSON.stringify(episodeInfo));
        return episodeInfo;
    }

    async function getComments(episodeId) {
        const { danmakuFilter } = window.ede;
        const url_all = apiPrefix + '/api/v2/comment/' + episodeId + '?withRelated=true&chConvert=' + window.ede.chConvert;
        const url_related = apiPrefix + '/api/v2/related/' + episodeId;
        const url_ext = apiPrefix + '/api/v2/extcomment?chConvert=' + window.ede.chConvert + '&url=';
        try {
            let response = await makeGetRequest(url_all);
            let data = await response.json();
            const matchBili = /^\[BiliBili\]/;
            let hasBili = false;
            if ((danmakuFilter & 1) !== 1) {
                for (const c of data.comments) {
                    if (matchBili.test(c.p.split(',').pop())) {
                        hasBili = true;
                        break;
                    }
                }
            }
            let comments = data.comments;
            response = await makeGetRequest(url_related);
            data = await response.json();
            showDebugInfo('第三方弹幕源个数：' + data.relateds.length);

            if (data.relateds.length > 0) {
                // 根据设置过滤弹幕源
                let src = [];
                for (const s of data.relateds) {
                    if ((danmakuFilter & 1) !== 1 && !hasBili && s.url.includes('bilibili.com/bangumi')) {
                        src.push(s.url);
                    }
                    if ((danmakuFilter & 1) !== 1 && s.url.includes('bilibili.com/video')) {
                        src.push(s.url);
                    }
                    if ((danmakuFilter & 2) !== 2 && s.url.includes('gamer')) {
                        src.push(s.url);
                    }
                    if ((danmakuFilter & 8) !== 8 && !s.url.includes('bilibili') && !s.url.includes('gamer')) {
                        src.push(s.url);
                    }
                }
                // 获取第三方弹幕
                await Promise.all(src.map(async (s) => {
                    const response = await makeGetRequest(url_ext + encodeURIComponent(s));
                    const data = await response.json();
                    comments = comments.concat(data.comments);
                }));
            }
            showDebugInfo('弹幕下载成功: ' + comments.length);
            return comments;
        } catch (error) {
            showDebugInfo('获取弹幕失败:', error);
            return null;
        }
    }

    async function getCommentsByUrl(src) {
        const url_encoded = encodeURIComponent(src);
        const url = apiPrefix + '/api/v2/extcomment?chConvert=' + window.ede.chConvert + '&url=' + url_encoded;
        for (let i = 0; i < 2; i++) {
            try {
                const response = await makeGetRequest(url);
                const data = await response.json();
                showDebugInfo('弹幕下载成功: ' + data.comments.length);
                return data.comments;
            } catch (error) {
                showDebugInfo('获取弹幕失败:', error);
            }
        }
        return null;
    }

    async function getItemId() {
        let item = await getEmbyItemInfo();
        if (!item) {
            return null;
        }
        return item.Id || null;
    }

    async function getCommentsByPluginApi(jellyfinItemId) {
        const path = window.location.pathname.replace(/\/web\/(index\.html)?/, '/api/danmu/');
        const url = window.location.origin + path + jellyfinItemId + '/raw';
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }
        const xmlText = await response.text();
        if (!xmlText || xmlText.length === 0) {
            return null;
        }

        // parse the xml data
        // xml data: <d p="392.00000,1,25,16777215,0,0,[BiliBili]e6860b30,1723088443,1">弹幕内容</d>
        //           <d p="stime, type, fontSize, color, date, pool, sender, dbid, unknown">content</d>
        // comment data: {cid: "1723088443", p: "392.00,1,16777215,[BiliBili]e6860b30", m: "弹幕内容"}
        //               {cid: "dbid", p: "stime, type, color, sender", m: "content"}
        try {
            const parser = new DOMParser();
            const data = parser.parseFromString(xmlText, 'text/xml');
            const comments = [];

            for (const comment of data.getElementsByTagName('d')) {
                const p = comment.getAttribute('p').split(',').map(Number);
                const commentData = {
                    cid: p[7],
                    p: p[0] + ',' + p[1] + ',' + p[3] + ',' + p[6],
                    m: comment.textContent
                };
                comments.push(commentData);
            }

            return comments;
        } catch (error) {
            return null;
        }
    }

    async function createDanmaku(comments) {
        if (!window.obVideo) {
            window.obVideo = new MutationObserver((mutationList, _observer) => {
                for (let mutationRecord of mutationList) {
                    if (mutationRecord.removedNodes) {
                        for (let removedNode of mutationRecord.removedNodes) {
                            if (removedNode.className && removedNode.classList.contains('videoPlayerContainer')) {
                                console.log('[Jellyfin-Danmaku] Video Removed');
                                window.ede.loading = false;
                                document.getElementById('danmakuInfoTitle')?.remove();
                                const wrapper = document.getElementById('danmakuWrapper');
                                if (wrapper) wrapper.style.display = 'none';
                                return;
                            }
                        }
                    }
                    if (mutationRecord.addedNodes) {
                        for (let addedNode of mutationRecord.addedNodes) {
                            if (addedNode.className && addedNode.classList.contains('videoPlayerContainer')) {
                                console.log('[Jellyfin-Danmaku] Video Added');
                                reloadDanmaku('refresh');
                                return;
                            }
                        }
                    }
                }
            });

            window.obVideo.observe(document.body, { childList: true });
        }

        if (!comments) {
            showDebugInfo('无弹幕');
            return;
        }

        let wrapper = document.getElementById('danmakuWrapper');
        wrapper && wrapper.remove();

        if (window.ede.danmaku) {
            window.ede.danmaku.clear();
            window.ede.danmaku.destroy();
            window.ede.danmaku = null;
        }

        const waitForMediaContainer = async () => {
            while (!document.querySelector(mediaContainerQueryStr)?.children.length) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        };

        await waitForMediaContainer();

        let _container = null;
        document.querySelectorAll(mediaContainerQueryStr).forEach((element) => {
            if (!element.classList.contains('hide')) {
                _container = element;
            }
        });
        if (!_container) {
            showDebugInfo('未找到播放器');
            return;
        }

        let _comments = preProcessDanmaku(comments, _container.offsetWidth, _container.offsetHeight);

        showDebugInfo(`弹幕加载成功: ${_comments.length}`);
        showDebugInfo(`弹幕透明度：${window.ede.opacity}`);
        showDebugInfo(`弹幕速度：${window.ede.speed}`);
        showDebugInfo(`弹幕高度比例：${window.ede.heightRatio}`);
        showDebugInfo(`弹幕来源过滤：${window.ede.danmakuFilter}`);
        showDebugInfo(`弹幕模式过滤：${window.ede.danmakuModeFilter}`);
        showDebugInfo(`弹幕字号：${window.ede.fontSize}`);
        showDebugInfo(`弹幕字体：${window.ede.fontFamily}`);
        showDebugInfo(`弹幕字体选项：${window.ede.fontOptions}`);
        showDebugInfo(`屏幕分辨率：${window.screen.width}x${window.screen.height}`);
        if (window.ede.curEpOffset !== 0) showDebugInfo(`当前弹幕偏移：${window.ede.curEpOffset} 秒`);

        const reactRoot = document.getElementById('reactRoot');

        let _media = document.querySelector(mediaQueryStr);
        if (!_media) {
            showDebugInfo('未找到video');
            return;
        }

        wrapper = document.createElement('div');
        wrapper.id = 'danmakuWrapper';
        wrapper.style.position = 'fixed';
        wrapper.style.width = '100%';
        wrapper.style.height = `calc(${window.ede.heightRatio * 100}% - 18px)`;
        wrapper.style.opacity = window.ede.opacity;
        wrapper.style.top = '18px';
        wrapper.style.pointerEvents = 'none';
        if (reactRoot) {
            reactRoot.prepend(wrapper);
        } else {
            _container.prepend(wrapper);
        }

        let finalComments = [];
        if (window.ede.useAnitOverlap === 1) {
            finalComments = antiOverlapFilter(_comments, _container.offsetWidth, _container.offsetHeight);
        } else {
            finalComments = _comments;
        }

        window.ede.danmaku = new Danmaku({
            container: wrapper,
            media: _media,
            comments: finalComments,
            engine: 'canvas',
            speed: window.ede.speed,
        });

        window.ede.danmakuSwitch === 1 ? window.ede.danmaku.show() : window.ede.danmaku.hide();

        const resizeObserverCallback = () => {
            if (window.ede.danmaku) {
                showDebugInfo('重设容器大小');
                window.ede.danmaku.resize();
            }
        };

        if (window.ede.obResize) {
            window.ede.obResize.disconnect();
        }

        window.ede.obResize = new ResizeObserver(resizeObserverCallback);
        window.ede.obResize.observe(_container);

        const mutationObserverCallback = () => {
            if (window.ede.danmaku && document.querySelector(mediaQueryStr)) {
                showDebugInfo('探测播放媒体变化');
                document.getElementById('danmakuInfoTitle')?.remove();
                const sleep = new Promise(resolve => setTimeout(resolve, 3000));
                sleep.then(() => reloadDanmaku('refresh'));
            }
        };

        if (window.ede.obMutation) {
            window.ede.obMutation.disconnect();
        }

        window.ede.obMutation = new MutationObserver(mutationObserverCallback);
        window.ede.obMutation.observe(_media, { attributes: true });
    }

    function displayDanmakuInfo(info) {
        let infoContainer = document.getElementById('danmakuInfoTitle');
        if (!infoContainer) {
            infoContainer = document.createElement('div');
            infoContainer.id = 'danmakuInfoTitle';
            infoContainer.className = 'pageTitle';
            document.querySelector('div.skinHeader').appendChild(infoContainer);
        }
        infoContainer.innerText = `弹幕匹配信息：${info.animeTitle} - ${info.episodeTitle}`;
    }

    function reloadDanmaku(type = 'check') {
        if (window.ede.loading) {
            showDebugInfo('正在重新加载');
            return;
        }
        window.ede.loading = true;
        if (window.ede.useXmlDanmaku === 1) {
            getItemId().then((itemId) => {
                return new Promise((resolve, reject) => {
                    if (!itemId) {
                        if (type != 'init') {
                            reject('播放器未完成加载');
                        } else {
                            reject(null);
                        }
                    }
                    resolve(itemId);
                });
            }).then((itemId) => getCommentsByPluginApi(itemId))
                .then((comments) => {
                    if (comments?.length > 0) {
                        return createDanmaku(comments).then(() => {
                            showDebugInfo('本地弹幕就位');
                        }).then(() => {
                            window.ede.loading = false;
                            const danmakuCtr = document.getElementById('danmakuCtr');
                            if (danmakuCtr && danmakuCtr.style && danmakuCtr.style.opacity !== '1') {
                                danmakuCtr.style.opacity = 1;
                            }
                        });
                    }
                    throw new Error('本地弹幕加载失败，尝试在线加载');
                })
                .catch((error) => {
                    showDebugInfo(error.message);
                    return loadOnlineDanmaku(type);
                });
        } else {
            loadOnlineDanmaku(type);
        }
    }

    function loadOnlineDanmaku(type) {
        return getEpisodeInfo(type != 'search')
            .then((info) => {
                return new Promise((resolve, reject) => {
                    if (!info) {
                        if (type != 'init') {
                            reject('播放器未完成加载');
                        } else {
                            reject(null);
                        }
                    }
                    if (type != 'search' && type != 'reload' && window.ede.danmaku && window.ede.episode_info && window.ede.episode_info.episodeId == info.episodeId) {
                        reject('当前播放视频未变动');
                    } else {
                        window.ede.episode_info = info;
                        displayDanmakuInfo(info);
                        resolve(info.episodeId);
                    }
                });
            })
            .then((episodeId) =>
                getComments(episodeId).then((comments) =>
                    createDanmaku(comments).then(() => {
                        showDebugInfo('弹幕就位');
                    }),
                ),
                (msg) => {
                    if (msg) {
                        showDebugInfo(msg);
                    }
                },
            )
            .then(() => {
                window.ede.loading = false;
                const danmakuCtr = document.getElementById('danmakuCtr');
                if (danmakuCtr && danmakuCtr.style && danmakuCtr.style.opacity !== '1') {
                    danmakuCtr.style.opacity = 1;
                }
            });
    }

    function preProcessDanmaku(all_cmts, containerWidth, containerHeight) {
        const { fontSize, fontOptions, fontFamily, speed, heightRatio, danmakuFilter, danmakuModeFilter, danmakuDensityLimit, curEpOffset } = window.ede;

        // 来源过滤规则
        const disableBilibili = (danmakuFilter & 1) === 1;
        const disableGamer = (danmakuFilter & 2) === 2;
        const disableDandan = (danmakuFilter & 4) === 4;
        const disableOther = (danmakuFilter & 8) === 8;

        const dandanRegex = disableDandan ? /^(?!\[)|^.{0,3}\]/ : null;
        const otherRegex = disableOther ? /^\[(?!(BiliBili|Gamer)).{3,}\]/ : null;

        // 模式过滤规则
        let enabledModes = new Set([1, 4, 5, 6]);
        if ((danmakuModeFilter & 1) === 1) enabledModes.delete(4); // bottom
        if ((danmakuModeFilter & 2) === 2) enabledModes.delete(5); // top
        if ((danmakuModeFilter & 4) === 4) { enabledModes.delete(1); enabledModes.delete(6); } // rtl & ltr

        // 密度过滤参数
        const shouldFilterDensity = danmakuDensityLimit > 0;
        const duration = Math.ceil(containerWidth / speed);
        const lines = Math.floor((containerHeight * heightRatio - 18) / fontSize) - 1;
        const scrollLimit = (9 - danmakuDensityLimit * 2) * lines;
        const verticalLimit = lines - 1 > 0 ? lines - 1 : 1;

        // 初始化状态变量和结果数组
        const uniqueMap = new Map();
        const timeBuckets = {}; // 滚动弹幕计数桶
        const verticalTimeBuckets = {}; // 顶部/底部弹幕计数桶
        const resultComments = [];

        for (const comment of all_cmts) {
            // 去重
            // p format: time,modeId,colorValue,user
            const pWithoutUser = comment.p.substring(0, comment.p.lastIndexOf(','));
            const uniqueKey = pWithoutUser + comment.m;
            if (uniqueMap.has(uniqueKey)) {
                continue;
            }
            uniqueMap.set(uniqueKey, true);

            // 解析数据
            const parts = comment.p.split(',');
            const time = parseFloat(parts[0]);
            const modeId = parseInt(parts[1], 10);
            const user = parts[3];
            
            // 来源过滤
            if (
                (disableBilibili && user.startsWith('[BiliBili]')) ||
                (disableGamer && user.startsWith('[Gamer]')) ||
                (dandanRegex && dandanRegex.test(user)) ||
                (otherRegex && otherRegex.test(user))
            ) {
                continue;
            }

            // 模式过滤
            if (!enabledModes.has(modeId)) {
                continue;
            }

            // 密度过滤
            if (shouldFilterDensity) {
                const timeIndex = Math.ceil(time / duration);
                const isVertical = modeId === 4 || modeId === 5;

                if (isVertical) {
                    verticalTimeBuckets[timeIndex] = (verticalTimeBuckets[timeIndex] || 0) + 1;
                    if (verticalTimeBuckets[timeIndex] > verticalLimit) {
                        continue;
                    }
                } else {
                    timeBuckets[timeIndex] = (timeBuckets[timeIndex] || 0) + 1;
                    if (timeBuckets[timeIndex] > scrollLimit) {
                        continue;
                    }
                }
            }

            // 格式转换
            const mode = { 1: 'rtl', 4: 'bottom', 5: 'top', 6: 'ltr' }[modeId];
            const colorValue = parseInt(parts[2], 10);
            const color = colorValue.toString(16).padStart(6, '0');

            resultComments.push({
                text: comment.m,
                mode,
                time: time + curEpOffset,
                style: {
                    font: `${fontOptions} ${fontSize}px ${fontFamily}`,
                    fillStyle: `#${color}`,
                    strokeStyle: color === '000000' ? '#fff' : '#000',
                    lineWidth: 2.0,
                },
            });
        }

        return resultComments;
    }

    const widthCache = new Map();
    const canvasContext = document.createElement('canvas').getContext('2d');
    function calculateDanmakuWidth(text, font) {
        if (widthCache.has(text)) {
            return widthCache.get(text);
        }

        canvasContext.font = font;
        const width = canvasContext.measureText(text).width;

        widthCache.set(text, width);
        return width;
    }

    function filterOverlappedScrollDanmaku(sortedScrollDanmaku, containerWidth, containerHeight) {
        const {
            speed,
            fontSize,
            fontOptions,
            fontFamily,
            heightRatio
        } = window.ede;

        if (!sortedScrollDanmaku || sortedScrollDanmaku.length === 0) {
            return [];
        }

        const fontStyle = `${fontOptions} ${fontSize}px ${fontFamily}`;

        const trackCount = Math.floor((containerHeight * heightRatio - 18) / fontSize) - 1;
        if (trackCount === 0) return [];

        const duration = Math.ceil(containerWidth / speed);

        const tracksReleaseTimes = new Array(trackCount).fill(0);
        const filteredList = [];

        for (const danmaku of sortedScrollDanmaku) {
            // 预计算弹幕自身属性
            const danmakuWidth = calculateDanmakuWidth(danmaku.text, fontStyle);
            const actualSpeed = (containerWidth + danmakuWidth) / duration;

            // 弹幕自身进入屏幕所需时间
            const timeToEnter = danmakuWidth / actualSpeed;

            // 寻找可用轨道
            for (let i = 0; i < tracksReleaseTimes.length; i++) {
                // 检查该轨道是否在弹幕需要出现时已经空闲
                if (danmaku.time >= tracksReleaseTimes[i]) {
                    // 分配成功
                    filteredList.push(danmaku);
                    
                    // 更新该轨道的下一次可用时间
                    tracksReleaseTimes[i] = danmaku.time + timeToEnter;

                    break; 
                }
            }
        }

        return filteredList;
    }

    function filterOverlappedFixedDanmaku(sortedFixedDanmaku, containerWidth, containerHeight) {
        const {
            speed,
            fontSize,
            heightRatio
        } = window.ede;

        const trackCount = Math.floor((containerHeight * heightRatio - 18) / fontSize) - 1;

        if (!sortedFixedDanmaku || sortedFixedDanmaku.length === 0 || trackCount === 0) {
            return [];
        }

        const duration = Math.ceil(containerWidth / speed);

        const tracksReleaseTimes = new Array(trackCount).fill(0);
        const filteredList = [];

        for (const danmaku of sortedFixedDanmaku) {
            for (let i = 0; i < tracksReleaseTimes.length; i++) {
                // 检查轨道在该弹幕需要出现时，是否已经空闲
                if (danmaku.time >= tracksReleaseTimes[i]) {
                    // 分配成功
                    filteredList.push(danmaku);

                    // 更新轨道的释放时间
                    tracksReleaseTimes[i] = danmaku.time + duration;

                    break;
                }
            }
        }

        return filteredList;
    }

    function antiOverlapFilter(allDanmaku, containerWidth, containerHeight) {
        const sortedDanmaku = allDanmaku.sort((a, b) => a.time - b.time);

        // 按类型对弹幕进行分类
        const segregatedDanmaku = {
            rtl: [],
            ltr: [],
            top: [],
            bottom: []
        };
        for (const d of sortedDanmaku) {
            if (segregatedDanmaku[d.mode]) {
                segregatedDanmaku[d.mode].push(d);
            }
        }

        // 处理滚动弹幕
        let rtlResults = [];
        if (segregatedDanmaku.rtl.length > 0) {
            rtlResults = filterOverlappedScrollDanmaku(
                segregatedDanmaku.rtl,
                containerWidth,
                containerHeight
            );
        }
        let ltrResults = [];
        if (segregatedDanmaku.ltr.length > 0) {
            ltrResults = filterOverlappedScrollDanmaku(
                segregatedDanmaku.ltr,
                containerWidth,
                containerHeight
            );
        }

        // 处理顶部弹幕
        let topResults = [];
        if (segregatedDanmaku.top.length > 0) {
            topResults = filterOverlappedFixedDanmaku(
                segregatedDanmaku.top,
                containerWidth,
                containerHeight
            );
        }

        // 处理底部弹幕
        let bottomResults = [];
        if (segregatedDanmaku.bottom.length > 0) {
            bottomResults = filterOverlappedFixedDanmaku(
                segregatedDanmaku.bottom,
                containerWidth,
                containerHeight
            );
        }

        return [...rtlResults, ...ltrResults, ...topResults, ...bottomResults]
            .sort((a, b) => a.time - b.time);
    }

    function list2string($obj2) {
        const $animes = $obj2.animes;
        let anime_lists = $animes.map(($single_anime) => {
            return $single_anime.animeTitle + ' 类型:' + $single_anime.typeDescription;
        });
        let anime_lists_str = '1:' + anime_lists[0];
        for (let i = 1; i < anime_lists.length; i++) {
            anime_lists_str = anime_lists_str + '\n' + (i + 1).toString() + ':' + anime_lists[i];
        }
        return anime_lists_str;
    }

    function ep2string($obj3) {
        const $animes = $obj3;
        let anime_lists = $animes.map(($single_ep) => {
            return $single_ep.episodeTitle;
        });
        let ep_lists_str = '1:' + anime_lists[0];
        for (let i = 1; i < anime_lists.length; i++) {
            ep_lists_str = ep_lists_str + '\n' + (i + 1).toString() + ':' + anime_lists[i];
        }
        return ep_lists_str;
    }

    const waitForElement = (selector) => {
        return new Promise((resolve) => {
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });
        });
    };

    const compareVersions = (version1, version2) => {
        if (typeof version1 !== 'string') return -1;
        if (typeof version2 !== 'string') return 1;
        const v1 = version1.split('.').map(Number);
        const v2 = version2.split('.').map(Number);

        for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
            const n1 = v1[i] || 0;
            const n2 = v2[i] || 0;

            if (n1 > n2) return 1;
            if (n1 < n2) return -1;
        }

        return 0;
    }

    waitForElement('.htmlvideoplayer').then(() => {
        if (!window.ede) {
            window.ede = new EDE();

            const materialIcon = document.querySelector('.material-icons');
            const fontFamily = window.getComputedStyle(materialIcon).fontFamily;
            if (fontFamily === '"Font Awesome 6 Pro"') {
                danmaku_icons = ['fa-comment-slash', 'fa-comment'];
                log_icons = ['fa-toilet-paper-slash', 'fa-toilet-paper'];
                sendDanmakuOpts.class = 'fa-paper-plane';
            }

            (async () => {
                isNewJellyfin = compareVersions(ApiClient?._appVersion, '10.10.0') >= 0;
                // showDebugInfo(`isNewJellyfin: ${isNewJellyfin}`);
                if (isNewJellyfin) {
                    let retry = 0;
                    while (!itemId) {
                        await new Promise((resolve) => setTimeout(resolve, 200));
                        retry++;
                        if (retry > 10) {
                            throw new Error('获取itemId失败');
                        }
                    }
                } else {
                    while (!(await ApiClient.getSessions())) {
                        await new Promise((resolve) => setTimeout(resolve, 200));
                    }
                }

                setInterval(() => {
                    initUI();
                }, check_interval);

                setInterval(() => {
                    initListener();
                }, check_interval);
            })();
        }
    });

    // 添加侧边栏样式
    function addDanmakuSidebarStyles() {
        if (document.getElementById('danmakuSidebarStyles')) return;

        const style = document.createElement('style');
        style.id = 'danmakuSidebarStyles';
        style.textContent = `
            /* 容器约束 - 防止布局溢出 */
            .danmakuSidebar label,
            .danmakuSidebar .checkbox-container,
            .danmakuSidebar .radio-container,
            .danmakuSidebar div[style*="flex-direction: column"] {
                max-width: 100% !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
                word-wrap: break-word !important;
            }

            /* 统一滚动条样式 */
            .danmakuSidebar .danmaku-settings-container::-webkit-scrollbar,
            .danmaku-tabs-container::-webkit-scrollbar {
                width: 6px;
                height: 4px;
            }

            .danmakuSidebar .danmaku-settings-container::-webkit-scrollbar-track,
            .danmaku-tabs-container::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.1);
                border-radius: 3px;
            }

            .danmakuSidebar .danmaku-settings-container::-webkit-scrollbar-thumb,
            .danmaku-tabs-container::-webkit-scrollbar-thumb {
                background: rgba(0, 164, 220, 1);
                border-radius: 3px;
            }

            /* 控制卡片悬停效果 */
            .control-card {
                position: relative;
                overflow: hidden;
            }

            .control-card::before {
                content: '';
                position: absolute;
                inset: 0;
                background: linear-gradient(135deg, rgba(0, 164, 220, 0.05), rgba(0, 164, 219, 0.05));
                opacity: 0;
                transition: opacity 0.3s ease;
                pointer-events: none;
            }

            .control-card:hover::before {
                opacity: 1;
            }

            /* 滑块相关样式 */
            .danmakuSidebar input[type="range"] {
                -webkit-appearance: none;
                appearance: none;
                height: 6px;
                border-radius: 3px;
                outline: none;
                background: rgba(0, 164, 220, 1);
                cursor: pointer;
            }

            .danmakuSidebar input[type="range"]::-webkit-slider-thumb,
            .danmakuSidebar input[type="range"]::-moz-range-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: rgba(0, 164, 220, 1);
                cursor: pointer;
                border: none;
                box-shadow: 0 2px 6px rgba(0, 164, 220, 0.3);
                transition: all 0.3s ease;
            }

            .danmakuSidebar input[type="range"]::-webkit-slider-thumb:hover {
                transform: scale(1.1);
                box-shadow: 0 3px 8px rgba(0, 164, 220, 0.5);
            }

            /* 滑块值标签和容器 */
            .danmakuSidebar .range-value-label {
                color: rgba(0, 164, 220, 1) !important;
                font-size: 14px !important;
                font-weight: 600 !important;
                min-width: 50px !important;
                text-align: center !important;
                background: rgba(0, 164, 220, 0.1) !important;
                padding: 4px 8px !important;
                border-radius: 6px !important;
                border: 1px solid rgba(0, 164, 220, 0.3) !important;
                backdrop-filter: blur(10px) !important;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
                flex-shrink: 0 !important;
                white-space: nowrap !important;
            }

            .danmakuSidebar .range-value-label:hover {
                background: rgba(0, 164, 220, 0.15) !important;
                border-color: rgba(0, 164, 220, 0.5) !important;
                transform: scale(1.05) !important;
            }

            .danmakuSidebar .range-container {
                display: flex !important;
                align-items: center !important;
                gap: 12px !important;
                flex: 1 !important;
            }

            /* 响应式设计 */
            @media (max-width: 600px) {
                .danmakuSidebar {
                    width: 95% !important;
                    max-width: none !important;
                }
                
                .control-card {
                    flex: 1 1 100% !important;
                    min-width: 100% !important;
                }
            }

            @media (max-width: 400px) {
                .control-card .control-info {
                    flex-direction: column;
                    align-items: flex-start;
                    text-align: left;
                }
                
                .control-card .control-icon {
                    margin-bottom: 8px;
                    margin-right: 0 !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // 为内容区域的设置项添加样式
    function styleSettingItemForContent(item) {
        // 检查是否是控制功能卡片，如果是则跳过样式处理
        if (item.classList && item.classList.contains('control-card')) {
            return;
        }

        // 基础样式
        const baseStyles = {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            marginBottom: '12px',
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            minHeight: '56px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
        };

        // 应用基础样式
        Object.entries(baseStyles).forEach(([property, value]) => {
            item.style[property] = value;
        });

        // 调整标签和输入控件布局
        const label = item.querySelector('span, label');
        const input = item.querySelector('input, div:last-child');

        if (label && input) {
            // 标签样式
            label.style.cssText = `
                font-size: 14px;
                font-weight: 500;
                color: #fff;
                flex: 0 0 auto;
                margin-right: 20px;
                min-width: 120px;
                text-align: left;
                line-height: 1.4;
            `;

            if (input.tagName === 'INPUT') {
                input.style.flex = '1';

                // 根据输入类型应用特定样式
                if (input.type === 'range') {
                    // 创建滑块值显示容器
                    const rangeContainer = document.createElement('div');
                    rangeContainer.className = 'range-container';

                    // 创建值显示标签
                    const valueLabel = document.createElement('span');
                    valueLabel.className = 'range-value-label';

                    // 获取滑块的映射显示文本
                    const getDisplayValue = (value, inputElement) => {
                        // 检查是否是弹幕密度相关的滑块
                        if (inputElement.id === "danmakuDensityLimit") {
                            const densityMap = {
                                '0': '不限制',
                                '1': '低',
                                '2': '中',
                                '3': '高'
                            };
                            return densityMap[value] || value;
                        }
                        return value;
                    };

                    // 初始化显示值
                    valueLabel.textContent = getDisplayValue(input.value || '0', input);

                    // 设置滑块样式
                    input.style.cssText += `
                        max-width: 200px;
                        height: 6px;
                        border-radius: 3px;
                        background: rgba(0, 164, 220, 1);
                        outline: none;
                        -webkit-appearance: none;
                        appearance: none;
                        flex: 1;
                    `;

                    // 监听滑块值变化事件
                    input.addEventListener('input', function () {
                        valueLabel.textContent = getDisplayValue(this.value, this);
                        // 添加动画效果
                        valueLabel.style.transform = 'scale(1.1)';
                        setTimeout(() => {
                            valueLabel.style.transform = 'scale(1)';
                        }, 150);
                    });

                    input.addEventListener('change', function () {
                        valueLabel.textContent = getDisplayValue(this.value, this);
                    });

                    // 将滑块插入到容器中
                    const inputParent = input.parentElement;
                    inputParent.insertBefore(rangeContainer, input);
                    rangeContainer.appendChild(valueLabel);
                    rangeContainer.appendChild(input);
                }
                else if (input.type === 'text' || input.type === 'number') {
                    // 文本/数值输入框样式
                    const inputBaseStyles = `
                        min-width: 180px;
                        max-width: 100%;
                        width: 100%;
                        padding: 10px 16px;
                        border-radius: 12px;
                        border: 2px solid rgba(0, 164, 220, 0.4);
                        background: linear-gradient(135deg, rgba(0, 164, 220, 0.08), rgba(0, 164, 219, 0.08));
                        color: #fff;
                        font-size: 14px;
                        font-weight: 500;
                        min-height: 40px;
                        line-height: 1.6;
                        transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                        backdrop-filter: blur(25px);
                        box-sizing: border-box;
                        box-shadow: 
                            0 2px 8px rgba(0, 164, 220, 0.15),
                            inset 0 1px 2px rgba(255, 255, 255, 0.1),
                            inset 0 -1px 1px rgba(0, 0, 0, 0.05);
                    `;
                    input.style.cssText += inputBaseStyles;

                    // 添加状态响应事件
                    const stateChanges = {
                        focus: {
                            background: 'linear-gradient(135deg, rgba(0, 164, 220, 0.18), rgba(0, 164, 219, 0.18))',
                            borderColor: 'rgba(0, 164, 220, 0.8)',
                            boxShadow: '0 0 0 5px rgba(0, 164, 220, 0.2), 0 6px 25px rgba(0, 164, 220, 0.35), inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 -1px 1px rgba(0, 0, 0, 0.05)',
                            transform: 'translateY(-1px) scale(1.01)'
                        },
                        blur: {
                            background: 'linear-gradient(135deg, rgba(0, 164, 220, 0.08), rgba(0, 164, 219, 0.08))',
                            border: '2px solid rgba(0, 164, 220, 0.4)',
                            boxShadow: '0 2px 8px rgba(0, 164, 220, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.05)',
                            transform: 'translateY(0) scale(1)'
                        },
                        mouseenter: {
                            background: 'linear-gradient(135deg, rgba(0, 164, 220, 0.12), rgba(0, 164, 219, 0.12))',
                            border: '2px solid rgba(0, 164, 220, 0.6)',
                            boxShadow: '0 4px 15px rgba(0, 164, 220, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.15), inset 0 -1px 1px rgba(0, 0, 0, 0.05)',
                            transform: 'translateY(-1px) scale(1.01)'
                        },
                        mouseleave: {
                            background: 'linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08))',
                            border: '2px solid rgba(128, 128, 128, 0.4)',
                            boxShadow: '0 2px 8px rgba(128, 128, 128, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.05)',
                            transform: 'translateY(0) scale(1)'
                        }
                    };

                    // 绑定事件 - 使用统一的处理函数
                    const applyStyles = (element, styles) => {
                        Object.entries(styles).forEach(([prop, val]) => {
                            element.style[prop] = val;
                        });
                    };

                    input.addEventListener('focus', () => applyStyles(input, stateChanges.focus));
                    input.addEventListener('blur', () => applyStyles(input, stateChanges.blur));
                    input.addEventListener('mouseenter', function () {
                        if (document.activeElement !== this) {
                            applyStyles(this, stateChanges.mouseenter);
                        }
                    });
                    input.addEventListener('mouseleave', function () {
                        if (document.activeElement !== this) {
                            applyStyles(this, stateChanges.mouseleave);
                        }
                    });
                }
                else if (input.type === 'checkbox' || input.type === 'radio') {
                    // 复选框/单选框基础样式
                    const checkStyles = `
                        width: 18px;
                        height: 18px;
                        cursor: pointer;
                        position: relative;
                        -webkit-appearance: none;
                        appearance: none;
                        background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08));
                        border: 2px solid rgba(128, 128, 128, 0.4);
                        border-radius: ${input.type === 'radio' ? '50%' : '6px'};
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        backdrop-filter: blur(25px);
                        box-shadow: 
                            0 2px 8px rgba(0, 164, 220, 0.15),
                            inset 0 1px 2px rgba(255, 255, 255, 0.1),
                            inset 0 -1px 1px rgba(0, 0, 0, 0.05);
                    `;
                    input.style.cssText += checkStyles;

                    // 添加选中状态的样式更新函数
                    const updateCheckboxStyle = () => {
                        const styles = input.checked ? {
                            background: 'rgba(0, 164, 220, 1)',
                            border: '2px solid rgba(0, 164, 220, 0.8)',
                            boxShadow: '0 2px 12px rgba(0, 164, 220, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 -1px 1px rgba(0, 0, 0, 0.05)'
                        } : {
                            background: 'linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08))',
                            border: '2px solid rgba(128, 128, 128, 0.4)',
                            boxShadow: '0 2px 8px rgba(128, 128, 128, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.05)'
                        };

                        Object.entries(styles).forEach(([prop, val]) => {
                            input.style[prop] = val;
                        });
                    };

                    // 绑定事件
                    input.addEventListener('change', updateCheckboxStyle);
                    input.addEventListener('mouseenter', function () {
                        if (!this.checked) {
                            this.style.border = '2px solid rgba(0, 164, 220, 0.6)';
                            this.style.background = 'rgba(255, 255, 255, 0.15)';
                        }
                    });
                    input.addEventListener('mouseleave', function () {
                        if (!this.checked) {
                            this.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                            this.style.background = 'rgba(255, 255, 255, 0.1)';
                        }
                    });

                    // 初始化样式
                    updateCheckboxStyle();
                }
            } else {
                input.style.flex = '1';
            }
        }

        // 处理复选框组 - 改为横向占满布局
        const checkboxGroup = item.querySelectorAll('input[type="checkbox"], input[type="radio"]');
        if (checkboxGroup.length > 1) {
            // 设置容器样式为列布局
            item.style.flexDirection = 'column';
            item.style.alignItems = 'flex-start';
            item.style.padding = '20px';

            const container = item.querySelector('div:last-child') || item;
            container.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 8px;
                width: 100%;
                max-width: 100%;
                margin-top: 20px;
                box-sizing: border-box;
            `;

            // 处理每个复选框的容器
            checkboxGroup.forEach(checkbox => {
                const parent = checkbox.parentElement;
                if (parent) {
                    // 设置父容器样式
                    parent.style.cssText = `
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        width: 100%;
                        max-width: 100%;
                        padding: 16px 20px;
                        margin-bottom: 8px;
                        border-radius: 12px;
                        background: linear-gradient(135deg, rgba(0, 164, 220, 0.06), rgba(0, 164, 219, 0.06));
                        font-size: 14px;
                        font-weight: 500;
                        color: rgba(255, 255, 255, 0.95);
                        border: 2px solid rgba(0, 164, 220, 0.4);
                        cursor: pointer;
                        transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                        min-height: 44px;
                        backdrop-filter: blur(25px);
                        position: relative;
                        overflow: hidden;
                        box-sizing: border-box;
                        box-shadow: 
                            0 2px 8px rgba(0, 164, 220, 0.1),
                            inset 0 1px 2px rgba(255, 255, 255, 0.08),
                            inset 0 -1px 1px rgba(0, 0, 0, 0.03);
                    `;

                    // 设置复选框样式
                    checkbox.style.cssText = `
                        margin-right: 0;
                        margin-left: 0;
                        order: 1;
                        width: 22px;
                        height: 22px;
                        cursor: pointer;
                        position: relative;
                        -webkit-appearance: none;
                        appearance: none;
                        background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08));
                        border: 2px solid rgba(128, 128, 128, 0.4);
                        border-radius: ${checkbox.type === 'radio' ? '50%' : '6px'};
                        transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                        backdrop-filter: blur(25px);
                        flex-shrink: 0;
                        box-shadow: 
                            0 2px 8px rgba(0, 164, 220, 0.15),
                            inset 0 1px 2px rgba(255, 255, 255, 0.1),
                            inset 0 -1px 1px rgba(0, 0, 0, 0.05);
                    `;

                    // 处理标签文本和右对齐
                    parent.childNodes.forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            const span = document.createElement('span');
                            span.textContent = node.textContent.trim();
                            span.style.cssText = `
                                flex: 1;
                                text-align: right;
                                order: 2;
                                margin-right: 12px;
                                line-height: 1.4;
                                word-wrap: break-word;
                                overflow: hidden;
                                max-width: calc(100% - 40px);
                                box-sizing: border-box;
                            `;
                            parent.replaceChild(span, node);
                        }
                    });

                    // 创建选中状态指示器（勾选标记或圆点）
                    const indicator = document.createElement('div');
                    indicator.className = checkbox.type === 'checkbox' ? 'check-mark' : 'radio-dot';

                    if (checkbox.type === 'checkbox') {
                        indicator.style.cssText = `
                            position: absolute;
                            left: 5px;
                            top: 1px;
                            width: 6px;
                            height: 10px;
                            border: solid white;
                            border-width: 0 2px 2px 0;
                            transform: rotate(45deg) scale(0);
                            transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
                            opacity: 0;
                        `;
                    } else {
                        indicator.style.cssText = `
                            position: absolute;
                            left: 50%;
                            top: 50%;
                            width: 8px;
                            height: 8px;
                            background: white;
                            border-radius: 50%;
                            transform: translate(-50%, -50%) scale(0);
                            transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
                            opacity: 0;
                        `;
                    }
                    checkbox.appendChild(indicator);

                    // 更新样式函数，处理选中状态的外观变化
                    const updateStyle = () => {
                        const indicator = checkbox.querySelector('.check-mark, .radio-dot');
                        if (checkbox.checked) {
                            // 选中状态样式
                            checkbox.style.background = 'rgba(0, 164, 220, 1)';
                            checkbox.style.border = '2px solid rgba(0, 164, 220, 0.8)';
                            checkbox.style.boxShadow = '0 2px 12px rgba(0, 164, 220, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 -1px 1px rgba(0, 0, 0, 0.05)';
                            checkbox.style.transform = 'scale(1.05)';
                            parent.style.background = 'linear-gradient(135deg, rgba(0, 164, 220, 0.15), rgba(0, 164, 219, 0.15))';
                            parent.style.border = '2px solid rgba(0, 164, 220, 0.6)';
                            parent.style.boxShadow = '0 2px 12px rgba(0, 164, 220, 0.25), inset 0 1px 2px rgba(255, 255, 255, 0.15), inset 0 -1px 1px rgba(0, 0, 0, 0.05)';

                            // 显示指示器
                            if (indicator) {
                                indicator.style.transform = checkbox.type === 'radio' ? 'translate(-50%, -50%) scale(1)' : 'rotate(45deg) scale(1)';
                                indicator.style.opacity = '1';
                            }

                            // 如果是单选框，更新同组中的其他单选框样式
                            if (checkbox.type === 'radio' && checkbox.name) {
                                document.querySelectorAll(`input[type="radio"][name="${checkbox.name}"]`).forEach(radio => {
                                    if (radio !== checkbox && radio.checked === false) {
                                        const radioParent = radio.parentElement;
                                        const radioIndicator = radio.querySelector('.radio-dot');

                                        // 应用未选中样式
                                        radio.style.background = 'linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08))';
                                        radio.style.border = '2px solid rgba(128, 128, 128, 0.4)';
                                        radio.style.boxShadow = '0 2px 8px rgba(128, 128, 128, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.05)';
                                        radio.style.transform = 'scale(1)';

                                        if (radioParent) {
                                            radioParent.style.background = 'linear-gradient(135deg, rgba(128, 128, 128, 0.06), rgba(160, 160, 160, 0.06))';
                                            radioParent.style.border = '2px solid rgba(128, 128, 128, 0.2)';
                                            radioParent.style.boxShadow = '0 2px 8px rgba(128, 128, 128, 0.1), inset 0 1px 2px rgba(255, 255, 255, 0.08), inset 0 -1px 1px rgba(0, 0, 0, 0.03)';
                                        }

                                        // 隐藏指示器
                                        if (radioIndicator) {
                                            radioIndicator.style.transform = 'translate(-50%, -50%) scale(0)';
                                            radioIndicator.style.opacity = '0';
                                        }
                                    }
                                });
                            }
                        } else {
                            // 未选中状态样式
                            checkbox.style.background = 'linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08))';
                            checkbox.style.border = '2px solid rgba(128, 128, 128, 0.4)';
                            checkbox.style.boxShadow = '0 2px 8px rgba(128, 128, 128, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.05)';
                            checkbox.style.transform = 'scale(1)';
                            parent.style.background = 'linear-gradient(135deg, rgba(128, 128, 128, 0.06), rgba(160, 160, 160, 0.06))';
                            parent.style.border = '2px solid rgba(128, 128, 128, 0.2)';
                            parent.style.boxShadow = '0 2px 8px rgba(128, 128, 128, 0.1), inset 0 1px 2px rgba(255, 255, 255, 0.08), inset 0 -1px 1px rgba(0, 0, 0, 0.03)';

                            // 隐藏指示器
                            if (indicator) {
                                indicator.style.transform = checkbox.type === 'radio' ? 'translate(-50%, -50%) scale(0)' : 'rotate(45deg) scale(0)';
                                indicator.style.opacity = '0';
                            }
                        }
                    };

                    // 绑定事件
                    checkbox.addEventListener('change', function (e) {
                        // Firefox兼容性：确保单选框组至少有一个保持选中状态
                        if (isFirefox() && checkbox.type === 'radio' && checkbox.name) {
                            const radioGroup = document.querySelectorAll(`input[type="radio"][name="${checkbox.name}"]`);
                            const checkedCount = Array.from(radioGroup).filter(radio => radio.checked).length;

                            // 如果当前单选框被取消选中，且这是组中唯一选中的，则阻止取消选中
                            if (!checkbox.checked && checkedCount === 0) {
                                e.preventDefault();
                                checkbox.checked = true;
                                return;
                            }
                        }
                        updateStyle();
                    });

                    // 父容器的鼠标事件
                    const hoverStyles = {
                        enter: {
                            unchecked: {
                                background: 'linear-gradient(135deg, rgba(0, 164, 220, 0.08), rgba(0, 164, 219, 0.08))',
                                border: '2px solid rgba(0, 164, 220, 0.4)',
                                transform: 'translateY(-1px)',
                                boxShadow: '0 4px 12px rgba(0, 164, 220, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.15)'
                            },
                            checked: {
                                background: 'linear-gradient(135deg, rgba(0, 164, 220, 0.2), rgba(0, 164, 219, 0.2))',
                                border: '2px solid rgba(0, 164, 220, 0.45)',
                                transform: 'translateY(-1px)',
                                boxShadow: '0 4px 16px rgba(0, 164, 220, 0.3), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
                            },
                            checkbox: {
                                unchecked: {
                                    border: '2px solid rgba(0, 164, 220, 0.6)',
                                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.15), rgba(0, 164, 220, 0.1))',
                                    transform: 'scale(1.1)'
                                },
                                checked: {
                                    transform: 'scale(1.15)'
                                }
                            }
                        }
                    };

                    parent.addEventListener('mouseenter', function () {
                        if (!checkbox.checked) {
                            Object.entries(hoverStyles.enter.unchecked).forEach(([prop, val]) => {
                                this.style[prop] = val;
                            });
                            Object.entries(hoverStyles.enter.checkbox.unchecked).forEach(([prop, val]) => {
                                checkbox.style[prop] = val;
                            });
                        } else {
                            Object.entries(hoverStyles.enter.checked).forEach(([prop, val]) => {
                                this.style[prop] = val;
                            });
                            Object.entries(hoverStyles.enter.checkbox.checked).forEach(([prop, val]) => {
                                checkbox.style[prop] = val;
                            });
                        }
                    });

                    parent.addEventListener('mouseleave', function () {
                        this.style.transform = 'translateY(0)';
                        updateStyle();
                    });

                    // 初始化样式
                    updateStyle();

                    // 点击事件处理 - Firefox兼容性修复
                    parent.addEventListener('click', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isFirefox()) {
                            if (e.target !== checkbox) {
                                // Firefox兼容性：特殊处理单选框组
                                if (checkbox.type === 'radio' && checkbox.name) {
                                    const radioGroup = document.querySelectorAll(`input[type="radio"][name="${checkbox.name}"]`);
                                    const checkedCount = Array.from(radioGroup).filter(radio => radio.checked).length;

                                    // 如果当前单选框已选中且是组中唯一选中的，则不允许取消选中
                                    if (checkbox.checked && checkedCount === 1) {
                                        return;
                                    }
                                }

                                // Firefox兼容性：手动切换状态并触发事件
                                checkbox.checked = !checkbox.checked;

                                // 手动触发change事件
                                const changeEvent = new Event('change', {
                                    bubbles: true,
                                    cancelable: true
                                });
                                checkbox.dispatchEvent(changeEvent);
                            }
                        } else {
                            checkbox.click();
                        }
                    });

                    // 确保复选框/单选框点击事件不会出发父元素的点击
                    checkbox.addEventListener('click', function (e) {
                        e.stopPropagation();
                    });
                }
            });
        }
    }

    // 添加CSS样式
    const style = document.createElement('style');
    style.textContent = `
        /* 强制约束复选框和单选框容器宽度 */
        .danmakuSidebar *{
            box-sizing: border-box !important;
        }
        
        .danmakuSidebar label,
        .danmakuSidebar input[type="checkbox"]:parent,
        .danmakuSidebar input[type="radio"]:parent{
            max-width: 100% !important;
            overflow: hidden !important;
            word-wrap: break-word !important;
            text-overflow: ellipsis !important;
        }

        /* 隐藏原始位置的按钮 */
        #displayLog,
        #searchDanmaku,
        #addDanmakuSource,
        #danmakuSettings,
        /*#sendDanmaku {*/
        /*    display: none !important;*/
        /*}*/

        /* 调整播放器设置菜单位置 - 距离底部5%屏幕高度，位于右侧 - 仅在视频播放界面生效 */
        .actionSheet.centeredDialog:has([data-id="aspectratio"]):has([data-id="playbackrate"]),
        .actionSheet.centeredDialog.video-player-settings-menu {
            position: fixed !important;
            bottom: 5vh !important;
            top: auto !important;
            /* right: 20px !important; */
            /* left: auto !important; */
            transform: none !important;
            margin: 0 !important;
        }

        .actionSheet.centeredDialog:has([data-id="aspectratio"]):has([data-id="playbackrate"])[style*="top:"],
        .actionSheet.centeredDialog:has([data-id="aspectratio"]):has([data-id="playbackrate"])[style*="left:"],
        .actionSheet.centeredDialog.video-player-settings-menu[style*="top:"],
        .actionSheet.centeredDialog.video-player-settings-menu[style*="left:"] {
            bottom: 5vh !important;
            top: auto !important;
            /* right: 20px !important; */
            /* left: auto !important; */
            transform: none !important;
        }

        /* 播放器设置菜单优化 - 仅在视频播放界面生效 */
        .actionSheet:has([data-id="aspectratio"]):has([data-id="playbackrate"]) .actionSheetContent,
        .actionSheet.video-player-settings-menu .actionSheetContent {
            max-height: 40vh !important;
            overflow-y: auto !important;
            border-radius: 8px !important;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
            min-width: 180px !important;
        }

        /* 播放器设置菜单中的弹幕设置项样式 */
        [data-id="danmaku-settings"] {
            transition: all 0.3s ease !important;
        }

        [data-id="danmaku-settings"]:hover {
            background: rgba(255, 255, 255, 0.1) !important;
        }

        [data-id="danmaku-settings"] .actionSheetItemText {
            color: inherit !important;
        }

        /* 控制按钮容器 */
        .control-buttons-container {
            display: flex !important;
            align-items: center !important;
            gap: 10px !important;
            flex-wrap: wrap !important;
        }

        /* 自定义复选框和单选框样式 */
        .danmakuSidebar input[type="checkbox"],
        .danmakuSidebar input[type="radio"] {
            -webkit-appearance: none !important;
            appearance: none !important;
            background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08)) !important;
            border: 2px solid rgba(128, 128, 128, 0.4) !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            cursor: pointer !important;
            position: relative !important;
            backdrop-filter: blur(25px) !important;
            box-shadow: 
                0 2px 8px rgba(128, 128, 128, 0.15),
                inset 0 1px 2px rgba(255, 255, 255, 0.1),
                inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
        }

        .danmakuSidebar input[type="checkbox"] {
            border-radius: 6px !important;
            width: 20px !important;
            height: 20px !important;
        }

        .danmakuSidebar input[type="radio"] {
            border-radius: 50% !important;
            width: 20px !important;
            height: 20px !important;
        }

        .danmakuSidebar input[type="checkbox"]:checked,
        .danmakuSidebar input[type="radio"]:checked {
            background: rgba(0, 164, 220, 1) !important;
            border-color: rgba(0, 164, 220, 0.8) !important;
            box-shadow: 0 2px 12px rgba(0, 164, 220, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
        }

        .danmakuSidebar input[type="checkbox"]:checked::after {
            content: "✓" !important;
            position: absolute !important;
            left: 50% !important;
            top: 50% !important;
            transform: translate(-50%, -50%) !important;
            color: white !important;
            font-size: 12px !important;
            font-weight: bold !important;
        }

        .danmakuSidebar input[type="radio"]:checked::after {
            content: "" !important;
            position: absolute !important;
            left: 50% !important;
            top: 50% !important;
            transform: translate(-50%, -50%) !important;
            width: 8px !important;
            height: 8px !important;
            background: white !important;
            border-radius: 50% !important;
        }

        .danmakuSidebar input[type="checkbox"]:hover:not(:checked),
        .danmakuSidebar input[type="radio"]:hover:not(:checked) {
            border: 2px solid rgba(0, 164, 220, 0.6) !important;
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.12), rgba(0, 164, 219, 0.12)) !important;
            box-shadow: 0 4px 15px rgba(0, 164, 220, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.12), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
        }

        /* 现代化开关样式 */
        .modern-switch {
            position: relative !important;
            display: inline-block !important;
            width: 44px !important;
            height: 24px !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
            border: none !important;
            cursor: pointer !important;
        }

        .modern-switch input {
            opacity: 0 !important;
            width: 0 !important;
            height: 0 !important;
            position: absolute !important;
            margin: 0 !important;
        }

        .modern-slider {
            position: absolute !important;
            cursor: pointer !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            background: rgba(255, 255, 255, 0.2) !important;
            border-radius: 24px !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            width: 44px !important;
            height: 24px !important;
        }

        .modern-slider:before {
            position: absolute !important;
            content: "" !important;
            height: 18px !important;
            width: 18px !important;
            left: 2px !important;
            bottom: 2px !important;
            background: white !important;
            border-radius: 50% !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2) !important;
        }

        .modern-switch input:checked + .modern-slider {
            background: rgba(0, 164, 220, 1) !important;
            border-color: transparent !important;
        }

        .modern-switch input:checked + .modern-slider:before {
            transform: translateX(20px) !important;
            box-shadow: 0 1px 4px rgba(0, 164, 220, 0.3) !important;
        }

        .modern-slider:hover {
            box-shadow: 0 0 8px rgba(0, 164, 220, 0.2) !important;
        }

        .modern-switch input:checked + .modern-slider:hover {
            box-shadow: 0 0 8px rgba(0, 164, 220, 0.4) !important;
        }

        /* 控制卡片样式 */
        .control-card {
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }

        .control-card:hover {
            transform: translateY(-2px) !important;
        }

        /* 控制项样式 */
        .control-item,
        .control-card {
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }

        .control-item:hover,
        .control-card:hover {
            transform: translateY(-2px) !important;
        }

        /* 强制样式覆盖 - 确保所有danmaku相关输入框都使用新样式 */
        input#danmakuFontFamily,
        input#danmakuOffsetTime,
        input#danmakuFontOptions,
        input#dialogInput,
        [id*="danmaku"] input[type="text"],
        [id*="danmaku"] input[type="number"] {
            background: linear-gradient(135deg, rgba(128, 128, 128, 0.06), rgba(160, 160, 160, 0.06)) !important;
            border: 2px solid rgba(100, 100, 100, 0.3) !important;
            border-radius: 12px !important;
            padding: 10px 16px !important;
            color: #fff !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            min-height: 40px !important;
            line-height: 1.6 !important;
            backdrop-filter: blur(25px) !important;
            box-sizing: border-box !important;
            max-width: 100% !important;
            box-shadow: 
                0 2px 8px rgba(100, 100, 100, 0.15),
                inset 0 1px 2px rgba(255, 255, 255, 0.1),
                inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
        }

        input#danmakuFontFamily:focus,
        input#danmakuOffsetTime:focus,
        input#danmakuFontOptions:focus,
        input#dialogInput:focus {
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.1), rgba(0, 164, 219, 0.1)) !important;
            border-color: rgba(0, 164, 220, 0.6) !important;
            box-shadow: 
                0 0 0 3px rgba(0, 164, 220, 0.2),
                0 5px 10px rgba(0, 164, 220, 0.35),
                inset 0 1px 2px rgba(255, 255, 255, 0.2),
                inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
            outline: none !important;
            transform: translateY(-1px) scale(1.01) !important;
        }

        /* 响应式设计 - 控制功能弹性布局 */
        @media (max-width: 900px) {
            .control-card {
                flex: 1 1 calc(50% - 12px) !important;
                min-width: 260px !important;
            }
        }

        @media (max-width: 600px) {
            .control-card {
                flex: 1 1 100% !important;
                min-width: 100% !important;
            }
            
            /* 设置项在移动端堆叠布局 */
            .setting-row {
                flex-direction: column !important;
                align-items: flex-start !important;
                gap: 8px !important;
            }
            
            .setting-row label {
                min-width: auto !important;
                margin-right: 0 !important;
            }
        }
    `;
    document.head.appendChild(style);
})();
