// ==UserScript==
// @name         Jellyfin danmaku extension
// @description  Jellyfin弹幕插件
// @namespace    https://github.com/RyoLee
// @author       RyoLee
// @version      1.18
// @copyright    2022, RyoLee (https://github.com/RyoLee)
// @license      MIT; https://raw.githubusercontent.com/Izumiko/jellyfin-danmaku/jellyfin/LICENSE
// @icon         https://github.githubassets.com/pinned-octocat.svg
// @updateURL    https://cdn.jsdelivr.net/gh/Izumiko/jellyfin-danmaku@gh-pages/ede.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/Izumiko/jellyfin-danmaku@gh-pages/ede.user.js
// @grant        GM_xmlhttpRequest
// @connect      *
// @match        *://*/*/web/index.html
// @match        *://*/web/index.html
// ==/UserScript==

(async function () {
    'use strict';
    if (document.querySelector('meta[name="application-name"]').content == 'Jellyfin') {
        // ------ configs start------
        let deviceId = localStorage.getItem('_deviceId2');
        const serversInfo = JSON.parse(localStorage.getItem('jellyfin_credentials')).Servers;
        let authorization = '';
        let userId = '';
        let isInTampermonkey = true;
        let apiPrefix = 'https://api.9-ch.com/cors/';
        const debugInfoLoc = 'ui'; // 'console' or 'ui'
        let logQueue = [];
        let logLines = 0;
        const baseUrl = window.location.origin + window.location.pathname.replace('/web/index.html', '');
        const check_interval = 200;
        const chConverTtitle = ['当前状态: 未启用翻译', '当前状态: 转换为简体', '当前状态: 转换为繁体'];
        // 0:当前状态关闭 1:当前状态打开
        const danmaku_icons = ['comments_disabled', 'comment'];
        const search_icon = 'find_replace';
        const translate_icon = 'g_translate';
        const filter_icons = ['filter_none', 'filter_1', 'filter_2', 'filter_3'];
        const source_icon = 'library_add';
        const log_icon = 'import_contacts';
        const settings_icon = 'settings'
        const spanClass = 'xlargePaperIconButton material-icons ';
        const buttonOptions = {
            class: 'paper-icon-button-light',
            is: 'paper-icon-button-light',
        };
        const uiAnchorStr = 'pause';
        const uiQueryStr = '.osdTimeText';
        const mediaContainerQueryStr = "div[data-type='video-osd']";
        const mediaQueryStr = 'video';
        const displayButtonOpts = {
            title: '弹幕开关',
            id: 'displayDanmaku',
            class: '',
            onclick: () => {
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
                    reloadDanmaku('reload');
                }
            },
        };
        const searchButtonOpts = {
            title: '搜索弹幕',
            id: 'searchDanmaku',
            class: search_icon,
            onclick: () => {
                if (window.ede.loading) {
                    showDebugInfo('正在加载,请稍后再试');
                    return;
                }
                showDebugInfo('手动匹配弹幕');
                reloadDanmaku('search');
            },
        };
        const translateButtonOpts = {
            title: null,
            id: 'translateDanmaku',
            class: translate_icon,
            onclick: () => {
                if (window.ede.loading) {
                    showDebugInfo('正在加载,请稍后再试');
                    return;
                }
                showDebugInfo('切换简繁转换');
                window.ede.chConvert = (window.ede.chConvert + 1) % 3;
                window.localStorage.setItem('chConvert', window.ede.chConvert);
                document.querySelector('#translateDanmaku').setAttribute('title', chConverTtitle[window.ede.chConvert]);
                reloadDanmaku('reload');
                showDebugInfo(document.querySelector('#translateDanmaku').getAttribute('title'));
            },
        };

        const filterButtonOpts = {
            title: '过滤等级',
            id: 'filteringDanmaku',
            class: '',
            onclick: () => {
                showDebugInfo('切换弹幕过滤等级');
                let level = window.localStorage.getItem('danmakuFilterLevel');
                level = ((level ? parseInt(level) : 0) + 1) % 4;
                window.localStorage.setItem('danmakuFilterLevel', level);
                document.querySelector('#filteringDanmaku').children[0].className = spanClass + filter_icons[level];
                reloadDanmaku('reload');
            },
        };

        const sourceButtonOpts = {
            title: '手动增加弹幕源',
            id: 'addDanmakuSource',
            class: source_icon,
            onclick: () => {
                showDebugInfo('手动增加弹幕源');
                let source = prompt('请输入弹幕源地址:');
                if (source) {
                    getCommentsByUrl(source).then((comments) => {
                        createDanmaku(comments).then(() => {
                            showDebugInfo('弹幕就位');
                        });
                    });
                }
            },
        }

        const logButtonOpts = {
            title: '日志开关',
            id: 'displayLog',
            class: log_icon,
            onclick: () => {
                if (window.ede.loading) {
                    showDebugInfo('正在加载,请稍后再试');
                    return;
                }
                // showDebugInfo('切换日志开关');
                window.ede.logSwitch = (window.ede.logSwitch + 1) % 2;
                window.localStorage.setItem('logSwitch', window.ede.logSwitch);
                let logSpan = document.querySelector('#debugInfo');
                if (logSpan) {
                    window.ede.logSwitch == 1 ? (logSpan.style.display = 'block') : (logSpan.style.display = 'none');
                }
            }
        };

        const danmakuInteractionOpts = {
            title: '弹幕设置',
            id: 'danmakuSettings',
            class: settings_icon,
            onclick: () => {
                let opacityStr = prompt("请输入0-1之间的透明度值（如0.7）", window.ede.opacity || 0.7);
                let speedStr = prompt("请输入0-1000弹幕速度（如200）", window.ede.speed || 200);
                let sizeStr = prompt("请输入1-30弹幕大小（如18）", window.ede.fontSize || 18);
                let heightRatio = prompt("请输入0-1之间的弹幕高度屏幕占比（如0.7）", window.ede.heightRatio || 0.7)
                if (!opacityStr || !speedStr) return;
                if (window.ede) {
                    try {
                        let tmpOpacity = parseFloatOfRange(opacityStr, 0, 1);
                        let tmpSpeed = parseFloatOfRange(speedStr, 0, 1000);
                        let tmpSize = parseFloatOfRange(sizeStr, 1, 30);
                        let tmpHeightRatio = parseFloatOfRange(heightRatio, 0, 1);
                        if (isNaN(tmpOpacity) || isNaN(tmpSpeed) || isNaN(tmpSize) || isNaN(tmpHeightRatio)) {
                            throw EvalError('输入无效，请输入有效的数字。');
                        }
                        // 设置透明度
                        window.ede.opacity = tmpOpacity;
                        showDebugInfo(`设置弹幕透明度：${window.ede.opacity}`);
                        window.localStorage.setItem('danmakuopacity', window.ede.opacity.toString());
                        // 设置弹幕速度
                        window.ede.speed = tmpSpeed;
                        showDebugInfo(`设置弹幕速度：${window.ede.speed}`);
                        window.localStorage.setItem('danmakuspeed', window.ede.speed.toString());
                        // 设置弹幕大小
                        window.ede.fontSize = tmpSize;
                        showDebugInfo(`设置弹幕大小：${window.ede.fontSize}`);
                        window.localStorage.setItem('danmakusize', window.ede.fontSize.toString());
                        // 设置弹幕高度
                        window.ede.heightRatio = tmpHeightRatio;
                        showDebugInfo(`设置弹幕高度：${window.ede.heightRatio}`);
                        window.localStorage.setItem('danmakuheight', window.ede.heightRatio.toString());
                        //Reload
                        reloadDanmaku('reload');
                    } catch (e) {
                        alert(`Invalid input: ${e.message}`);
                        showDebugInfo(e);
                    }
                }
            }
        };



        // ------ configs end------
        /* eslint-disable */
        /* https://cdn.jsdelivr.net/npm/danmaku/dist/danmaku.min.js */
        // prettier-ignore
        !function (t, e) { "object" == typeof exports && "undefined" != typeof module ? module.exports = e() : "function" == typeof define && define.amd ? define(e) : (t = "undefined" != typeof globalThis ? globalThis : t || self).Danmaku = e() }(this, (function () { "use strict"; var t = function () { if ("undefined" == typeof document) return "transform"; for (var t = ["oTransform", "msTransform", "mozTransform", "webkitTransform", "transform"], e = document.createElement("div").style, i = 0; i < t.length; i++)if (t[i] in e) return t[i]; return "transform" }(); function e(t) { var e = document.createElement("div"); if (e.style.cssText = "position:absolute;", "function" == typeof t.render) { var i = t.render(); if (i instanceof HTMLElement) return e.appendChild(i), e } if (e.textContent = t.text, t.style) for (var n in t.style) e.style[n] = t.style[n]; return e } var i = { name: "dom", init: function () { var t = document.createElement("div"); return t.style.cssText = "overflow:hidden;white-space:nowrap;transform:translateZ(0);", t }, clear: function (t) { for (var e = t.lastChild; e;)t.removeChild(e), e = t.lastChild }, resize: function (t, e, i) { t.style.width = e + "px", t.style.height = i + "px" }, framing: function () { }, setup: function (t, i) { var n = document.createDocumentFragment(), s = 0, r = null; for (s = 0; s < i.length; s++)(r = i[s]).node = r.node || e(r), n.appendChild(r.node); for (i.length && t.appendChild(n), s = 0; s < i.length; s++)(r = i[s]).width = r.width || r.node.offsetWidth, r.height = r.height || r.node.offsetHeight }, render: function (_e, i) { i.node.style[t] = "translate(" + i.x + "px," + i.y + "px)" }, remove: function (t, e) { t.removeChild(e.node), this.media || (e.node = null) } }, n = "undefined" != typeof window && window.devicePixelRatio || 1, s = Object.create(null); function r(t, e) { if ("function" == typeof t.render) { var i = t.render(); if (i instanceof HTMLCanvasElement) return t.width = i.width, t.height = i.height, i } var r = document.createElement("canvas"), h = r.getContext("2d"), o = t.style || {}; o.font = o.font || "10px sans-serif", o.textBaseline = o.textBaseline || "bottom"; var a = 1 * o.lineWidth; for (var d in a = a > 0 && a !== 1 / 0 ? Math.ceil(a) : 1 * !!o.strokeStyle, h.font = o.font, t.width = t.width || Math.max(1, Math.ceil(h.measureText(t.text).width) + 2 * a), t.height = t.height || Math.ceil(function (t, e) { if (s[t]) return s[t]; var i = 12, n = t.match(/(\d+(?:\.\d+)?)(px|%|em|rem)(?:\s*\/\s*(\d+(?:\.\d+)?)(px|%|em|rem)?)?/); if (n) { var r = 1 * n[1] || 10, h = n[2], o = 1 * n[3] || 1.2, a = n[4]; "%" === h && (r *= e.container / 100), "em" === h && (r *= e.container), "rem" === h && (r *= e.root), "px" === a && (i = o), "%" === a && (i = r * o / 100), "em" === a && (i = r * o), "rem" === a && (i = e.root * o), void 0 === a && (i = r * o) } return s[t] = i, i }(o.font, e)) + 2 * a, r.width = t.width * n, r.height = t.height * n, h.scale(n, n), o) h[d] = o[d]; var u = 0; switch (o.textBaseline) { case "top": case "hanging": u = a; break; case "middle": u = t.height >> 1; break; default: u = t.height - a }return o.strokeStyle && h.strokeText(t.text, a, u), h.fillText(t.text, a, u), r } function h(t) { return 1 * window.getComputedStyle(t, null).getPropertyValue("font-size").match(/(.+)px/)[1] } var o = { name: "canvas", init: function (t) { var e = document.createElement("canvas"); return e.context = e.getContext("2d"), e._fontSize = { root: h(document.getElementsByTagName("html")[0]), container: h(t) }, e }, clear: function (t, e) { t.context.clearRect(0, 0, t.width, t.height); for (var i = 0; i < e.length; i++)e[i].canvas = null }, resize: function (t, e, i) { t.width = e * n, t.height = i * n, t.style.width = e + "px", t.style.height = i + "px" }, framing: function (t) { t.context.clearRect(0, 0, t.width, t.height) }, setup: function (t, e) { for (var i = 0; i < e.length; i++) { var n = e[i]; n.canvas = r(n, t._fontSize) } }, render: function (t, e) { t.context.drawImage(e.canvas, e.x * n, e.y * n) }, remove: function (_t, e) { e.canvas = null } }; function a(t) { var e = this, i = this.media ? this.media.currentTime : Date.now() / 1e3, n = this.media ? this.media.playbackRate : 1; function s(t, s) { if ("top" === s.mode || "bottom" === s.mode) return i - t.time < e._.duration; var r = (e._.width + t.width) * (i - t.time) * n / e._.duration; if (t.width > r) return !0; var h = e._.duration + t.time - i, o = e._.width + s.width, a = e.media ? s.time : s._utc, d = o * (i - a) * n / e._.duration, u = e._.width - d; return h > e._.duration * u / (e._.width + s.width) } for (var r = this._.space[t.mode], h = 0, o = 0, a = 1; a < r.length; a++) { var d = r[a], u = t.height; if ("top" !== t.mode && "bottom" !== t.mode || (u += d.height), d.range - d.height - r[h].range >= u) { o = a; break } s(d, t) && (h = a) } var m = r[h].range, c = { range: m + t.height, time: this.media ? t.time : t._utc, width: t.width, height: t.height }; return r.splice(h + 1, o - h - 1, c), "bottom" === t.mode ? this._.height - t.height - m % this._.height : m % (this._.height - t.height) } var d = "undefined" != typeof window && (window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame) || function (t) { return setTimeout(t, 50 / 3) }, u = "undefined" != typeof window && (window.cancelAnimationFrame || window.mozCancelAnimationFrame || window.webkitCancelAnimationFrame) || clearTimeout; function m(t, e, i) { for (var n = 0, s = 0, r = t.length; s < r - 1;)i >= t[n = s + r >> 1][e] ? s = n : r = n; return t[s] && i < t[s][e] ? s : r } function c(t) { return /^(ltr|top|bottom)$/i.test(t) ? t.toLowerCase() : "rtl" } function l() { var t = 9007199254740991; return [{ range: 0, time: -t, width: t, height: 0 }, { range: t, time: t, width: 0, height: 0 }] } function f(t) { t.ltr = l(), t.rtl = l(), t.top = l(), t.bottom = l() } function p() { if (!this._.visible || !this._.paused) return this; if (this._.paused = !1, this.media) for (var t = 0; t < this._.runningList.length; t++) { var e = this._.runningList[t]; e._utc = Date.now() / 1e3 - (this.media.currentTime - e.time) } var i = this, n = function (t, e, i, n) { return function () { t(this._.stage); var s = Date.now() / 1e3, r = this.media ? this.media.currentTime : s, h = this.media ? this.media.playbackRate : 1, o = null, d = 0, u = 0; for (u = this._.runningList.length - 1; u >= 0; u--)o = this._.runningList[u], r - (d = this.media ? o.time : o._utc) > this._.duration && (n(this._.stage, o), this._.runningList.splice(u, 1)); for (var m = []; this._.position < this.comments.length && (o = this.comments[this._.position], !((d = this.media ? o.time : o._utc) >= r));)r - d > this._.duration || (this.media && (o._utc = s - (this.media.currentTime - o.time)), m.push(o)), ++this._.position; for (e(this._.stage, m), u = 0; u < m.length; u++)(o = m[u]).y = a.call(this, o), this._.runningList.push(o); for (u = 0; u < this._.runningList.length; u++) { o = this._.runningList[u]; var c = (this._.width + o.width) * (s - o._utc) * h / this._.duration; "ltr" === o.mode && (o.x = c - o.width + .5 | 0), "rtl" === o.mode && (o.x = this._.width - c + .5 | 0), "top" !== o.mode && "bottom" !== o.mode || (o.x = this._.width - o.width >> 1), i(this._.stage, o) } } }(this._.engine.framing.bind(this), this._.engine.setup.bind(this), this._.engine.render.bind(this), this._.engine.remove.bind(this)); return this._.requestID = d((function t() { n.call(i), i._.requestID = d(t) })), this } function g() { return !this._.visible || this._.paused || (this._.paused = !0, u(this._.requestID), this._.requestID = 0), this } function _() { if (!this.media) return this; this.clear(), f(this._.space); var t = m(this.comments, "time", this.media.currentTime); return this._.position = Math.max(0, t - 1), this } function v(t) { t.play = p.bind(this), t.pause = g.bind(this), t.seeking = _.bind(this), this.media.addEventListener("play", t.play), this.media.addEventListener("pause", t.pause), this.media.addEventListener("playing", t.play), this.media.addEventListener("waiting", t.pause), this.media.addEventListener("seeking", t.seeking) } function w(t) { this.media.removeEventListener("play", t.play), this.media.removeEventListener("pause", t.pause), this.media.removeEventListener("playing", t.play), this.media.removeEventListener("waiting", t.pause), this.media.removeEventListener("seeking", t.seeking), t.play = null, t.pause = null, t.seeking = null } function y(t) { this._ = {}, this.container = t.container || document.createElement("div"), this.media = t.media, this._.visible = !0, this.engine = (t.engine || "DOM").toLowerCase(), this._.engine = "canvas" === this.engine ? o : i, this._.requestID = 0, this._.speed = Math.max(0, t.speed) || 144, this._.duration = 4, this.comments = t.comments || [], this.comments.sort((function (t, e) { return t.time - e.time })); for (var e = 0; e < this.comments.length; e++)this.comments[e].mode = c(this.comments[e].mode); return this._.runningList = [], this._.position = 0, this._.paused = !0, this.media && (this._.listener = {}, v.call(this, this._.listener)), this._.stage = this._.engine.init(this.container), this._.stage.style.cssText += "position:relative;pointer-events:none;", this.resize(), this.container.appendChild(this._.stage), this._.space = {}, f(this._.space), this.media && this.media.paused || (_.call(this), p.call(this)), this } function x() { if (!this.container) return this; for (var t in g.call(this), this.clear(), this.container.removeChild(this._.stage), this.media && w.call(this, this._.listener), this) Object.prototype.hasOwnProperty.call(this, t) && (this[t] = null); return this } var b = ["mode", "time", "text", "render", "style"]; function L(t) { if (!t || "[object Object]" !== Object.prototype.toString.call(t)) return this; for (var e = {}, i = 0; i < b.length; i++)void 0 !== t[b[i]] && (e[b[i]] = t[b[i]]); if (e.text = (e.text || "").toString(), e.mode = c(e.mode), e._utc = Date.now() / 1e3, this.media) { var n = 0; void 0 === e.time ? (e.time = this.media.currentTime, n = this._.position) : (n = m(this.comments, "time", e.time)) < this._.position && (this._.position += 1), this.comments.splice(n, 0, e) } else this.comments.push(e); return this } function T() { return this._.visible ? this : (this._.visible = !0, this.media && this.media.paused || (_.call(this), p.call(this)), this) } function E() { return this._.visible ? (g.call(this), this.clear(), this._.visible = !1, this) : this } function k() { return this._.engine.clear(this._.stage, this._.runningList), this._.runningList = [], this } function C() { return this._.width = this.container.offsetWidth, this._.height = this.container.offsetHeight, this._.engine.resize(this._.stage, this._.width, this._.height), this._.duration = this._.width / this._.speed, this } var D = { get: function () { return this._.speed }, set: function (t) { return "number" != typeof t || isNaN(t) || !isFinite(t) || t <= 0 ? this._.speed : (this._.speed = t, this._.width && (this._.duration = this._.width / t), t) } }; function z(t) { t && y.call(this, t) } return z.prototype.destroy = function () { return x.call(this) }, z.prototype.emit = function (t) { return L.call(this, t) }, z.prototype.show = function () { return T.call(this) }, z.prototype.hide = function () { return E.call(this) }, z.prototype.clear = function () { return k.call(this) }, z.prototype.resize = function () { return C.call(this) }, Object.defineProperty(z.prototype, "speed", D), z }));
        /* eslint-enable */

        // 检测是否在Tampermonkey中运行
        if (typeof GM_addStyle === 'undefined') {
            isInTampermonkey = false;
        } else {
            apiPrefix = '';
        }

        class EDE {
            constructor() {
                this.chConvert = 1;
                if (window.localStorage.getItem('chConvert')) {
                    this.chConvert = window.localStorage.getItem('chConvert');
                }
                // 0:当前状态关闭 1:当前状态打开
                this.danmakuSwitch = 1;
                if (window.localStorage.getItem('danmakuSwitch')) {
                    this.danmakuSwitch = parseInt(window.localStorage.getItem('danmakuSwitch'));
                }
                this.logSwitch = 0;
                if (window.localStorage.getItem('logSwitch')) {
                    this.logSwitch = parseInt(window.localStorage.getItem('logSwitch'));
                }
                let opacityRecord = window.localStorage.getItem('danmakuopacity')
                this.opacity = opacityRecord ? parseFloatOfRange(opacityRecord, 0.0, 1.0) : 0.7
                let speedRecord = window.localStorage.getItem('danmakuspeed')
                this.speed = speedRecord ? parseFloatOfRange(speedRecord, 0.0, 1000.0) : 200
                let sizeRecord = window.localStorage.getItem('danmakusize')
                this.fontSize = sizeRecord ? parseFloatOfRange(sizeRecord, 0.0, 50.0) : 18
                let heightRecord = window.localStorage.getItem('danmakuheight')
                this.heightRatio = heightRecord ? parseFloatOfRange(heightRecord, 0.0, 1.0) : 0.7
                this.danmaku = null;
                this.episode_info = null;
                this.episode_info_str = '';
                this.obResize = null;
                this.obMutation = null;
                this.loading = false;
            }
        }

        const parseFloatOfRange = (str, lb, hb) => Math.min(Math.max(parseFloat(str), lb), hb)


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
            if (!container.getAttribute('ede_listening')) {
                showDebugInfo('正在初始化Listener');
                container.setAttribute('ede_listening', true);
                container.addEventListener('play', reloadDanmaku);
                showDebugInfo('Listener初始化完成');
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
                    uiEle = element;
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

            parent.insertBefore(menubar, uiEle);
            // 弹幕开关
            displayButtonOpts.class = danmaku_icons[window.ede.danmakuSwitch];
            menubar.appendChild(createButton(displayButtonOpts));
            // 手动匹配
            menubar.appendChild(createButton(searchButtonOpts));
            // 简繁转换
            translateButtonOpts.title = chConverTtitle[window.ede.chConvert];
            menubar.appendChild(createButton(translateButtonOpts));
            // 屏蔽等级
            filterButtonOpts.class = filter_icons[parseInt(window.localStorage.getItem('danmakuFilterLevel') ? window.localStorage.getItem('danmakuFilterLevel') : 0)];
            menubar.appendChild(createButton(filterButtonOpts));
            // 手动增加弹幕源
            menubar.appendChild(createButton(sourceButtonOpts));
            // 弹幕设置
            menubar.appendChild(createButton(danmakuInteractionOpts));

            if (debugInfoLoc == 'ui') {
                menubar.appendChild(createButton(logButtonOpts));

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
                span.style.left = '10px';
                span.style.top = '50px';
                window.ede.logSwitch == 1 ? (span.style.display = 'block') : (span.style.display = 'none');
                _container.appendChild(span);
            }

            showDebugInfo('UI初始化完成');
        }

        async function showDebugInfo(msg) {
            if (debugInfoLoc == 'ui') {
                let span = document.getElementById('debugInfo');
                while (!span) {
                    await new Promise((resolve) => setTimeout(resolve, 200));
                    span = document.getElementById('debugInfo');
                }
                if (logLines < 10) {
                    logLines++;
                    logQueue.push(msg);
                } else {
                    logQueue.shift();
                    logQueue.push(msg);
                }
                span.innerText = '';
                logQueue.forEach((line) => {
                    span.innerText += line + '\n';
                });
            } else if (debugInfoLoc == 'console') {
                console.log(msg);
            }
        }

        async function initConfig() {
            showDebugInfo('serverInfo');
            let token = serversInfo[0].AccessToken;
            userId = serversInfo[0].UserId;

            let sessionUrl = baseUrl + '/Sessions?ControllableByUserId=' + userId
            if (deviceId) {
                sessionUrl += '&DeviceId=' + deviceId;
            }

            showDebugInfo('Get DevId');
            let sessionInfo = await fetch(sessionUrl, {
                "credentials": "include",
                "headers": {
                    "Accept": "application/json",
                    "Authorization": "MediaBrowser Token=\"" + token + "\""
                },
                "method": "GET",
                "mode": "cors"
            }).then(res => res.json());

            if (!deviceId) {
                deviceId = sessionInfo[0].DeviceId;
                localStorage.setItem('_deviceId2', deviceId);
            }

            let clientName = sessionInfo[0].Client;
            let deviceName = sessionInfo[0].DeviceName;
            let serverVersion = sessionInfo[0].ApplicationVersion;
            // Ref: https://gist.github.com/nielsvanvelzen/ea047d9028f676185832e51ffaf12a6f
            authorization = "MediaBrowser Client=\"" + clientName + "\", Device=\"" + deviceName + "\", DeviceId=\"" + deviceId + "\", Version=\"" + serverVersion + "\", Token=\"" + token + "\"";
            return deviceId;
        }


        async function getEmbyItemInfo() {
            showDebugInfo('准备获取Item信息');
            if (authorization.length > 0 && userId.length > 0 && deviceId.length > 0) {
                showDebugInfo('正在获取Item信息');
                let playingInfo = null;
                while (!playingInfo) {
                    await new Promise((resolve) => setTimeout(resolve, 200));
                    let sessionUrl = baseUrl + '/Sessions?ControllableByUserId=' + userId + '&deviceId=' + deviceId;
                    showDebugInfo(sessionUrl);
                    let sessionInfo = await fetch(sessionUrl, {
                        "credentials": "include",
                        "headers": {
                            "Accept": "application/json",
                            "Authorization": authorization
                        },
                        "method": "GET",
                        "mode": "cors"
                    }).then(res => res.json());
                    playingInfo = sessionInfo[0].NowPlayingItem;
                }
                showDebugInfo('成功 ' + (playingInfo.SeriesName || playingInfo.Name));
                return playingInfo;
            } else {
                showDebugInfo('等待Config');
                await initConfig();
            }
        }

        function makeGetRequest(url) {
            if (isInTampermonkey) {
                return new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: url,
                        headers: {
                            "Accept-Encoding": "gzip,br",
                            "Accept": "application/json"
                        },
                        onload: function (response) {
                            resolve(response.responseText);
                        },
                        onerror: function (error) {
                            reject(error);
                        }
                    });
                });
            } else {
                return fetch(url, {
                    method: 'GET',
                    headers: {
                        "Accept-Encoding": "gzip,br",
                        "Accept": "application/json",
                        "User-Agent": navigator.userAgent
                    }
                })
            }
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
                    window.ede.episode_info_str = episodeInfo.animeTitle + '\n' + episodeInfo.episodeTitle;
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
                animeName = prompt('确认动画名:', animeName);
            }

            let searchUrl = apiPrefix + 'https://api.dandanplay.net/api/v2/search/episodes?anime=' + animeName + '&withRelated=true';
            let animaInfo = await makeGetRequest(searchUrl)
                .then((response) => isInTampermonkey ? JSON.parse(response) : response.json())
                .catch((error) => {
                    showDebugInfo('查询失败:', error);
                    return null;
                });
            if (animaInfo.animes.length == 0) {
                showDebugInfo('弹幕查询无结果');
                return null;
            }
            showDebugInfo('查询成功');

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
                selecAnime_id = prompt('选择节目:\n' + anime_lists_str, selecAnime_id);
                selecAnime_id = parseInt(selecAnime_id) - 1;
                window.localStorage.setItem(_id_key, animaInfo.animes[selecAnime_id].animeId);
                window.localStorage.setItem(_name_key, animaInfo.animes[selecAnime_id].animeTitle);
                let episode_lists_str = ep2string(animaInfo.animes[selecAnime_id].episodes);
                episode = prompt('选择剧集:\n' + episode_lists_str, parseInt(episode) || 1);
                episode = parseInt(episode) - 1;
            } else {
                selecAnime_id = parseInt(selecAnime_id) - 1;
                let initialTitle = animaInfo.animes[selecAnime_id].episodes[0].episodeTitle;
                const match = initialTitle.match(/第(\d+)话/);
                const initialep = match ? parseInt(match[1]) : 0;
                episode = (parseInt(episode) < initialep) ? parseInt(episode) - 1 : (parseInt(episode) - initialep);
            }
            let episodeInfo = {
                episodeId: animaInfo.animes[selecAnime_id].episodes[episode].episodeId,
                animeTitle: animaInfo.animes[selecAnime_id].animeTitle,
                episodeTitle: animaInfo.animes[selecAnime_id].type === 'tvseries' ? animaInfo.animes[selecAnime_id].episodes[episode].episodeTitle : (animaInfo.animes[selecAnime_id].type === 'movie' ? '剧场版' : 'Other'),
            };
            window.localStorage.setItem(_episode_key, JSON.stringify(episodeInfo));
            window.ede.episode_info_str = episodeInfo.animeTitle + '\n' + episodeInfo.episodeTitle;
            return episodeInfo;
        }

        function getComments(episodeId) {
            let url = apiPrefix + 'https://api.dandanplay.net/api/v2/comment/' + episodeId + '?withRelated=true&chConvert=' + window.ede.chConvert;
            return makeGetRequest(url)
                .then((response) => isInTampermonkey ? JSON.parse(response) : response.json())
                .then((data) => {
                    showDebugInfo('弹幕下载成功: ' + data.comments.length);
                    return data.comments;
                })
                .catch((error) => {
                    showDebugInfo('获取弹幕失败:', error);
                    return null;
                });
        }

        async function getCommentsByUrl(src) {
            const url_encoded = encodeURIComponent(src);
            const url = apiPrefix + 'https://api.dandanplay.net/api/v2/extcomment?url=' + url_encoded;
            let comments = [];
            for (let i = 0; i < 2; i++) {
                comments = makeGetRequest(url)
                    .then((response) => isInTampermonkey ? JSON.parse(response) : response.json())
                    .then((data) => {
                        showDebugInfo('弹幕下载成功: ' + data.comments.length);
                        return data.comments;
                    })
                    .catch((error) => {
                        showDebugInfo('获取弹幕失败:', error);
                        return null;
                    });
                if (comments.length > 0) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            return comments;
        }

        async function createDanmaku(comments) {
            if (!comments) {
                return;
            }

            let wrapper = document.getElementById('danmakuWrapper');
            wrapper && wrapper.parentNode.removeChild(wrapper);
            if (window.ede.danmaku != null) {
                window.ede.danmaku.clear();
                window.ede.danmaku.destroy();
                window.ede.danmaku = null;
            }
            let _comments = danmakuFilter(danmakuParser(comments));
            showDebugInfo('弹幕加载成功: ' + _comments.length);
            showDebugInfo(`弹幕透明度：${window.ede.opacity}`);
            showDebugInfo(`弹幕速度：${window.ede.speed}`);
            showDebugInfo(`弹幕高度比例：${window.ede.heightRatio}`);

            while (!document.querySelector(mediaContainerQueryStr)) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }

            let _container = null;
            document.querySelectorAll(mediaContainerQueryStr).forEach(function (element) {
                if (!element.classList.contains('hide')) {
                    _container = element;
                }
            });
            if (!_container) {
                showDebugInfo('未找到播放器');
            }
            let _media = document.querySelector(mediaQueryStr);
            if (!_media) {
                showDebugInfo('未找到video');
            }

            wrapper = document.createElement('div');
            wrapper.id = 'danmakuWrapper';
            wrapper.style.position = 'absolute';
            wrapper.style.width = '100%';
            wrapper.style.height = window.ede.heightRatio * 100 + '%';
            wrapper.style.top = '18px';
            wrapper.style.overflow = 'hidden';
            _container.prepend(wrapper);

            window.ede.danmaku = new Danmaku({
                container: wrapper,
                media: _media,
                comments: _comments,
                engine: 'canvas',
            });

            wrapper.lastChild.style.opacity = window.ede.opacity;
            window.ede.danmaku.speed = window.ede.speed
            wrapper.style.height = `${window.ede.heightRatio * 100}%`;

            window.ede.danmakuSwitch == 1 ? window.ede.danmaku.show() : window.ede.danmaku.hide();
            if (window.ede.obResize) {
                window.ede.obResize.disconnect();
            }
            window.ede.obResize = new ResizeObserver(() => {
                if (window.ede.danmaku) {
                    showDebugInfo('Resizing');
                    window.ede.danmaku.resize();
                }
            });
            window.ede.obResize.observe(_container);

            if (window.ede.obMutation) {
                window.ede.obMutation.disconnect();
            }
            window.ede.obMutation = new MutationObserver(() => {
                if (window.ede.danmaku && document.querySelector(mediaQueryStr)) {
                    showDebugInfo('Video Changed');
                    reloadDanmaku('reload');
                }
            });
            window.ede.obMutation.observe(_media, { attributes: true });

            if (!window.obVideo) {
                window.obVideo = new MutationObserver((mutationList, _observer) => {
                    for (let mutationRecord of mutationList) {
                        if (mutationRecord.removedNodes) {
                            for (let removedNode of mutationRecord.removedNodes) {
                                if (removedNode.className && removedNode.classList.contains('videoPlayerContainer')) {
                                    console.log('Video Removed');
                                    window.ede.loading = false;
                                    return;
                                }
                            }
                        }
                    }
                });
                window.obVideo.observe(document.body, { childList: true });
            }
        }

        function reloadDanmaku(type = 'check') {
            if (window.ede.loading) {
                showDebugInfo('正在重新加载');
                return;
            }
            window.ede.loading = true;
            getEpisodeInfo(type != 'search')
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
                            resolve(info.episodeId);
                        }
                    });
                })
                .then(
                    (episodeId) =>
                        getComments(episodeId).then((comments) =>
                            createDanmaku(comments).then(() => {
                                showDebugInfo(window.ede.episode_info_str + '\n 弹幕就位');
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

        function danmakuFilter(comments) {
            let level = parseInt(window.localStorage.getItem('danmakuFilterLevel') ? window.localStorage.getItem('danmakuFilterLevel') : 0);
            if (level == 0) {
                return comments;
            }
            let limit = 9 - level * 2;
            let vertical_limit = 6;
            let arr_comments = [];
            let vertical_comments = [];
            for (let index = 0; index < comments.length; index++) {
                let element = comments[index];
                let i = Math.ceil(element.time);
                let i_v = Math.ceil(element.time / 3);
                if (!arr_comments[i]) {
                    arr_comments[i] = [];
                }
                if (!vertical_comments[i_v]) {
                    vertical_comments[i_v] = [];
                }
                // TODO: 屏蔽过滤
                if (vertical_comments[i_v].length < vertical_limit) {
                    vertical_comments[i_v].push(element);
                } else {
                    element.mode = 'rtl';
                }
                if (arr_comments[i].length < limit) {
                    arr_comments[i].push(element);
                }
            }
            return arr_comments.flat();
        }

        function danmakuParser($obj) {
            // const fontSize = Math.round(((window.screen.height > window.screen.width ? window.screen.width : window.screen.height) / 1080) * 18);
            const fontSize = window.ede.fontSize; // font size is buggy on mobile, use fixed size instead
            showDebugInfo('Screen: ' + window.screen.width + 'x' + window.screen.height);
            showDebugInfo('fontSize: ' + fontSize);
            return $obj
                .map(($comment) => {
                    const p = $comment.p;
                    //if (p === null || $comment.childNodes[0] === undefined) return null
                    const values = p.split(',');
                    const mode = { 6: 'ltr', 1: 'rtl', 5: 'top', 4: 'bottom' }[values[1]];
                    if (!mode) return null;
                    const color = `000000${Number(values[2]).toString(16)}`.slice(-6);
                    return {
                        text: $comment.m,
                        mode,
                        time: values[0] * 1,
                        style: {
                            font: `${fontSize}px sans-serif`,
                            fillStyle: `#${color}`,
                            strokeStyle: color === '000000' ? '#fff' : '#000',
                            lineWidth: 2.0,
                        },
                    };
                })
                .filter((x) => x);
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

        while (!document.querySelector('.htmlvideoplayer')) {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (!window.ede) {
            window.ede = new EDE();
            setInterval(() => {
                initUI();
            }, check_interval);
            while (!(await initConfig())) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
            reloadDanmaku('init');
            setInterval(() => {
                initListener();
            }, check_interval);
        }
    }
})();
