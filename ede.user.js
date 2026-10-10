// ==UserScript==
// @name         Jellyfin danmaku extension
// @description  Jellyfin弹幕插件（含 dd-danmaku 的屏蔽 / 相似弹幕合并与第三方 API 适配）
// @namespace    https://github.com/RyoLee
// @author       RyoLee, Izumiko, Xarth-Mai, guiyuanyuanbao, chen3861229, misaka10876
// @version      1.62.0
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
    // v2：非 Jellyfin 前端（例如 Jellyfin-Vue）没有这个 meta，直接 .content 会抛 TypeError（上游 issue #24）
    if (document.querySelector('meta[name="application-name"]')?.content !== 'Jellyfin') {
        return;
    }
    // ------ configs start------
    const corsProxy = 'https://ddplay-api.930524.xyz/cors/';
    const apiPrefix = 'https://api.dandanplay.net';
    let ddplayStatus = JSON.parse(localStorage.getItem('ddplayStatus')) || { isLogin: false, token: '', tokenExpire: 0 };
    const check_interval = 200;
    // 0:当前状态关闭 1:当前状态打开
    let danmaku_icons = ['comments_disabled', 'comment'];
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

    // 从请求地址里取当前播放条目 id：PlaybackInfo、直接播放的 stream、HLS 的 m3u8
    const itemIdUrlRegex = /\/(?:Items|Videos)\/([0-9a-f]{32}|[0-9a-f-]{36})\/(?:PlaybackInfo|stream|master\.m3u8|main\.m3u8)/i;
    function captureItemIdFromUrl(url) {
        const match = String(url || '').match(itemIdUrlRegex);
        if (match) {
            itemId = match[1].replace(/-/g, '');
        }
    }

    // 直接播放时 video.src 不经过 XHR/fetch，换集时从 loadstart 取 id（媒体事件不冒泡，用捕获阶段）
    document.addEventListener(
        'loadstart',
        (event) => {
            if (event.target instanceof HTMLVideoElement) {
                captureItemIdFromUrl(event.target.currentSrc);
            }
        },
        true,
    );

    // 新版前端的 ApiClient 走 fetch
    const originalFetch = window.fetch;
    window.fetch = function (input) {
        captureItemIdFromUrl(typeof input === 'string' ? input : input?.url);
        return originalFetch.apply(this, arguments);
    };

    // Intercept XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (_, url) {
        captureItemIdFromUrl(url);
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
                        loginDanDanPlay(account, password).then((status) => {
                            if (status) {
                                document.getElementById('loginBtn').innerText = '登录✔️';
                                let sleep = new Promise((resolve) => setTimeout(resolve, 1500));
                                sleep.then(() => {
                                    document.getElementById('loginDialog').style.display = 'none';
                                });
                                modal.removeEventListener('keydown', (event) => event.stopPropagation(), true);
                            }
                        });
                    }
                };
                document.getElementById('cancelBtn').onclick = () => {
                    document.getElementById('loginDialog').style.display = 'none';
                    modal.removeEventListener('keydown', (event) => event.stopPropagation(), true);
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
                    modal.removeEventListener('keydown', (event) => event.stopPropagation(), true);
                };
                document.getElementById('cancelSendDanmakuBtn').onclick = () => {
                    modal.style.display = 'none';
                    modal.removeEventListener('keydown', (event) => event.stopPropagation(), true);
                };
            }

            if (ddplayStatus.isLogin) {
                const txt = document.getElementById('danmakuText');
                txt.placeholder = '请输入弹幕内容';
                txt.value = '';
                txt.focus();
                document.getElementById('sendDanmakuDialog').style.display = 'block';
                document.getElementById('sendDanmakuDialog').addEventListener('keydown', (event) => event.stopPropagation(), true);
                const animeTitle = window.ede.episode_info ? window.ede.episode_info.animeTitle : '';
                const episodeTitle = window.ede.episode_info ? window.ede.episode_info.episodeTitle : '';
                document.getElementById('lbAnimeTitle').innerText = `当前番剧: ${animeTitle || ''}`;
                document.getElementById('lbEpisodeTitle').innerText = `当前集数: ${episodeTitle || ''}`;
            } else {
                document.getElementById('loginDialog').style.display = 'block';
                document.getElementById('loginDialog').addEventListener('keydown', (event) => event.stopPropagation(), true);
            }
        },
    };

    // ------ configs end------
    /* eslint-disable */
    /* https://cdn.jsdelivr.net/npm/danmaku/dist/danmaku.min.js */
    // prettier-ignore
    !function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t="undefined"!=typeof globalThis?globalThis:t||self).Danmaku=e()}(this,(function(){"use strict";var t=function(){if("undefined"==typeof document)return"transform";for(var t=["oTransform","msTransform","mozTransform","webkitTransform","transform"],e=document.createElement("div").style,i=0;i<t.length;i++)if(t[i]in e)return t[i];return"transform"}();function e(t){var e=document.createElement("div");if(e.style.cssText="position:absolute;","function"==typeof t.render){var i=t.render();if(i instanceof HTMLElement)return e.appendChild(i),e}if(e.textContent=t.text,t.style)for(var n in t.style)e.style[n]=t.style[n];return e}var i={name:"dom",init:function(){var t=document.createElement("div");return t.style.cssText="overflow:hidden;white-space:nowrap;transform:translateZ(0);",t},clear:function(t){for(var e=t.lastChild;e;)t.removeChild(e),e=t.lastChild},resize:function(t,e,i){t.style.width=e+"px",t.style.height=i+"px"},framing:function(){},setup:function(t,i){var n=document.createDocumentFragment(),s=0,r=null;for(s=0;s<i.length;s++)(r=i[s]).node=r.node||e(r),n.appendChild(r.node);for(i.length&&t.appendChild(n),s=0;s<i.length;s++)(r=i[s]).width=r.width||r.node.offsetWidth,r.height=r.height||r.node.offsetHeight},render:function(e,i){i.node.style[t]="translate("+i.x+"px,"+i.y+"px)"},remove:function(t,e){t.removeChild(e.node),this.media||(e.node=null)}},n="undefined"!=typeof window&&window.devicePixelRatio||1,s=Object.create(null);function r(t,e){if("function"==typeof t.render){var i=t.render();if(i instanceof HTMLCanvasElement)return t.width=i.width,t.height=i.height,i}var r=document.createElement("canvas"),h=r.getContext("2d"),o=t.style||{};o.font=o.font||"10px sans-serif",o.textBaseline=o.textBaseline||"bottom";var a=1*o.lineWidth;for(var d in a=a>0&&a!==1/0?Math.ceil(a):1*!!o.strokeStyle,h.font=o.font,t.width=t.width||Math.max(1,Math.ceil(h.measureText(t.text).width)+2*a),t.height=t.height||Math.ceil(function(t,e){if(s[t])return s[t];var i=12,n=t.match(/(\d+(?:\.\d+)?)(px|%|em|rem)(?:\s*\/\s*(\d+(?:\.\d+)?)(px|%|em|rem)?)?/);if(n){var r=1*n[1]||10,h=n[2],o=1*n[3]||1.2,a=n[4];"%"===h&&(r*=e.container/100),"em"===h&&(r*=e.container),"rem"===h&&(r*=e.root),"px"===a&&(i=o),"%"===a&&(i=r*o/100),"em"===a&&(i=r*o),"rem"===a&&(i=e.root*o),void 0===a&&(i=r*o)}return s[t]=i,i}(o.font,e))+2*a,r.width=t.width*n,r.height=t.height*n,h.scale(n,n),o)h[d]=o[d];var u=0;switch(o.textBaseline){case"top":case"hanging":u=a;break;case"middle":u=t.height>>1;break;default:u=t.height-a}return o.strokeStyle&&h.strokeText(t.text,a,u),h.fillText(t.text,a,u),r}function h(t){return 1*window.getComputedStyle(t,null).getPropertyValue("font-size").match(/(.+)px/)[1]}var o={name:"canvas",init:function(t){var e=document.createElement("canvas");return e.context=e.getContext("2d"),e._fontSize={root:h(document.getElementsByTagName("html")[0]),container:h(t)},e},clear:function(t,e){t.context.clearRect(0,0,t.width,t.height);for(var i=0;i<e.length;i++)e[i].canvas=null},resize:function(t,e,i){t.width=e*n,t.height=i*n,t.style.width=e+"px",t.style.height=i+"px"},framing:function(t){t.context.clearRect(0,0,t.width,t.height)},setup:function(t,e){for(var i=0;i<e.length;i++){var n=e[i];n.canvas=r(n,t._fontSize)}},render:function(t,e){t.context.drawImage(e.canvas,e.x*n,e.y*n)},remove:function(t,e){e.canvas=null}},a=function(){if("undefined"!=typeof window){var t=window.requestAnimationFrame||window.mozRequestAnimationFrame||window.webkitRequestAnimationFrame;if(t)return t.bind(window)}return function(t){return setTimeout(t,50/3)}}(),d=function(){if("undefined"!=typeof window){var t=window.cancelAnimationFrame||window.mozCancelAnimationFrame||window.webkitCancelAnimationFrame;if(t)return t.bind(window)}return clearTimeout}();function u(t,e,i){for(var n=0,s=0,r=t.length;s<r-1;)i>=t[n=s+r>>1][e]?s=n:r=n;return t[s]&&i<t[s][e]?s:r}function m(t){return/^(ltr|top|bottom)$/i.test(t)?t.toLowerCase():"rtl"}function c(){var t=9007199254740991;return[{range:0,time:-t,width:t,height:0},{range:t,time:t,width:0,height:0}]}function l(t){t.ltr=c(),t.rtl=c(),t.top=c(),t.bottom=c()}function f(){return void 0!==window.performance&&window.performance.now?window.performance.now():Date.now()}function p(t){var e=this,i=this.media?this.media.currentTime:f()/1e3;function n(t,n){if("top"===n.mode||"bottom"===n.mode)return i-t.time<e._.duration;var s=(e._.width+t.width)*(i-t.time)/e._.duration;if(t.width>s)return!0;var r=e._.duration+t.time-i,h=e._.width+n.width,o=e.media?n.time:n._utc,a=h*(i-o)/e._.duration,d=e._.width-a;return r>e._.duration*d/(e._.width+n.width)}for(var s=this._.space[t.mode],r=0,h=0,o=1;o<s.length;o++){var a=s[o],d=t.height;if("top"!==t.mode&&"bottom"!==t.mode||(d+=a.height),a.range-a.height-s[r].range>=d){h=o;break}n(a,t)&&(r=o)}var u=s[r].range,m={range:u+t.height,time:this.media?t.time:t._utc,width:t.width,height:t.height};return s.splice(r+1,h-r-1,m),"bottom"===t.mode?this._.height-t.height-u%this._.height:u%(this._.height-t.height)}function g(){if(!this._.visible||!this._.paused)return this;if(this._.paused=!1,this.media)for(var t=0;t<this._.runningList.length;t++){var e=this._.runningList[t];e._utc=f()/1e3-(this.media.currentTime-e.time)}var i=this,n=function(t,e,i,n){return function(s){t(this._.stage);var r=(s||f())/1e3,h=this.media?this.media.currentTime:r,o=this.media?this.media.playbackRate:1,a=null,d=0,u=0;for(u=this._.runningList.length-1;u>=0;u--)a=this._.runningList[u],h-(d=this.media?a.time:a._utc)>this._.duration&&(n(this._.stage,a),this._.runningList.splice(u,1));for(var m=[];this._.position<this.comments.length&&(a=this.comments[this._.position],!((d=this.media?a.time:a._utc)>=h));)h-d>this._.duration||(this.media&&(a._utc=r-(this.media.currentTime-a.time)),m.push(a)),++this._.position;for(e(this._.stage,m),u=0;u<m.length;u++)(a=m[u]).y=p.call(this,a),this._.runningList.push(a);for(u=0;u<this._.runningList.length;u++){a=this._.runningList[u];var c=(this._.width+a.width)*(r-a._utc)*o/this._.duration;"ltr"===a.mode&&(a.x=c-a.width),"rtl"===a.mode&&(a.x=this._.width-c),"top"!==a.mode&&"bottom"!==a.mode||(a.x=this._.width-a.width>>1),i(this._.stage,a)}}}(this._.engine.framing.bind(this),this._.engine.setup.bind(this),this._.engine.render.bind(this),this._.engine.remove.bind(this));return this._.requestID=a((function t(e){n.call(i,e),i._.requestID=a(t)})),this}function _(){return!this._.visible||this._.paused||(this._.paused=!0,d(this._.requestID),this._.requestID=0),this}function v(){if(!this.media)return this;this.clear(),l(this._.space);var t=u(this.comments,"time",this.media.currentTime);return this._.position=Math.max(0,t-1),this}function w(t){t.play=g.bind(this),t.pause=_.bind(this),t.seeking=v.bind(this),this.media.addEventListener("play",t.play),this.media.addEventListener("pause",t.pause),this.media.addEventListener("playing",t.play),this.media.addEventListener("waiting",t.pause),this.media.addEventListener("seeking",t.seeking)}function y(t){this.media.removeEventListener("play",t.play),this.media.removeEventListener("pause",t.pause),this.media.removeEventListener("playing",t.play),this.media.removeEventListener("waiting",t.pause),this.media.removeEventListener("seeking",t.seeking),t.play=null,t.pause=null,t.seeking=null}function x(t){this._={},this.container=t.container||document.createElement("div"),this.media=t.media,this._.visible=!0,this.engine=(t.engine||"DOM").toLowerCase(),this._.engine="canvas"===this.engine?o:i,this._.requestID=0,this._.speed=Math.max(0,t.speed)||144,this._.duration=4,this.comments=t.comments||[],this.comments.sort((function(t,e){return t.time-e.time}));for(var e=0;e<this.comments.length;e++)this.comments[e].mode=m(this.comments[e].mode);return this._.runningList=[],this._.position=0,this._.paused=!0,this.media&&(this._.listener={},w.call(this,this._.listener)),this._.stage=this._.engine.init(this.container),this._.stage.style.cssText+="position:relative;pointer-events:none;",this.resize(),this.container.appendChild(this._.stage),this._.space={},l(this._.space),this.media&&this.media.paused||(v.call(this),g.call(this)),this}function b(){if(!this.container)return this;for(var t in _.call(this),this.clear(),this.container.removeChild(this._.stage),this.media&&y.call(this,this._.listener),this)Object.prototype.hasOwnProperty.call(this,t)&&(this[t]=null);return this}var L=["mode","time","text","render","style"];function T(t){if(!t||"[object Object]"!==Object.prototype.toString.call(t))return this;for(var e={},i=0;i<L.length;i++)void 0!==t[L[i]]&&(e[L[i]]=t[L[i]]);if(e.text=(e.text||"").toString(),e.mode=m(e.mode),e._utc=f()/1e3,this.media){var n=0;void 0===e.time?(e.time=this.media.currentTime,n=this._.position):(n=u(this.comments,"time",e.time))<this._.position&&(this._.position+=1),this.comments.splice(n,0,e)}else this.comments.push(e);return this}function E(){return this._.visible?this:(this._.visible=!0,this.media&&this.media.paused||(v.call(this),g.call(this)),this)}function C(){return this._.visible?(_.call(this),this.clear(),this._.visible=!1,this):this}function k(){return this._.engine.clear(this._.stage,this._.runningList),this._.runningList=[],this}function z(){return this._.width=this.container.offsetWidth,this._.height=this.container.offsetHeight,this._.engine.resize(this._.stage,this._.width,this._.height),this._.duration=this._.width/this._.speed,this}var D={get:function(){return this._.speed},set:function(t){return"number"!=typeof t||isNaN(t)||!isFinite(t)||t<=0?this._.speed:(this._.speed=t,this._.width&&(this._.duration=this._.width/t),t)}};function M(t){t&&x.call(this,t)}return M.prototype.destroy=function(){return b.call(this)},M.prototype.emit=function(t){return T.call(this,t)},M.prototype.show=function(){return E.call(this)},M.prototype.hide=function(){return C.call(this)},M.prototype.clear=function(){return k.call(this)},M.prototype.resize=function(){return z.call(this)},Object.defineProperty(M.prototype,"speed",D),M}));
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
            this.opacity = opacityRecord ? parseFloatOfRange(opacityRecord, 0.0, 1.0) : 0.7;
            // 弹幕速度
            const speedRecord = window.localStorage.getItem('danmakuspeed');
            this.speed = speedRecord ? parseFloatOfRange(speedRecord, 0.0, 1000.0) : 200;
            // 弹幕字体大小
            const sizeRecord = window.localStorage.getItem('danmakusize');
            this.fontSize = sizeRecord ? parseFloatOfRange(sizeRecord, 0.0, 50.0) : 18;
            // 弹幕高度
            const heightRecord = window.localStorage.getItem('danmakuheight');
            this.heightRatio = heightRecord ? parseFloatOfRange(heightRecord, 0.0, 1.0) : 0.9;
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
            this.fontFamily = fontFamily ?? 'sans-serif';
            // 字体选项
            const fontOptions = window.localStorage.getItem('danmakuFontOptions');
            this.fontOptions = fontOptions ?? '';

            // 自定义CORS代理和API
            this.customCorsProxy = window.localStorage.getItem('customCorsProxy') ?? '';
            this.customApiPrefix = window.localStorage.getItem('customApiPrefix') ?? '';

            // ===== v2 新增：屏蔽 / 合并 / 御坂网络 / 缓存 =====
            this.blockKeywords = lsStr('danmakuBlockKeywords', '');
            this.blockUsers = lsStr('danmakuBlockUsers', '');
            this.blockColors = lsStr('danmakuBlockColors', '');
            this.blockEnableKeywords = lsInt('danmakuBlockEnableKeywords', 1);
            this.blockEnableUsers = lsInt('danmakuBlockEnableUsers', 1);
            this.blockEnableColors = lsInt('danmakuBlockEnableColors', 0);
            this.mergeSimilar = lsInt('danmakuMergeSimilar', 0);
            this.mergeThreshold = lsInt('danmakuMergeThreshold', 85);
            // 去掉 B 站点赞数后缀（御坂网络会把“🤍 28”拼在正文里）
            this.stripLikeSuffix = lsInt('danmakuStripLikeSuffix', 1);
            // 匹配信息自动隐藏秒数（0 = 常显）
            this.infoHideSeconds = lsInt('danmakuInfoHideSeconds', 8);
            // 在线搜索失败时回退到 Jellyfin 弹幕插件（御坂网络后端）的弹幕
            this.xmlFallback = lsInt('danmakuXmlFallback', 1);
            // 御坂网络（misaka）预设
            this.misakaBase = lsStr('misakaBase', '');
            this.misakaToken = lsStr('misakaToken', '');
            // 已配置过自定义 API 的话，把它拆回“地址 + token”回填到御坂卡片，避免重复手填
            const misakaMatch = String(this.customApiPrefix || '').match(/^(.*?)\/api\/v1\/([^/]+)$/);
            if (misakaMatch) {
                if (!this.misakaBase) {
                    this.misakaBase = misakaMatch[1];
                }
                if (!this.misakaToken) {
                    this.misakaToken = misakaMatch[2];
                }
            }
            // 最近一次拉到的原始弹幕（改设置/补挂容器时本地重渲染，不再请求接口）
            this.lastRawComments = null;
            this.lastRawCommentsItemId = '';
            this.lastStats = null;
            this.lastBlocked = 0;
            this.loadingSince = 0;
            this.watchdogTimer = null;

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
            if (window.ede.danmakuSwitch == 1) {
                window.ede.danmaku.show();
                // hide() 清掉了屏幕上的弹幕；把读取位置拉回 currentTime - duration，补回正在飞行中的弹幕
                window.ede.danmaku._patchedSeekingHandler?.();
            } else {
                // hide() 会停掉帧循环，关闭期间不再占用 CPU
                window.ede.danmaku.hide();
            }
        }
    }
    // 保存设置
    function saveSettings() {
        try {
            // 这些设置会改变请求本身（简繁转换参数 / 弹幕来源 / 请求地址），不能用缓存重渲染
            const fetchKey = () => [window.ede.chConvert, window.ede.useXmlDanmaku, window.ede.customCorsProxy, window.ede.customApiPrefix].join('\u0001');
            const prevFetchKey = fetchKey();
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
            document.querySelectorAll('input[name="danmakuFilter"]:checked').forEach((element) => {
                window.ede.danmakuFilter += parseInt(element.value, 10);
            });
            window.localStorage.setItem('danmakuFilter', window.ede.danmakuFilter);
            showDebugInfo(`设置弹幕过滤：${window.ede.danmakuFilter}`);
            window.ede.danmakuModeFilter = 0;
            document.querySelectorAll('input[name="danmakuModeFilter"]:checked').forEach((element) => {
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
            const epOffset = parseFloat(document.getElementById('danmakuOffsetTime').value) || 0;
            if (epOffset !== window.ede.curEpOffset) {
                setCurEpOffset(epOffset);
                showDebugInfo(`设置弹幕偏移时间：${window.ede.curEpOffset}`);
            }
            window.ede.fontFamily = document.getElementById('danmakuFontFamily').value || 'sans-serif';
            window.localStorage.setItem('danmakuFontFamily', window.ede.fontFamily);
            showDebugInfo(`字体：${window.ede.fontFamily}`);
            window.ede.fontOptions = document.getElementById('danmakuFontOptions').value;
            window.localStorage.setItem('danmakuFontOptions', window.ede.fontOptions);
            showDebugInfo(`字体选项：${window.ede.fontOptions}`);

            window.ede.customCorsProxy = document.getElementById('customCorsProxy').value;
            window.localStorage.setItem('customCorsProxy', window.ede.customCorsProxy);
            showDebugInfo(`自定义CORS代理：${window.ede.customCorsProxy}`);
            const prevCustomApiPrefix = window.ede.customApiPrefix;
            window.ede.customApiPrefix = document.getElementById('customApiPrefix').value;
            window.localStorage.setItem('customApiPrefix', window.ede.customApiPrefix);
            showDebugInfo(`自定义API：${window.ede.customApiPrefix}`);


            // ===== v2：屏蔽 / 合并设置 =====
            const formVal = (id, def) => {
                const el = document.getElementById(id);
                return el ? el.value : def;
            };
            window.ede.blockKeywords = formVal('danmakuBlockKeywords', '');
            window.ede.blockUsers = formVal('danmakuBlockUsers', '');
            window.ede.blockColors = formVal('danmakuBlockColors', '');
            window.localStorage.setItem('danmakuBlockKeywords', window.ede.blockKeywords);
            window.localStorage.setItem('danmakuBlockUsers', window.ede.blockUsers);
            window.localStorage.setItem('danmakuBlockColors', window.ede.blockColors);
            window.ede.blockEnableKeywords = document.getElementById('danmakuBlockEnableKeywords')?.checked ? 1 : 0;
            window.ede.blockEnableUsers = document.getElementById('danmakuBlockEnableUsers')?.checked ? 1 : 0;
            window.ede.blockEnableColors = document.getElementById('danmakuBlockEnableColors')?.checked ? 1 : 0;
            window.localStorage.setItem('danmakuBlockEnableKeywords', window.ede.blockEnableKeywords);
            window.localStorage.setItem('danmakuBlockEnableUsers', window.ede.blockEnableUsers);
            window.localStorage.setItem('danmakuBlockEnableColors', window.ede.blockEnableColors);
            window.ede.mergeSimilar = document.getElementById('danmakuMergeSimilar')?.checked ? 1 : 0;
            window.ede.mergeThreshold = parseInt(formVal('danmakuMergeThreshold', 85), 10) || 85;
            window.localStorage.setItem('danmakuMergeSimilar', window.ede.mergeSimilar);
            window.localStorage.setItem('danmakuMergeThreshold', window.ede.mergeThreshold);
            window.ede.stripLikeSuffix = document.getElementById('danmakuStripLikeSuffix')?.checked ? 1 : 0;
            window.localStorage.setItem('danmakuStripLikeSuffix', window.ede.stripLikeSuffix);
            window.ede.infoHideSeconds = parseInt(formVal('danmakuInfoHideSeconds', 8), 10);
            if (isNaN(window.ede.infoHideSeconds) || window.ede.infoHideSeconds < 0) {
                window.ede.infoHideSeconds = 8;
            }
            window.localStorage.setItem('danmakuInfoHideSeconds', window.ede.infoHideSeconds);
            blockRulesCache = { key: null, rules: null };
            showDebugInfo(
                `屏蔽规则：关键词 ${parseBlockLines(window.ede.blockKeywords).length} 条 / 发送者 ${parseBlockLines(window.ede.blockUsers).length} 条 / 合并相似弹幕 ${
                    window.ede.mergeSimilar === 1 ? '开' : '关'
                }`,
            );

            // v2（上游 issue #91）：更换弹幕 API 后，旧的番剧/剧集匹配缓存会指向另一个服务端的 id
            if (prevCustomApiPrefix !== window.ede.customApiPrefix) {
                const clearedCount = clearEpisodeMappingCache();
                window.ede.lastRawComments = null;
                if (clearedCount > 0) {
                    showDebugInfo(`已切换弹幕 API，清理 ${clearedCount} 条旧匹配缓存`);
                }
            }

            if (prevFetchKey !== fetchKey()) {
                window.ede.lastRawComments = null;
            }

            // v2：有本地缓存就直接重渲染，省掉一次网络请求
            if (!rerenderFromCache()) {
                reloadDanmaku('reload');
            }
            closeDanmakuSidebar();
        } catch (e) {
            alert(`Invalid input: ${e.message}`);
        }
    }

    function getApiPrefix() {
        const cors = window.ede.customCorsProxy.length > 7 ? window.ede.customCorsProxy : corsProxy;
        const api = window.ede.customApiPrefix.length > 7 ? window.ede.customApiPrefix : cors + apiPrefix;
        return api;
    }

    // =====================================================================
    // v2 扩展：屏蔽 / 相似弹幕合并 / 来源统计 / 稳定性看门狗 / 御坂网络预设
    // 说明：本段为整合新增代码，参考了 chen3861229/dd-danmaku 与
    //       l429609201/dd-danmaku（Emby 版）的屏蔽与合并思路，按 Jellyfin 重写。
    // =====================================================================

    function lsInt(key, def) {
        const v = window.localStorage.getItem(key);
        if (v === null || v === undefined || v === '') {
            return def;
        }
        const n = parseInt(v, 10);
        return isNaN(n) ? def : n;
    }

    function lsStr(key, def) {
        const v = window.localStorage.getItem(key);
        return v === null || v === undefined ? def : v;
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ---------- 屏蔽规则 ----------
    let blockRulesCache = { key: null, rules: null };

    function parseBlockLines(text) {
        return String(text || '')
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && !s.startsWith('#'));
    }

    // 关键词规则：默认按普通文本包含匹配；/正则/flags 或 re:正则 才按正则匹配
    function getBlockRules() {
        const key = [
            window.ede.blockKeywords,
            window.ede.blockUsers,
            window.ede.blockColors,
            window.ede.blockEnableKeywords,
            window.ede.blockEnableUsers,
            window.ede.blockEnableColors,
        ].join('\u0001');
        if (blockRulesCache.key === key) {
            return blockRulesCache.rules;
        }
        const keywords = [];
        if (window.ede.blockEnableKeywords === 1) {
            for (const line of parseBlockLines(window.ede.blockKeywords)) {
                const m = line.match(/^\/(.+)\/([gimsuy]*)$/);
                if (m) {
                    try {
                        keywords.push({ re: new RegExp(m[1], m[2].replace(/g/g, '')), sub: null, raw: line });
                        continue;
                    } catch (err) {
                        showDebugInfo(`屏蔽正则无效，已按普通文本处理: ${line}`);
                    }
                } else if (line.startsWith('re:')) {
                    try {
                        keywords.push({ re: new RegExp(line.slice(3)), sub: null, raw: line });
                        continue;
                    } catch (err) {
                        showDebugInfo(`屏蔽正则无效，已按普通文本处理: ${line}`);
                    }
                }
                keywords.push({ re: null, sub: line, raw: line });
            }
        }
        const users = window.ede.blockEnableUsers === 1 ? parseBlockLines(window.ede.blockUsers) : [];
        const colors = [];
        if (window.ede.blockEnableColors === 1) {
            for (const c of String(window.ede.blockColors || '').split(/[\s,;，]+/)) {
                const t = c.trim().replace(/^#/, '').toLowerCase();
                if (/^[0-9a-f]{6}$/.test(t)) {
                    colors.push(t);
                }
            }
        }
        const rules = { keywords, users, colors };
        blockRulesCache = { key, rules };
        return rules;
    }

    // dandanplay 弹幕 p 字段: time,mode,color,user（御坂网络会把来源写进 user，如 [BiliBili]xxx）
    function parseCommentMeta(comment) {
        const parts = String((comment && comment.p) || '').split(',');
        const colorValue = parseInt(parts[2], 10) || 0;
        return {
            time: parseFloat(parts[0]) || 0,
            modeId: parseInt(parts[1], 10) || 1,
            color: colorValue.toString(16).padStart(6, '0'),
            user: parts.length > 3 ? parts[parts.length - 1] : '',
        };
    }

    /** 按屏蔽规则过滤原始弹幕，返回 {comments, blocked} */
    function shieldFilter(comments) {
        const { keywords, users, colors } = getBlockRules();
        if (keywords.length === 0 && users.length === 0 && colors.length === 0) {
            return { comments, blocked: 0 };
        }
        const result = [];
        let blocked = 0;
        for (const comment of comments) {
            const text = comment.m || '';
            const meta = parseCommentMeta(comment);
            let hit = false;
            for (const rule of keywords) {
                if (rule.re) {
                    rule.re.lastIndex = 0;
                    if (rule.re.test(text) || rule.re.test(meta.user)) {
                        hit = true;
                        break;
                    }
                } else if (text.includes(rule.sub) || meta.user.includes(rule.sub)) {
                    hit = true;
                    break;
                }
            }
            if (!hit) {
                for (const u of users) {
                    if (meta.user.includes(u)) {
                        hit = true;
                        break;
                    }
                }
            }
            if (!hit && colors.length > 0 && colors.includes(meta.color)) {
                hit = true;
            }
            if (hit) {
                blocked++;
            } else {
                result.push(comment);
            }
        }
        return { comments: result, blocked };
    }

    // ---------- 相似弹幕合并 ----------
    function similarityPercentage(a, b) {
        if (a === b) {
            return 100;
        }
        if (!a || !b) {
            return 0;
        }
        if (a.length > b.length) {
            const t = a;
            a = b;
            b = t;
        }
        let previousRow = Array.from({ length: a.length + 1 }, (_, i) => i);
        let currentRow = Array(a.length + 1);
        for (let j = 1; j <= b.length; j++) {
            currentRow[0] = j;
            for (let i = 1; i <= a.length; i++) {
                const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
                currentRow[i] = Math.min(previousRow[i - 1] + substitutionCost, previousRow[i] + 1, currentRow[i - 1] + 1);
            }
            const tmp = previousRow;
            previousRow = currentRow;
            currentRow = tmp;
        }
        const distance = previousRow[a.length];
        const maxLength = Math.max(a.length, b.length);
        return Math.max(0, 100 - (distance / maxLength) * 100);
    }

    function mergeSimilarDanmaku(comments, threshold, timeWindow) {
        if (!comments || comments.length < 2) {
            return comments;
        }
        const sorted = comments.slice().sort((x, y) => x.time - y.time);
        const consumed = new Array(sorted.length).fill(false);
        const merged = [];
        for (let i = 0; i < sorted.length; i++) {
            if (consumed[i]) {
                continue;
            }
            const base = Object.assign({}, sorted[i]);
            let count = 1;
            for (let j = i + 1; j < sorted.length; j++) {
                if (consumed[j]) {
                    continue;
                }
                if (sorted[j].time - sorted[i].time > timeWindow) {
                    break;
                }
                if (sorted[j].mode !== sorted[i].mode) {
                    continue;
                }
                // 编辑距离至少是长度差，相似度上限为 短/长；够不到阈值就不必算编辑距离
                const la = base.text.length;
                const lb = sorted[j].text.length;
                if (base.text !== sorted[j].text && (Math.min(la, lb) / Math.max(la, lb)) * 100 < threshold) {
                    continue;
                }
                if (similarityPercentage(base.text, sorted[j].text) >= threshold) {
                    consumed[j] = true;
                    count++;
                }
            }
            if (count > 1) {
                base.text = `${base.text} [x${count}]`;
            }
            merged.push(base);
        }
        return merged;
    }

    function maybeMergeSimilar(comments) {
        if (window.ede.mergeSimilar !== 1) {
            return comments;
        }
        const threshold = Math.min(100, Math.max(50, window.ede.mergeThreshold || 85));
        try {
            return mergeSimilarDanmaku(comments, threshold, 2);
        } catch (err) {
            showDebugInfo(`相似弹幕合并失败: ${err.message}`);
            return comments;
        }
    }

    // 清理弹幕正文：御坂网络会把 B 站点赞数拼在正文尾部（“开饭开饭 🤍 28”），这里去掉它
    function cleanDanmakuText(text) {
        const raw = String(text ?? '');
        if (window.ede.stripLikeSuffix !== 1) {
            return raw;
        }
        const cleaned = raw.replace(/\s*[🤍❤♥💛💙💚💜🖤🧡]️?\s*\d+\s*$/u, '').trim();
        return cleaned.length > 0 ? cleaned : raw;
    }

    // ---------- 剧集匹配 ----------
    // 从分集标题里抽取集号：兼容「第4话」「S02E04」「4」「4.」等格式
    function extractEpisodeNumber(title) {
        const text = String(title || '');
        let m = text.match(/第\s*(\d+)\s*[话話集]/);
        if (m) {
            return parseInt(m[1], 10);
        }
        m = text.match(/[Ss]\d+\s*[Ee](\d+)/);
        if (m) {
            return parseInt(m[1], 10);
        }
        // 御坂网络里不少分集标题就是裸数字，例如「幼女战记 第二季」的 1、2、3……
        m = text.trim().match(/^(\d+)(?:\s|$|[.、:：\-])/);
        if (m) {
            return parseInt(m[1], 10);
        }
        return null;
    }

    /**
     * 把 Jellyfin 的集号映射到弹幕源的剧集下标。
     * 旧逻辑假设源站剧集从“第 1 话”开始连续排列，一旦缺集（例如第二季缺第 1 集）后面所有集都会错位。
     * 这里优先按每集标题里的集号精确匹配，匹配不到才回退到原来的顺序推算。
     */
    function matchEpisodeIndex(episodes, targetEp) {
        const eps = episodes || [];
        for (let i = 0; i < eps.length; i++) {
            if (extractEpisodeNumber(eps[i].episodeTitle) === targetEp) {
                return i;
            }
        }
        const initialEp = extractEpisodeNumber(eps[0] ? eps[0].episodeTitle : '');
        const initialep = initialEp === null ? 1 : initialEp;
        showDebugInfo('按标题集号未命中，回退到顺序匹配');
        return targetEp < initialep ? targetEp - 1 : targetEp - initialep;
    }

    // ---------- 搜索候选择优（上游 issue #94：御坂网络返回的数组顺序不稳定） ----------
    function normalizeTitle(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/[\s\u3000]+/g, '')
            .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, '')
            .replace(/[!-\/:-@\[-`{-~！-／：-＠［-｀｛-～、-〜“”‘’·…—－_.]/g, '');
    }

    // 从标题里猜季数：第二季 / 2nd Season / Season 2 / 尾巴上的数字
    function seasonHint(text, allowTrailingDigit = false) {
        const t = String(text || '');
        const cn = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
        let m = t.match(/第\s*([一二三四五六七八九十百\d]+)\s*[季期部]/);
        if (m) {
            return cn[m[1]] || parseInt(m[1], 10) || null;
        }
        m = t.match(/(?:season|s)\s*(\d+)/i);
        if (m) {
            return parseInt(m[1], 10);
        }
        m = t.match(/(\d+)\s*(?:nd|rd|th|st)\s*season/i);
        if (m) {
            return parseInt(m[1], 10);
        }
        if (allowTrailingDigit) {
            m = t.trim().match(/(\d+)$/);
            if (m) {
                return parseInt(m[1], 10);
            }
        }
        return null;
    }

    // 标题相似度打分：基础用编辑距离，另加前缀/包含/季数命中奖励
    function titleMatchScore(query, candidate) {
        const a = normalizeTitle(query);
        const b = normalizeTitle(candidate);
        if (!a || !b) {
            return 0;
        }
        let score = similarityPercentage(a, b);
        if (a === b) {
            score += 100;
        } else if (b.startsWith(a) || a.startsWith(b)) {
            score += 40;
        } else if (b.includes(a) || a.includes(b)) {
            score += 20;
        }
        const wanted = seasonHint(query, true);
        if (wanted !== null) {
            const got = seasonHint(candidate, false);
            if (got === wanted) {
                score += 60;
            } else if (got !== null) {
                score -= 60;
            } else {
                // 点名了第几季，但候选标题完全没写季数：多半是别季的作品，压一压
                score -= 40;
            }
        }
        return score;
    }

    /** 从搜索结果里挑最像当前番剧的那个，返回 {index, score, title} */
    function pickBestAnime(animes, query) {
        const list = animes || [];
        let best = 0;
        let bestScore = -Infinity;
        for (let i = 0; i < list.length; i++) {
            const score = titleMatchScore(query, list[i].animeTitle);
            if (score > bestScore) {
                bestScore = score;
                best = i;
            }
        }
        return { index: best, score: bestScore, title: list[best] ? list[best].animeTitle : '' };
    }

    // ---------- 换弹幕 API 后清掉旧的匹配缓存（上游 issue #91） ----------
    function clearEpisodeMappingCache() {
        const keys = [];
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key && (key.startsWith('_episode_id_rel_') || key.startsWith('_anime_id_rel_') || key.startsWith('_anime_name_rel_'))) {
                keys.push(key);
            }
        }
        keys.forEach((key) => window.localStorage.removeItem(key));
        return keys.length;
    }

    // ---------- 来源统计 ----------
    function danmakuSourceStats(comments) {
        const stats = { total: 0, bili: 0, gamer: 0, dandan: 0, other: 0 };
        for (const comment of comments || []) {
            stats.total++;
            // 御坂网络写的是小写 [bilibili]/[gamer]，这里统一转小写判断
            const user = parseCommentMeta(comment).user.toLowerCase();
            if (user.startsWith('[bilibili]')) {
                stats.bili++;
            } else if (user.startsWith('[gamer]')) {
                stats.gamer++;
            } else if (user.startsWith('[')) {
                stats.other++;
            } else {
                stats.dandan++;
            }
        }
        return stats;
    }

    // 御坂网络把错误也包在 HTTP 200 里，用 errorCode 说明原因
    function describeApiError(code) {
        const map = {
            1001: '请求参数错误',
            1002: '未找到资源',
            1003: '鉴权失败或配额用尽（检查客户端 token / 每日调用上限）',
            1004: '请求过于频繁',
            1005: '服务端内部错误',
        };
        return map[code] || '';
    }

    function formatSourceStats(stats) {
        if (!stats || stats.total === 0) {
            return '0 条';
        }
        const parts = [];
        if (stats.bili > 0) {
            parts.push(`B站 ${stats.bili}`);
        }
        if (stats.gamer > 0) {
            parts.push(`巴哈 ${stats.gamer}`);
        }
        if (stats.dandan > 0) {
            parts.push(`弹弹 ${stats.dandan}`);
        }
        if (stats.other > 0) {
            parts.push(`其他 ${stats.other}`);
        }
        return `${stats.total} 条（${parts.join(' / ')}）`;
    }

    // ---------- 文本对话框（屏蔽规则导入导出用） ----------
    function createTextareaDialog(title, defaultValue = '', readonly = false) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'dialogOverlay';

            const dialog = document.createElement('div');
            dialog.className = 'inputDialog danmakuTextDialog';
            dialog.innerHTML = `
                <h3 class="dialogTitle">${escapeHtml(title)}</h3>
                <textarea id="dialogTextarea" ${readonly ? 'readonly' : ''}></textarea>
                <div class="dialogActions">
                    <button id="dialogCancel">关闭</button>
                    <button id="dialogConfirm" ${readonly ? 'style="display:none"' : ''}>确认</button>
                </div>
            `;
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            const glassLayer = document.createElement('div');
            glassLayer.className = 'glassLayer';
            dialog.appendChild(glassLayer);

            const ta = dialog.querySelector('#dialogTextarea');
            ta.value = defaultValue ?? '';
            ta.addEventListener('keydown', (event) => event.stopPropagation(), true);
            if (readonly) {
                ta.focus();
                ta.select();
            }

            const cleanup = () => overlay.remove();
            const done = (val) => {
                cleanup();
                resolve(val);
            };

            dialog.querySelector('#dialogCancel').onclick = () => done(readonly ? ta.value : null);
            dialog.querySelector('#dialogConfirm').onclick = () => {
                const v = ta.value.trim();
                done(v || null);
            };

            if (readonly) {
                const copyBtn = document.createElement('button');
                copyBtn.textContent = '复制';
                copyBtn.onclick = async () => {
                    try {
                        await navigator.clipboard.writeText(ta.value);
                        showDebugInfo('已复制到剪贴板');
                    } catch (err) {
                        ta.select();
                        try {
                            document.execCommand('copy');
                            showDebugInfo('已复制到剪贴板');
                        } catch (err2) {
                            showDebugInfo('复制失败，请手动选择复制');
                        }
                    }
                };
                dialog.querySelector('.dialogActions').prepend(copyBtn);
            }

            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    done(readonly ? ta.value : null);
                }
            };
        });
    }

    function currentBlockRulesFromForm() {
        const val = (id) => document.getElementById(id)?.value ?? '';
        const checked = (id) => (document.getElementById(id)?.checked ? 1 : 0);
        return {
            version: 2,
            blockKeywords: val('danmakuBlockKeywords'),
            blockUsers: val('danmakuBlockUsers'),
            blockColors: val('danmakuBlockColors'),
            blockEnableKeywords: checked('danmakuBlockEnableKeywords'),
            blockEnableUsers: checked('danmakuBlockEnableUsers'),
            blockEnableColors: checked('danmakuBlockEnableColors'),
            mergeSimilar: checked('danmakuMergeSimilar'),
            mergeThreshold: val('danmakuMergeThreshold') || 85,
        };
    }

    async function exportBlockRules() {
        const json = JSON.stringify(currentBlockRulesFromForm(), null, 2);
        const text = await createTextareaDialog('导出屏蔽规则（可复制保存）', json, true);
        if (text !== null) {
            showDebugInfo('屏蔽规则已导出');
        }
    }

    async function importBlockRules() {
        const text = await createTextareaDialog('粘贴屏蔽规则 JSON，然后点确认', '', false);
        if (!text) {
            return;
        }
        try {
            const obj = JSON.parse(text);
            const setVal = (id, v) => {
                const el = document.getElementById(id);
                if (el && v !== undefined) {
                    el.value = v;
                }
            };
            const setChk = (id, v) => {
                const el = document.getElementById(id);
                if (el && v !== undefined) {
                    el.checked = Number(v) === 1;
                }
            };
            setVal('danmakuBlockKeywords', obj.blockKeywords);
            setVal('danmakuBlockUsers', obj.blockUsers);
            setVal('danmakuBlockColors', obj.blockColors);
            setChk('danmakuBlockEnableKeywords', obj.blockEnableKeywords);
            setChk('danmakuBlockEnableUsers', obj.blockEnableUsers);
            setChk('danmakuBlockEnableColors', obj.blockEnableColors);
            setChk('danmakuMergeSimilar', obj.mergeSimilar);
            setVal('danmakuMergeThreshold', obj.mergeThreshold);
            showDebugInfo('屏蔽规则已导入（点“保存”后生效）');
        } catch (err) {
            showDebugInfo(`导入失败: ${err.message}`);
        }
    }

    function clearBlockRules() {
        ['danmakuBlockKeywords', 'danmakuBlockUsers', 'danmakuBlockColors'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.value = '';
            }
        });
        showDebugInfo('已清空表单中的屏蔽规则（点“保存”后生效）');
    }

    // ---------- 全量配置备份 / 恢复（对照 dd-danmaku 的设置导入导出） ----------
    const BACKUP_KEYS = [
        'danmakuSwitch',
        'logSwitch',
        'danmakuopacity',
        'danmakuspeed',
        'danmakusize',
        'danmakuheight',
        'danmakuFilter',
        'danmakuModeFilter',
        'danmakuDensityLimit',
        'useAnitOverlap',
        'chConvert',
        'useXmlDanmaku',
        'danmakuFontFamily',
        'danmakuFontOptions',
        'customCorsProxy',
        'customApiPrefix',
        'danmakuBlockKeywords',
        'danmakuBlockUsers',
        'danmakuBlockColors',
        'danmakuBlockEnableKeywords',
        'danmakuBlockEnableUsers',
        'danmakuBlockEnableColors',
        'danmakuMergeSimilar',
        'danmakuMergeThreshold',
        'danmakuStripLikeSuffix',
        'danmakuXmlFallback',
        'misakaBase',
        'misakaToken',
    ];

    // 运行时状态（弹幕实例、观察器、定时器、当前集信息等），导入设置时不能被覆盖
    const EDE_RUNTIME_KEYS = new Set([
        'curEpOffset',
        'curEpOffsetModified',
        'curEpOffsetKey',
        'lastRawComments',
        'lastRawCommentsItemId',
        'lastStats',
        'lastBlocked',
        'loadingSince',
        'watchdogTimer',
        'danmaku',
        'episode_info',
        'obResize',
        'obMutation',
        'loading',
    ]);

    function collectSettingsBackup() {
        const settings = {};
        for (const key of BACKUP_KEYS) {
            const value = window.localStorage.getItem(key);
            if (value !== null) {
                settings[key] = value;
            }
        }
        return { version: 2, app: 'jellyfin-danmaku-merged', exportedAt: new Date().toISOString(), settings };
    }

    async function exportAllSettings() {
        const json = JSON.stringify(collectSettingsBackup(), null, 2);
        const text = await createTextareaDialog('导出全部弹幕设置（可复制保存）', json, true);
        if (text !== null) {
            showDebugInfo('设置已导出');
        }
    }

    async function importAllSettings() {
        const text = await createTextareaDialog('粘贴设置 JSON，然后点确认', '', false);
        if (!text) {
            return;
        }
        try {
            const obj = JSON.parse(text);
            const settings = obj && obj.settings ? obj.settings : obj;
            if (!settings || typeof settings !== 'object') {
                throw new Error('JSON 结构不对');
            }
            let count = 0;
            for (const key of BACKUP_KEYS) {
                if (Object.prototype.hasOwnProperty.call(settings, key)) {
                    window.localStorage.setItem(key, String(settings[key]));
                    count++;
                }
            }
            showDebugInfo(`已导入 ${count} 项设置，正在重新加载弹幕`);
            // 让最新的 localStorage 值生效：直接刷新最省事，但会打断播放，所以这里先同步到内存再重载弹幕
            const fresh = new EDE();
            for (const prop of Object.keys(fresh)) {
                if (!EDE_RUNTIME_KEYS.has(prop)) {
                    window.ede[prop] = fresh[prop];
                }
            }
            blockRulesCache = { key: null, rules: null };
            window.ede.lastRawComments = null;
            reloadDanmaku('reload');
        } catch (err) {
            showDebugInfo(`导入失败: ${err.message}`);
        }
    }

    // ---------- 稳定性：失败自动重试 / 卡死恢复 / 容器看门狗 ----------
    let danmakuRetryTimer = null;
    let danmakuRetryCount = 0;

    function scheduleDanmakuRetry(reason) {
        if (danmakuRetryTimer || danmakuRetryCount >= 3) {
            return;
        }
        danmakuRetryCount++;
        showDebugInfo(`弹幕未就位（${reason}），3 秒后自动重试 (${danmakuRetryCount}/3)`);
        danmakuRetryTimer = setTimeout(() => {
            danmakuRetryTimer = null;
            window.ede.loading = false;
            window.ede.loadingSince = 0;
            reloadDanmaku('reload');
        }, 3000);
    }

    function resetDanmakuRetry() {
        danmakuRetryCount = 0;
        if (danmakuRetryTimer) {
            clearTimeout(danmakuRetryTimer);
            danmakuRetryTimer = null;
        }
    }

    /** 用最近一次拉取的原始弹幕本地重渲染（不重新请求接口） */
    function rerenderFromCache() {
        if (!window.ede.lastRawComments || window.ede.lastRawComments.length === 0) {
            return false;
        }
        // 已经换到别的条目：缓存是上一集的，不能拿来渲染
        if (window.ede.lastRawCommentsItemId !== itemId) {
            window.ede.lastRawComments = null;
            return false;
        }
        createDanmaku(window.ede.lastRawComments).catch((err) => showDebugInfo(`重新渲染失败: ${err.message}`));
        return true;
    }

    let danmakuReattachTries = 0;

    // React 重新渲染可能把弹幕容器摘掉——看门狗负责补挂，避免“库里有弹幕但屏幕上看不到”
    function startDanmakuWatchdog() {
        danmakuReattachTries = 0;
        if (window.ede.watchdogTimer) {
            clearInterval(window.ede.watchdogTimer);
        }
        let ticks = 0;
        window.ede.watchdogTimer = setInterval(() => {
            ticks++;
            if (ticks > 300) {
                clearInterval(window.ede.watchdogTimer);
                window.ede.watchdogTimer = null;
                return;
            }
            if (!document.querySelector(mediaQueryStr)) {
                return;
            }
            if (!window.ede.danmaku || !document.getElementById('danmakuWrapper')) {
                if (danmakuReattachTries < 3 && window.ede.lastRawComments) {
                    danmakuReattachTries++;
                    showDebugInfo('弹幕容器/对象丢失，自动重建');
                    window.ede.loading = false;
                    rerenderFromCache();
                }
            }
        }, 2000);
    }

    // ---------- 御坂网络（misaka）预设 ----------
    function normalizeMisakaPrefix(base, token) {
        const b = String(base || '').trim().replace(/\/+$/, '');
        const t = String(token || '').trim().replace(/^\/+|\/+$/g, '');
        if (!b) {
            return '';
        }
        if (/\/api\/v1\//.test(b)) {
            return b;
        }
        if (!t) {
            return '';
        }
        return `${b}/api/v1/${t}`;
    }

    function applyMisakaPreset() {
        const baseEl = document.getElementById('misakaBase');
        const tokenEl = document.getElementById('misakaToken');
        if (!baseEl || !tokenEl) {
            return;
        }
        const prefix = normalizeMisakaPrefix(baseEl.value, tokenEl.value);
        if (!prefix) {
            showDebugInfo('御坂网络地址或客户端 token 为空');
            return;
        }
        window.ede.misakaBase = baseEl.value.trim();
        window.ede.misakaToken = tokenEl.value.trim();
        window.localStorage.setItem('misakaBase', window.ede.misakaBase);
        window.localStorage.setItem('misakaToken', window.ede.misakaToken);
        window.ede.customApiPrefix = prefix;
        window.localStorage.setItem('customApiPrefix', prefix);
        window.ede.customCorsProxy = '';
        window.localStorage.setItem('customCorsProxy', '');
        const apiEl = document.getElementById('customApiPrefix');
        if (apiEl) {
            apiEl.value = prefix;
        }
        const corsEl = document.getElementById('customCorsProxy');
        if (corsEl) {
            corsEl.value = '';
        }
        showDebugInfo(`已切换到御坂网络 API：${prefix}`);
        if (!rerenderFromCache()) {
            reloadDanmaku('reload');
        }
    }

    async function testMisakaConnection() {
        const prefix = getApiPrefix();
        // 御坂网络有免鉴权的 /api/health，先探活
        const base = String(window.ede.customApiPrefix || '').split('/api/v1/')[0];
        if (base) {
            try {
                const health = await makeGetRequest(`${base}/api/health`);
                const text = await health.text();
                showDebugInfo(`服务探活：${String(text).slice(0, 120)}`);
            } catch (err) {
                showDebugInfo(`服务探活失败: ${err.message}`);
            }
        }
        const item = await getEmbyItemInfo();
        const name = window.ede.episode_info?.animeTitle || item?.SeriesName || item?.Name || '';
        if (!name) {
            showDebugInfo('未能识别当前番剧名，先播放一集再测试');
            return;
        }
        try {
            const resp = await makeGetRequest(`${prefix}/api/v2/search/episodes?anime=${encodeURIComponent(name)}`);
            const data = await resp.json();
            if (data?.success === false) {
                showDebugInfo(`接口返回错误：errorCode=${data.errorCode ?? '未知'} ${describeApiError(data.errorCode)}`);
                return;
            }
            const n = data?.animes?.length || 0;
            showDebugInfo(`接口连通，搜索「${name}」命中 ${n} 个结果`);
            if (n > 0) {
                showDebugInfo(`首个结果：${data.animes[0].animeTitle}（${data.animes[0].episodes?.length || 0} 集）`);
            }
        } catch (err) {
            showDebugInfo(`接口测试失败: ${err.message}`);
        }
    }

    function tryXmlDanmakuFallback() {
        return getItemId()
            .then((id) => (id ? getCommentsByPluginApi(id) : null))
            .then((comments) => {
                if (comments && comments.length > 0) {
                    showDebugInfo(`改用 Jellyfin 弹幕插件的弹幕: ${comments.length} 条`);
                    return createDanmaku(comments).then(() => showDebugInfo('弹幕就位（插件）'));
                }
                showDebugInfo('Jellyfin 弹幕插件也没有这一集的弹幕');
            })
            .catch((err) => showDebugInfo(`插件弹幕回退失败: ${err.message}`));
    }

    // ---------- 时间轴微调 / 设置实时生效 ----------
    function nudgeDanmakuOffset(delta) {
        const input = document.getElementById('danmakuOffsetTime');
        const base = input ? parseFloat(input.value) || 0 : window.ede.curEpOffset || 0;
        const next = Math.round((base + delta) * 10) / 10;
        if (input) {
            input.value = next;
        }
        setCurEpOffset(next);
        showDebugInfo(`弹幕偏移调整为 ${next} 秒`);
        if (!rerenderFromCache()) {
            reloadDanmaku('reload');
        }
    }

    // 偏移按集保存：已知当前集的 key 就立即写入，否则留到 getEpisodeInfo 拿到 key 时再写
    function setCurEpOffset(offset) {
        window.ede.curEpOffset = offset;
        if (window.ede.curEpOffsetKey) {
            window.localStorage.setItem(window.ede.curEpOffsetKey, offset);
            window.ede.curEpOffsetModified = false;
        } else {
            window.ede.curEpOffsetModified = true;
        }
    }

    let liveApplyTimer = null;

    function liveApplyDisplaySettings() {
        try {
            const opacityEl = document.getElementById('opacity');
            const speedEl = document.getElementById('speed');
            const fontSizeEl = document.getElementById('fontSize');
            const heightEl = document.getElementById('heightRatio');
            const densityEl = document.getElementById('danmakuDensityLimit');
            if (opacityEl) {
                window.ede.opacity = parseFloatOfRange(opacityEl.value, 0, 1);
            }
            if (speedEl) {
                window.ede.speed = parseFloatOfRange(speedEl.value, 20, 600);
            }
            if (fontSizeEl) {
                window.ede.fontSize = parseFloatOfRange(fontSizeEl.value, 8, 40);
            }
            if (heightEl) {
                window.ede.heightRatio = parseFloatOfRange(heightEl.value, 0, 1);
            }
            if (densityEl) {
                window.ede.danmakuDensityLimit = parseInt(densityEl.value, 10);
            }
        } catch (err) {
            return;
        }
        const wrapper = document.getElementById('danmakuWrapper');
        if (wrapper) {
            wrapper.style.opacity = window.ede.opacity;
            wrapper.style.height = `calc(${window.ede.heightRatio * 100}% - 18px)`;
        }
        if (liveApplyTimer) {
            clearTimeout(liveApplyTimer);
        }
        liveApplyTimer = setTimeout(() => rerenderFromCache(), 400);
    }
    // ===== v2：Danmaku 引擎运行时补丁（移植自 l429609201/dd-danmaku 的 misaka 版）=====
    // 1) 拖动进度条后弹幕立即恢复（原库恢复期间有几秒空窗）
    // 2) 倍速切换 / 暂停时不漂移：统一按 media.currentTime 计算位置
    function buildPatchedDanmakuClass(DanmakuClass) {
        if (!DanmakuClass || DanmakuClass.__edePatched) {
            return DanmakuClass;
        }
        const OrigDanmaku = DanmakuClass;

        class SeekingPatched extends OrigDanmaku {
            constructor(opts) {
                super(opts);
                if (!this.media || !this.comments || !this._) {
                    return;
                }
                const self = this;
                this._patchedSeekingTimer = null;
                this._patchedSeekingHandler = function () {
                    self._patchedSeekingTimer = null;
                    if (!self.media || !self.comments || !self._) {
                        return;
                    }
                    // 下界二分：没有匹配项时停在末尾，避免重扫历史弹幕
                    const targetTime = self.media.currentTime - (self._.duration || 4);
                    let low = 0;
                    let high = self.comments.length;
                    while (low < high) {
                        const mid = low + Math.floor((high - low) / 2);
                        if (self.comments[mid].time < targetTime) {
                            low = mid + 1;
                        } else {
                            high = mid;
                        }
                    }
                    self._.position = low;
                };
                this._patchedSeekingWrapper = function () {
                    if (self._patchedSeekingTimer !== null) {
                        clearTimeout(self._patchedSeekingTimer);
                    }
                    self._patchedSeekingTimer = setTimeout(self._patchedSeekingHandler, 0);
                };
                this.media.addEventListener('seeking', this._patchedSeekingWrapper);
            }

            destroy() {
                clearTimeout(this._patchedSeekingTimer);
                this._patchedSeekingTimer = null;
                if (this.media && this._patchedSeekingWrapper) {
                    this.media.removeEventListener('seeking', this._patchedSeekingWrapper);
                    this._patchedSeekingWrapper = null;
                    this._patchedSeekingHandler = null;
                }
                return super.destroy();
            }
        }

        class TimePatched extends SeekingPatched {
            constructor(opts) {
                super(opts);
                if (
                    !this.media ||
                    typeof this._?.engine?.render !== 'function' ||
                    typeof this._?.listener?.pause !== 'function' ||
                    typeof this._?.listener?.play !== 'function'
                ) {
                    return;
                }
                const renderer = this._.engine.render;
                const running = !this._.paused;
                // 只重启本实例的帧循环，不发事件、不清空弹幕
                if (running) {
                    this._.listener.pause();
                }
                this._.engine = Object.assign({}, this._.engine, {
                    render: (stage, comment) => {
                        if (comment.mode === 'rtl' || comment.mode === 'ltr') {
                            // currentTime 已包含倍速，不能再乘 playbackRate
                            const distance = ((this._.width + comment.width) * (this.media.currentTime - comment.time)) / this._.duration;
                            comment.x = comment.mode === 'rtl' ? this._.width - distance : distance - comment.width;
                        }
                        renderer.call(this, stage, comment);
                    },
                });
                if (running) {
                    this._.listener.play();
                }
            }
        }

        TimePatched.__edePatched = true;
        return TimePatched;
    }

    let patchedDanmakuClass = null;

    function getDanmakuClass() {
        if (!patchedDanmakuClass) {
            patchedDanmakuClass = buildPatchedDanmakuClass(typeof Danmaku !== 'undefined' ? Danmaku : window.Danmaku);
            showDebugInfo('已启用 Danmaku 引擎补丁（进度条恢复 / 倍速不漂移）');
        }
        return patchedDanmakuClass;
    }

    // 创建弹幕设置侧边栏
    function createDanmakuSidebar() {
        // 防止创建重复的侧边栏
        if (document.getElementById('danmakuSidebar')) {
            return;
        }

        const sidebar = document.createElement('div');
        sidebar.id = 'danmakuSidebar';
        sidebar.className = 'danmakuSidebar';

        // 创建头部
        const header = document.createElement('div');
        header.className = 'danmakuSidebarHeader';

        const titleEl = document.createElement('h2');
        titleEl.textContent = '弹幕设置';
        titleEl.className = 'danmakuSidebarTitle';

        // 创建右侧按钮组
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'danmakuSidebarButtons';

        // 保存按钮
        const saveButton = document.createElement('button');
        saveButton.innerHTML = '保存';
        saveButton.title = '保存设置';
        saveButton.className = 'danmakuSidebarSaveButton';

        saveButton.onclick = () => {
            saveSettings();
            closeDanmakuSidebar();
        };

        // 取消按钮
        const cancelButton = document.createElement('button');
        cancelButton.innerHTML = '取消';
        cancelButton.title = '取消设置';
        cancelButton.className = 'danmakuSidebarCancelButton';

        cancelButton.onclick = () => {
            closeDanmakuSidebar();
        };

        buttonsContainer.appendChild(saveButton);
        buttonsContainer.appendChild(cancelButton);

        header.appendChild(titleEl);
        header.appendChild(buttonsContainer);
        sidebar.appendChild(header);

        // 创建设置内容容器
        const settingsContainer = document.createElement('div');
        settingsContainer.className = 'danmakuSettingsContainer';
        sidebar.appendChild(settingsContainer);

        // 处理设置项
        setTimeout(() => {
            setupDanmakuSettings(settingsContainer);
        }, 100);

        // 创建遮罩层，防止点击侧边栏外部时暂停视频
        const backdrop = document.createElement('div');
        backdrop.className = 'dialogBackdrop dialogBackdropOpened';
        backdrop.id = 'danmakuSidebarBackdrop';

        // 将遮罩和侧边栏都添加到body
        document.body.appendChild(backdrop);
        document.body.appendChild(sidebar);

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
            overlay.id = 'inputDialogOverlay';
            overlay.className = 'dialogOverlay';

            const dialog = document.createElement('div');
            dialog.id = 'inputDialog';
            dialog.className = 'inputDialog';

            dialog.innerHTML = `
                <h3 class="dialogTitle">${title}</h3>
                <input type="text" id="dialogInput" placeholder="${placeholder}" value="${defaultValue}" />
                <div class="dialogActions">
                    <button id="dialogCancel">取消</button>
                    <button id="dialogConfirm">确认</button>
                </div>
            `;

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // 添加磨砂玻璃效果层
            const glassLayer = document.createElement('div');
            glassLayer.className = 'glassLayer';
            dialog.appendChild(glassLayer);

            const input = dialog.querySelector('#dialogInput');
            const cancelBtn = dialog.querySelector('#dialogCancel');
            const confirmBtn = dialog.querySelector('#dialogConfirm');

            input.focus();
            input.select();

            input.addEventListener('keydown', (event) => event.stopPropagation(), true);

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
            overlay.id = 'selectDialogOverlay';
            overlay.className = 'dialogOverlay';

            const dialog = document.createElement('div');
            dialog.id = 'selectDialog';
            dialog.className = 'selectDialog';

            const titleEl = document.createElement('h3');
            titleEl.className = 'dialogTitle';
            titleEl.textContent = title;

            const listContainer = document.createElement('div');
            listContainer.className = 'selectDialogList';

            let selectedIndex = defaultIndex;

            options.forEach((option, index) => {
                const item = document.createElement('div');
                item.className = 'select-dialog-item';
                if (index === selectedIndex) {
                    item.classList.add('selected');
                }
                item.textContent = option;

                item.onclick = () => {
                    // 更新选中状态
                    listContainer.querySelectorAll('.select-dialog-item').forEach((el, i) => {
                        if (i === index) {
                            el.classList.add('selected');
                        } else {
                            el.classList.remove('selected');
                        }
                    });
                    selectedIndex = index;
                };

                listContainer.appendChild(item);
            });

            const buttonsContainer = document.createElement('div');
            buttonsContainer.className = 'dialogActions';

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.className = 'dialogCancelButton';

            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = '确认';
            confirmBtn.className = 'dialogConfirmButton';

            buttonsContainer.appendChild(cancelBtn);
            buttonsContainer.appendChild(confirmBtn);

            dialog.appendChild(titleEl);
            dialog.appendChild(listContainer);
            dialog.appendChild(buttonsContainer);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // 添加磨砂玻璃效果层
            const glassLayer = document.createElement('div');
            glassLayer.className = 'glassLayer';
            dialog.appendChild(glassLayer);

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
            wrapper.classList.add('settings-html-element');
            wrapper.innerHTML = html;
            return wrapper;
        }

        const categories = {
            controls: [],
            display: [
                htmlToElement(`
            <span id="lbdanmakuDensityLimit" class="settings-flex-auto">密度限制等级:</span>
            <input type="range" id="danmakuDensityLimit"  min="0" max="3" step="1" value="${window.ede.danmakuDensityLimit}" />
        `),
                htmlToElement(`                            
            <label class="settings-flex-auto">弹幕防重叠:</label>
            <div><input type="radio" id="enableAntiOverlap" name="useAnitOverlap" value="1" ${window.ede.useAnitOverlap === 1 ? 'checked' : ''}>
                <label for="enableAntiOverlap">是</label></div>
            <div><input type="radio" id="disableAntiOverlap" name="useAnitOverlap" value="0" ${window.ede.useAnitOverlap === 0 ? 'checked' : ''}>
                <label for="disableAntiOverlap">否</label></div>
        `),
                htmlToElement(`
            <label class="settings-flex-auto">简繁转换:</label>
            <div><input type="radio" id="chConvert0" name="chConvert" value="0" ${window.ede.chConvert === 0 ? 'checked' : ''}>
                <label for="chConvert0">不转换</label></div>
            <div><input type="radio" id="chConvert1" name="chConvert" value="1" ${window.ede.chConvert === 1 ? 'checked' : ''}>
                <label for="chConvert1">简体</label></div>
            <div><input type="radio" id="chConvert2" name="chConvert" value="2" ${window.ede.chConvert === 2 ? 'checked' : ''}>
                <label for="chConvert2">繁体</label></div>
        `),
                htmlToElement(`
            <label class="settings-flex-auto">使用本地xml弹幕:</label>
            <div><input type="radio" id="enableXmlDanmaku" name="useXmlDanmaku" value="1" ${window.ede.useXmlDanmaku === 1 ? 'checked' : ''}>
                <label for="chConvert0">是</label></div>
            <div><input type="radio" id="disableXmlDanmaku" name="useXmlDanmaku" value="0" ${window.ede.useXmlDanmaku === 0 ? 'checked' : ''}>
                <label for="chConvert1">否</label></div>
        `),
                htmlToElement(`
            <label class="settings-flex-auto">当前弹幕偏移时间:</label>
            <div><input class="settings-flex-grow" id="danmakuOffsetTime" placeholder="秒" value="${window.ede.curEpOffset || 0}" /></div>
        `),
                htmlToElement(`
            <label class="settings-flex-auto">匹配信息自动隐藏:</label>
            <div><input class="settings-flex-grow" id="danmakuInfoHideSeconds" type="number" min="0" max="60" step="1" value="${window.ede.infoHideSeconds}" placeholder="秒（0=常显）" /></div>
        `),
            ],
            style: [
                htmlToElement(`
            <span id="lbopacity" class="settings-flex-auto">透明度:</span>
            <input type="range" id="opacity" min="0" max="1" step="0.1" value="${window.ede.opacity || 0.7}" />
        `),
                htmlToElement(`
            <span id="lbspeed" class="settings-flex-auto">弹幕速度:</span>
            <input type="range" id="speed" min="20" max="600" step="10" value="${window.ede.speed || 200}" />
        `),
                htmlToElement(`
            <label class="settings-flex-auto">字体:</label>
            <div><input class="settings-flex-grow" id="danmakuFontFamily" placeholder="sans-serif" value="${
                window.ede.fontFamily?.replaceAll('"', '&quot;') ?? defaultFontFamily
            }" /></div>
        `),
                htmlToElement(`
            <span id="lbfontSize" class="settings-flex-auto">字体大小:</span>
            <input type="range" id="fontSize" min="8" max="80" step="1" value="${window.ede.fontSize || 18}" />
        `),
                htmlToElement(`
            <label class="settings-flex-auto">其他字体选项:</label>
            <div><input class="settings-flex-grow" id="danmakuFontOptions" placeholder="" value="${window.ede.fontOptions?.replaceAll('"', '&quot;') ?? ''}" /></div>
        `),
                htmlToElement(`
            <span id="lbheightRatio" class="settings-flex-auto">高度比例:</span>
            <input type="range" id="heightRatio" min="0" max="1" step="0.05" value="${window.ede.heightRatio || 0.9}" />
        `),
            ],
            filter: [
                htmlToElement(`
            <label class="settings-flex-auto">弹幕过滤:</label>
            <div><input type="checkbox" id="filterBilibili" name="danmakuFilter" value="1" ${(window.ede.danmakuFilter & 1) === 1 ? 'checked' : ''} />
                <label for="filterBilibili">B站</label></div>
            <div><input type="checkbox" id="filterGamer" name="danmakuFilter" value="2" ${(window.ede.danmakuFilter & 2) === 2 ? 'checked' : ''} />
                <label for="filterGamer">巴哈</label></div>
            <div><input type="checkbox" id="filterDanDanPlay" name="danmakuFilter" value="4" ${(window.ede.danmakuFilter & 4) === 4 ? 'checked' : ''} />
                <label for="filterDanDanPlay">弹弹</label></div>
            <div><input type="checkbox" id="filterOthers" name="danmakuFilter" value="8" ${(window.ede.danmakuFilter & 8) === 8 ? 'checked' : ''} />
                <label for="filterOthers">其他</label></div>
        `),
                htmlToElement(`
            <label class="settings-flex-auto">弹幕类型过滤:</label>
            <div><input type="checkbox" id="filterBottom" name="danmakuModeFilter" value="1" ${(window.ede.danmakuModeFilter & 1) === 1 ? 'checked' : ''} />
                <label for="filterBottom">底部</label></div>
            <div><input type="checkbox" id="filterTop" name="danmakuModeFilter" value="2" ${(window.ede.danmakuModeFilter & 2) === 2 ? 'checked' : ''} />
                <label for="filterTop">顶部</label></div>
            <div><input type="checkbox" id="filterRoll" name="danmakuModeFilter" value="4" ${(window.ede.danmakuModeFilter & 4) === 4 ? 'checked' : ''} />
                <label for="filterRoll">滚动</label></div>
        `),
            ],
            block: [
                htmlToElement(`
            <label class="settings-flex-auto">屏蔽关键词/正则:</label>
            <div class="danmaku-block-enable"><input type="checkbox" id="danmakuBlockEnableKeywords" ${window.ede.blockEnableKeywords === 1 ? 'checked' : ''} /><label for="danmakuBlockEnableKeywords">启用</label></div>
            <div class="danmaku-block-input"><textarea id="danmakuBlockKeywords" spellcheck="false" placeholder="每行一条：# 开头为注释；普通文本按“包含”匹配；/正则/flags 或 re:正则 按正则匹配">${escapeHtml(window.ede.blockKeywords)}</textarea></div>
        `),
                htmlToElement(`
            <label class="settings-flex-auto">屏蔽发送者:</label>
            <div class="danmaku-block-enable"><input type="checkbox" id="danmakuBlockEnableUsers" ${window.ede.blockEnableUsers === 1 ? 'checked' : ''} /><label for="danmakuBlockEnableUsers">启用</label></div>
            <div class="danmaku-block-input"><textarea id="danmakuBlockUsers" spellcheck="false" placeholder="按发送者匹配（包含即屏蔽），例如 [BiliBili] 或某个用户名">${escapeHtml(window.ede.blockUsers)}</textarea></div>
        `),
                htmlToElement(`
            <label class="settings-flex-auto">屏蔽颜色:</label>
            <div class="danmaku-block-enable"><input type="checkbox" id="danmakuBlockEnableColors" ${window.ede.blockEnableColors === 1 ? 'checked' : ''} /><label for="danmakuBlockEnableColors">启用</label></div>
            <div class="danmaku-block-input"><input id="danmakuBlockColors" placeholder="颜色值，逗号分隔，如 ff0000,#00ff00" value="${escapeHtml(window.ede.blockColors)}" /></div>
        `),
                htmlToElement(`
            <label class="settings-flex-auto">正文清理:</label>
            <div class="danmaku-block-enable"><input type="checkbox" id="danmakuStripLikeSuffix" ${window.ede.stripLikeSuffix === 1 ? 'checked' : ''} /><label for="danmakuStripLikeSuffix">去掉点赞数</label></div>
            <div class="danmaku-block-input"><span class="danmakuHint">去掉 B 站弹幕正文尾部的“🤍 28”这类点赞数（御坂网络默认会拼上去）</span></div>
        `),
                htmlToElement(`
            <label class="settings-flex-auto">合并相似弹幕:</label>
            <div class="danmaku-block-enable"><input type="checkbox" id="danmakuMergeSimilar" ${window.ede.mergeSimilar === 1 ? 'checked' : ''} /><label for="danmakuMergeSimilar">启用</label></div>
            <div class="danmaku-block-input"><input id="danmakuMergeThreshold" type="number" min="50" max="100" step="1" value="${window.ede.mergeThreshold}" placeholder="相似度阈值 50-100" /></div>
        `),
                (() => {
                    const item = document.createElement('div');
                    item.className = 'controlItem controlCard';
                    item.innerHTML = `
                <div class="controlInfo">
                    <div class="controlText">
                        <div class="controlTitle">屏蔽规则导入 / 导出</div>
                        <div class="controlDescription">导出一段 JSON，换设备时导入回来</div>
                    </div>
                </div>
                <div class="danmaku-block-actions">
                    <button type="button" id="danmakuBlockExport">导出</button>
                    <button type="button" id="danmakuBlockImport">导入</button>
                    <button type="button" id="danmakuBlockClear">清空</button>
                </div>
            `;
                    return item;
                })(),
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
        tabsContainer.className = 'danmakuTabsContainer';
        container.appendChild(tabsContainer);

        const tabs = [
            { id: 'controls', title: '控制功能', items: categories.controls },
            { id: 'style', title: '显示样式', items: categories.style },
            { id: 'display', title: '显示设置', items: categories.display },
            { id: 'filter', title: '过滤设置', items: categories.filter },
            { id: 'block', title: '屏蔽', items: categories.block },
        ];

        // 先清空容器的旧内容（除了tabsContainer）
        Array.from(container.children)
            .filter((child) => child !== tabsContainer)
            .forEach((child) => child.remove());

        // 一次性创建所有标签页内容区域，并加入container
        tabs.forEach((tab) => {
            const tabContent = document.createElement('div');
            tabContent.className = 'danmaku-tab-content';
            tabContent.dataset.tabId = tab.id;

            if (tab.id === 'controls') {
                tabContent.classList.add('controls', 'active'); // 默认显示控制功能页
                tab.items.forEach((item) => {
                    tabContent.appendChild(item);
                });
            } else {
                tab.items.forEach((item) => {
                    styleSettingItemForContent(item);
                    tabContent.appendChild(item);
                });
            }

            container.appendChild(tabContent);
        });

        // 设置默认活动标签
        let activeTabId = tabs.length > 0 ? tabs[0].id : null;

        // 创建标签按钮并绑定切换事件
        tabs.forEach((tab) => {
            const tabButton = document.createElement('button');
            tabButton.textContent = tab.title;
            tabButton.dataset.tabId = tab.id;
            tabButton.className = 'danmaku-tab-button';
            
            // 设置初始状态
            if (tab.id === activeTabId) {
                tabButton.classList.add('active');
            } else {
                tabButton.classList.add('inactive');
            }

            tabButton.addEventListener('click', function () {
                // 切换按钮样式
                document.querySelectorAll('.danmaku-tab-button').forEach((btn) => {
                    btn.classList.remove('active');
                    btn.classList.add('inactive');
                });
                this.classList.remove('inactive');
                this.classList.add('active');

                // 显示对应标签内容
                showTabContent(this.dataset.tabId);
            });

            tabsContainer.appendChild(tabButton);
        });

        // 切换显示标签内容
        function showTabContent(tabId) {
            activeTabId = tabId;

            // 隐藏所有标签页内容
            container.querySelectorAll('.danmaku-tab-content').forEach((div) => {
                div.classList.remove('active');
                div.classList.remove('controls');
            });

            // 显示当前激活的标签内容
            const activeContent = container.querySelector(`.danmaku-tab-content[data-tab-id="${tabId}"]`);
            if (activeContent) {
                activeContent.classList.add('active');
                if (tabId === 'controls') {
                    activeContent.classList.add('controls');
                }
            }
        }
        
        document.getElementById('danmakuFontOptions').addEventListener('keydown', (event) => event.stopPropagation(), true);
        document.getElementById('danmakuFontFamily').addEventListener('keydown', (event) => event.stopPropagation(), true);
        document.getElementById('danmakuOffsetTime').addEventListener('keydown', (event) => event.stopPropagation(), true);
        document.getElementById('customCorsProxy').addEventListener('keydown', (event) => event.stopPropagation(), true);
        document.getElementById('customApiPrefix').addEventListener('keydown', (event) => event.stopPropagation(), true);

        // ===== v2：新增控件事件绑定 =====
        ['danmakuBlockKeywords', 'danmakuBlockUsers', 'danmakuBlockColors', 'danmakuMergeThreshold', 'misakaBase', 'misakaToken'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('keydown', (event) => event.stopPropagation(), true);
            }
        });
        const blockExportBtn = document.getElementById('danmakuBlockExport');
        if (blockExportBtn) {
            blockExportBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                exportBlockRules();
            });
        }
        const blockImportBtn = document.getElementById('danmakuBlockImport');
        if (blockImportBtn) {
            blockImportBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                importBlockRules();
            });
        }
        const blockClearBtn = document.getElementById('danmakuBlockClear');
        if (blockClearBtn) {
            blockClearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                clearBlockRules();
            });
        }
        const misakaApplyBtn = document.getElementById('misakaApply');
        if (misakaApplyBtn) {
            misakaApplyBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                applyMisakaPreset();
            });
        }
        const misakaTestBtn = document.getElementById('misakaTest');
        if (misakaTestBtn) {
            misakaTestBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                testMisakaConnection();
            });
        }
        const settingsExportBtn = document.getElementById('danmakuSettingsExport');
        if (settingsExportBtn) {
            settingsExportBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                exportAllSettings();
            });
        }
        const settingsImportBtn = document.getElementById('danmakuSettingsImport');
        if (settingsImportBtn) {
            settingsImportBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                importAllSettings();
            });
        }
        // 拖完滑块立即生效（本地重渲染，不重新请求接口）
        ['opacity', 'speed', 'fontSize', 'heightRatio', 'danmakuDensityLimit'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => liveApplyDisplaySettings());
            }
        });
        document.querySelectorAll('.settingItem').forEach((el) => {
            if (el.querySelector('textarea, .danmaku-block-input')) {
                el.classList.add('danmaku-block-item');
            }
        });
        
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
            danmakuSwitchItem.className = 'controlItem controlCard danmakuSwitchCard';

            danmakuSwitchItem.innerHTML = `
                <div class="controlInfo">
                    <div class="controlText">
                        <div class="controlTitle">弹幕显示</div>
                        <div class="controlDescription">控制弹幕的显示与隐藏</div>
                    </div>
                </div>
                <label class="modernSwitch">
                    <input type="checkbox" ${isDanmukuEnabled ? 'checked' : ''}>
                    <span class="modernSlider"></span>
                </label>
            `;

            const checkbox = danmakuSwitchItem.querySelector('input[type="checkbox"]');
            const switchLabel = danmakuSwitchItem.querySelector('.modernSwitch');

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
            logSwitchItem.className = 'controlItem controlCard logSwitchCard';

            logSwitchItem.innerHTML = `
                <div class="controlInfo">
                    <div class="controlText">
                        <div class="controlTitle" >日志显示</div>
                        <div class="controlDescription">显示调试信息和日志</div>
                    </div>
                </div>
                <label class="modernSwitch">
                    <input type="checkbox" ${isLogEnabled ? 'checked' : ''}>
                    <span class="modernSlider"></span>
                </label>
            `;

            const checkbox = logSwitchItem.querySelector('input[type="checkbox"]');
            const switchLabel = logSwitchItem.querySelector('.modernSwitch');

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
            searchItem.className = 'controlItem controlCard searchItemCard';

            searchItem.innerHTML = `
                <div class="controlInfo">
                    <div class="controlText">
                        <div class="controlTitle" >弹幕搜索</div>
                        <div class="controlDescription">搜索视频弹幕</div>
                    </div>
                </div>
                <div class="searchItemControlAction">搜索</div>
            `;

            searchItem.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (window.ede.loading) {
                    showDebugInfo('正在加载,请稍后再试');
                    return;
                }
                showDebugInfo('手动匹配弹幕');
                reloadDanmaku('search');
            });

            controlItems.push(searchItem);
        }

        // 添加增加弹幕源控制项
        {
            const addSourceItem = document.createElement('div');
            addSourceItem.className = 'controlItem controlCard addSourceItemCard';

            addSourceItem.innerHTML = `
                <div class="controlInfo">
                    <div class="controlText">
                        <div class="controlTitle" >增加弹幕源</div>
                        <div class="controlDescription">添加新的弹幕数据源，如B站播放链接</div>
                    </div>
                </div>
                <div class="addSourceItemControlAction">添加</div>
            `;

            addSourceItem.addEventListener('click', async function (e) {
                e.preventDefault();
                e.stopPropagation();
                // addSourceButton.click();
                showDebugInfo('手动增加弹幕源');
                let source = await createInputDialog('添加弹幕源', '请输入弹幕源地址(如B站播放链接)', '');
                if (source) {
                    getCommentsByUrl(source).then((comments) => {
                        if (comments !== null) {
                            createDanmaku(comments)
                                .then(() => {
                                    showDebugInfo('弹幕就位');

                                    // 如果已经登录，把弹幕源提交给弹弹Play
                                    if (ddplayStatus.isLogin) {
                                        postRelatedSource(source);
                                    }
                                })
                                .catch((error) => {
                                    console.error(`创建弹幕失败: ${error.message}`);
                                });
                        }
                    });
                } else {
                    showDebugInfo('未获取弹幕源地址');
                }
            });

            controlItems.push(addSourceItem);
        }

        // 添加自定义cors代理和API选项
        {
            const customCorsProxy = document.createElement('div');
            customCorsProxy.className = 'controlItem controlCard customCorsProxyCard';

            customCorsProxy.innerHTML = `
            <div class="controlInfo">
                <div class="controlText">
                    <div class="controlTitle" >配置第三方弹幕库，如御坂网络</div>
                </div>
            </div>
            <div class="custom-input-group">
                <label for="customCorsProxy" class="custom-input-label">CORS代理:</label>
                <input id="customCorsProxy" 
                       class="custom-input-field" 
                       placeholder="自定义CORS代理，留空使用默认" 
                       value="${window.ede.customCorsProxy ?? ''}" />
            </div>
            <div class="custom-input-group">
                <label for="customApiPrefix" class="custom-input-label">API:</label>
                <input id="customApiPrefix" 
                       class="custom-input-field" 
                       placeholder="自定义API，留空使用默认" 
                       value="${window.ede.customApiPrefix ?? ''}" />
            </div>
            `;

            controlItems.push(customCorsProxy);
        }

        // ===== v2：御坂网络（misaka）一键配置 =====
        {
            const misakaItem = document.createElement('div');
            misakaItem.className = 'controlItem controlCard danmakuMisakaCard';
            misakaItem.innerHTML = `
                <div class="controlInfo">
                    <div class="controlText">
                        <div class="controlTitle">御坂网络 (misaka) 一键配置</div>
                        <div class="controlDescription">填服务地址与客户端 token，自动写入上面的 API 字段</div>
                    </div>
                </div>
                <div class="danmakuMisakaRow">
                    <input id="misakaBase" placeholder="http://192.168.1.10:7768" value="${escapeHtml(window.ede.misakaBase)}" />
                    <input id="misakaToken" placeholder="客户端 token（misaka 网页端里的调用令牌）" value="${escapeHtml(window.ede.misakaToken)}" />
                </div>
                <div class="danmaku-block-actions">
                    <button type="button" id="misakaApply">应用</button>
                    <button type="button" id="misakaTest">测试接口</button>
                </div>
            `;
            controlItems.push(misakaItem);
        }

        // ===== v2：重新加载弹幕（“库里明明有却不显示”时先点这里） =====
        {
            const reloadItem = document.createElement('div');
            reloadItem.className = 'controlItem controlCard danmakuReloadCard';
            reloadItem.innerHTML = `
                <div class="controlInfo">
                    <div class="controlText">
                        <div class="controlTitle">重新加载弹幕</div>
                        <div class="controlDescription">强制重新匹配并拉取当前这一集的弹幕</div>
                    </div>
                </div>
                <div class="danmaku-block-actions">
                    <button type="button" id="danmakuForceReload">重载</button>
                </div>
            `;
            reloadItem.querySelector('#danmakuForceReload').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                resetDanmakuRetry();
                window.ede.loading = false;
                window.ede.loadingSince = 0;
                showDebugInfo('手动重新加载弹幕');
                reloadDanmaku('reload');
            });
            controlItems.push(reloadItem);
        }

        // ===== v2：时间轴微调（按集记忆） =====
        {
            const offsetItem = document.createElement('div');
            offsetItem.className = 'controlItem controlCard danmakuOffsetCard';
            offsetItem.innerHTML = `
                <div class="controlInfo">
                    <div class="controlText">
                        <div class="controlTitle">弹幕时间轴微调</div>
                        <div class="controlDescription">提前/延后若干秒，按当前这一集记忆</div>
                    </div>
                </div>
                <div class="danmaku-offset-buttons">
                    <button type="button" data-offset="-1">-1s</button>
                    <button type="button" data-offset="-0.5">-0.5s</button>
                    <button type="button" data-offset="0.5">+0.5s</button>
                    <button type="button" data-offset="1">+1s</button>
                </div>
            `;
            offsetItem.querySelectorAll('button[data-offset]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    nudgeDanmakuOffset(parseFloat(btn.dataset.offset));
                });
            });
            controlItems.push(offsetItem);
        }

        // ===== v2：全量设置备份 / 恢复 =====
        {
            const backupItem = document.createElement('div');
            backupItem.className = 'controlItem controlCard danmakuBackupCard';
            backupItem.innerHTML = `
                <div class="controlInfo">
                    <div class="controlText">
                        <div class="controlTitle">设置备份 / 恢复</div>
                        <div class="controlDescription">把弹幕样式、过滤、API 等全部设置导出成 JSON</div>
                    </div>
                </div>
                <div class="danmaku-block-actions">
                    <button type="button" id="danmakuSettingsExport">导出</button>
                    <button type="button" id="danmakuSettingsImport">导入</button>
                </div>
            `;
            controlItems.push(backupItem);
        }

        // ===== v2：在线搜索失败时回退到 Jellyfin 弹幕插件 =====
        {
            const fallbackItem = document.createElement('div');
            fallbackItem.className = 'controlItem controlCard danmakuXmlFallbackCard';
            fallbackItem.innerHTML = `
                <div class="controlInfo">
                    <div class="controlText">
                        <div class="controlTitle">插件弹幕回退</div>
                        <div class="controlDescription">在线搜索没结果时，改用 Jellyfin 弹幕插件的弹幕</div>
                    </div>
                </div>
                <label class="modernSwitch">
                    <input type="checkbox" ${window.ede.xmlFallback === 1 ? 'checked' : ''}>
                    <span class="modernSlider"></span>
                </label>
            `;
            const fallbackCheckbox = fallbackItem.querySelector('input[type="checkbox"]');
            fallbackCheckbox.addEventListener('change', (e) => {
                e.stopPropagation();
                window.ede.xmlFallback = fallbackCheckbox.checked ? 1 : 0;
                window.localStorage.setItem('danmakuXmlFallback', window.ede.xmlFallback);
                showDebugInfo(`插件弹幕回退：${window.ede.xmlFallback === 1 ? '开' : '关'}`);
            });
            controlItems.push(fallbackItem);
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
                    if (
                        node.classList &&
                        node.classList.contains('actionSheet') &&
                        node.querySelector('[data-id="aspectratio"]') &&
                        node.querySelector('[data-id="playbackrate"]')
                    ) {
                        addDanmakuSettingsToMenu(node);
                    }
                    // 也检查子节点，以防菜单是在容器内添加的
                    const actionSheet = node.querySelector && node.querySelector('.actionSheet');
                    if (actionSheet && actionSheet.querySelector('[data-id="aspectratio"]') && actionSheet.querySelector('[data-id="playbackrate"]')) {
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
        span.style.maxHeight = '50%';
        window.ede.logSwitch == 1 ? (span.style.display = 'block') : (span.style.display = 'none');
        // v2：没有可见的 video-osd 容器时不要再抛错（抛了 initUI 会每 200ms 抛一次，等于初始化不了）
        if (_container) {
            _container.appendChild(span);
        } else if (document.getElementById('reactRoot')) {
            document.getElementById('reactRoot').appendChild(span);
        } else {
            document.body.appendChild(span);
        }

        showDebugInfo('UI初始化完成');
        reloadDanmaku('init');
        refreshDanDanPlayToken();
    }

    async function loginDanDanPlay(account, passwd) {
        const loginUrl = getApiPrefix() + '/api/v2/login';
        const params = {
            userName: account,
            password: passwd,
        };

        try {
            const resp = await fetch(loginUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'User-Agent': navigator.userAgent,
                },
                body: JSON.stringify(params),
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
            console.error(`登录失败: ${error.message}`);
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
            } else if (expire - now > 259200) {
                // Token expires in more than 3 days, no need to refresh
                return;
            } else {
                // Refresh token before 3 days
                const refreshUrl = getApiPrefix() + '/api/v2/login/renew';
                try {
                    const resp = await fetch(refreshUrl, {
                        method: 'GET',
                        headers: {
                            Accept: 'application/json',
                            'User-Agent': navigator.userAgent,
                            Authorization: 'Bearer ' + ddplayStatus.token,
                        },
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
                    console.error(`刷新弹弹Play Token失败 ${error.message}`);
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
            const danmakuUrl = getApiPrefix() + '/api/v2/comment/' + window.ede.episode_info.episodeId;
            const params = {
                time: time,
                mode: mode,
                color: color,
                comment: danmakuText,
            };
            try {
                const resp = await fetch(danmakuUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        'User-Agent': navigator.userAgent,
                        Authorization: 'Bearer ' + ddplayStatus.token,
                    },
                    body: JSON.stringify(params),
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
                console.error(`发送弹幕失败 ${error.message}`);
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
        const url = getApiPrefix() + '/api/v2/related/' + window.ede.episode_info.episodeId;
        const params = {
            episodeId: window.ede.episode_info.episodeId,
            url: relatedUrl,
            shift: 0,
        };
        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'User-Agent': navigator.userAgent,
                    Authorization: 'Bearer ' + ddplayStatus.token,
                },
                body: JSON.stringify(params),
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
            console.error(`发送相关链接失败 ${error.message}`);
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
        // v2：原本是死循环——itemId 拿不到时会永远每 200ms 轮询一次（issue #72 的表现之一）
        const deadline = Date.now() + 30000;
        while (!playingInfo) {
            if (Date.now() > deadline) {
                showDebugInfo('获取播放信息超时，可用“重新加载弹幕”重试');
                return null;
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
            if (isNewJellyfin) {
                if (!itemId) {
                    continue;
                }
                try {
                    // params: userId, itemId
                    playingInfo = await ApiClient.getItem(ApiClient.getCurrentUserId(), itemId);
                } catch (err) {
                    showDebugInfo(`获取播放信息失败: ${err.message}`);
                }
            } else {
                const sessionInfo = await ApiClient.getSessions({
                    userId: ApiClient.getCurrentUserId(),
                    deviceId: ApiClient.deviceId(),
                });
                // v2：PR #38 里那处空值保护——Session 分支下 sessionInfo 可能是空的
                if (!sessionInfo || !sessionInfo[0] || !sessionInfo[0].NowPlayingItem) {
                    await new Promise((resolve) => setTimeout(resolve, 150));
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
                'Accept-Encoding': 'gzip,br',
                Accept: 'application/json',
                'User-Agent': navigator.userAgent,
            },
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
            // v2：御坂网络把 @HELP/@QLHC/@SXDM 之类的指令藏在搜索关键词里，直接拦截
            if (animeName.trim().startsWith('@')) {
                showDebugInfo('搜索关键词不能以 @ 开头（可能是服务端指令）');
                return null;
            }
        }
        const _episode_key_offset = _episode_key + '_offset';
        if (window.ede.curEpOffsetModified) {
            window.localStorage.setItem(_episode_key_offset, window.ede.curEpOffset);
            window.ede.curEpOffsetModified = false;
        }
        // localStorage 取出来是字符串，不转成数字的话 time + curEpOffset 会变成字符串拼接
        window.ede.curEpOffset = parseFloat(window.localStorage.getItem(_episode_key_offset)) || 0;
        window.ede.curEpOffsetKey = _episode_key_offset;

        let searchUrl = getApiPrefix() + '/api/v2/search/episodes?anime=' + animeName;
        let animaInfo = await makeGetRequest(searchUrl)
            .then((response) => response.json())
            .catch((error) => {
                showDebugInfo(`查询失败: ${error.message}`);
                return null;
            });
        // v2：御坂网络的错误藏在 HTTP 200 的 body 里
        if (animaInfo && animaInfo.success === false) {
            showDebugInfo(`搜索接口返回错误：errorCode=${animaInfo.errorCode ?? '未知'} ${describeApiError(animaInfo.errorCode)}`);
            return null;
        }
        if (!animaInfo || !Array.isArray(animaInfo.animes)) {
            showDebugInfo('弹幕查询无结果');
            return null;
        }
        if (animaInfo.animes.length == 0) {
            const seriesInfo = await ApiClient.getItem(ApiClient.getCurrentUserId(), item.SeriesId || item.Id);
            animeName = seriesInfo.OriginalTitle;
            if (animeName?.length > 0) {
                searchUrl = getApiPrefix() + '/api/v2/search/episodes?anime=' + animeName;
                animaInfo = await makeGetRequest(searchUrl)
                    .then((response) => response.json())
                    .catch((error) => {
                        showDebugInfo(`查询失败: ${error.message}`);
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
        } else if (animaInfo.animes.length > 1 && is_auto) {
            // v2（上游 issue #94）：御坂网络返回的候选顺序不稳定，按标题相似度挑最像的
            const best = pickBestAnime(animaInfo.animes, animeName);
            selecAnime_id = best.index + 1;
            showDebugInfo(`按标题相似度选择: ${best.title}（${Math.round(best.score)} 分）`);
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
            const eps = (animaInfo.animes[selecAnime_id].episodes || []).slice().sort((x, y) => {
                const nx = extractEpisodeNumber(x.episodeTitle);
                const ny = extractEpisodeNumber(y.episodeTitle);
                return (nx === null ? 9999 : nx) - (ny === null ? 9999 : ny);
            });
            const targetEp = parseInt(episode, 10) || 1;
            // v2：优先按每集标题里的集号精确匹配，避免源站缺集时整体错位
            episode = matchEpisodeIndex(eps, targetEp);
        }

        if (episode + 1 > animaInfo.animes[selecAnime_id].episodes.length) {
            showDebugInfo('剧集不存在');
            return null;
        }

        const epTitlePrefix = animaInfo.animes[selecAnime_id].type === 'tvseries' ? `S${session}E${episode + 1}` : animaInfo.animes[selecAnime_id].type;
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
        const url_all = getApiPrefix() + '/api/v2/comment/' + episodeId + '?withRelated=true&chConvert=' + window.ede.chConvert;
        const url_related = getApiPrefix() + '/api/v2/related/' + episodeId;
        const url_ext = getApiPrefix() + '/api/v2/extcomment?chConvert=' + window.ede.chConvert + '&url=';
        try {
            // v2：首次失败自动重试一次（网络抖动 / 服务端限速时很常见）
            let response = null;
            let lastError = null;
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    response = await makeGetRequest(url_all);
                    break;
                } catch (err) {
                    lastError = err;
                    showDebugInfo(`获取弹幕失败(${attempt + 1}/2): ${err.message}`);
                    await new Promise((resolve) => setTimeout(resolve, 800));
                }
            }
            if (!response) {
                throw lastError || new Error('获取弹幕失败');
            }
            let data = await response.json();
            // v2：御坂网络把错误也包成 HTTP 200，必须读 body 里的 success/errorCode
            if (data && data.success === false) {
                showDebugInfo(`弹幕接口返回错误：errorCode=${data.errorCode ?? '未知'} ${describeApiError(data.errorCode)}`);
                return null;
            }
            const matchBili = /^\[bilibili\]/i;
            let hasBili = false;
            if ((danmakuFilter & 1) !== 1) {
                for (const c of data.comments) {
                    if (matchBili.test(c.p.split(',').pop())) {
                        hasBili = true;
                        break;
                    }
                }
            }
            let comments = data.comments || [];
            try{
                response = await makeGetRequest(url_related);
                // v2：御坂网络没有 /related 接口，未知路径会返回 HTML（HTTP 200），
                //     这里解析失败只提示一次，不影响主弹幕
                const relatedText = await response.text();
                try {
                    data = JSON.parse(relatedText);
                } catch (parseErr) {
                    showDebugInfo('当前 API 没有 related 接口，跳过第三方弹幕源（御坂网络在服务端合并源）');
                    data = null;
                }
                showDebugInfo('第三方弹幕源个数：' + (data?.relateds?.length || '0'));

                if (data?.relateds?.length > 0) {
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
                    await Promise.all(
                        src.map(async (s) => {
                            const response = await makeGetRequest(url_ext + encodeURIComponent(s));
                            const data = await response.json();
                            comments = comments.concat(data.comments);
                        }),
                    );
                }
            }catch (error) {
                showDebugInfo(`获取第三方弹幕失败: ${error.message}`);
            }
            showDebugInfo('弹幕下载成功: ' + comments.length);
            return comments;
        } catch (error) {
            showDebugInfo(`获取弹幕失败: ${error.message}`);
            return null;
        }
    }

    async function getCommentsByUrl(src) {
        const url_encoded = encodeURIComponent(src);
        const url = getApiPrefix() + '/api/v2/extcomment?chConvert=' + window.ede.chConvert + '&url=' + url_encoded;
        for (let i = 0; i < 2; i++) {
            try {
                const response = await makeGetRequest(url);
                const data = await response.json();
                showDebugInfo('弹幕下载成功: ' + data.comments.length);
                return data.comments;
            } catch (error) {
                showDebugInfo(`获取弹幕失败: ${error.message}`);
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
                    m: comment.textContent,
                };
                comments.push(commentData);
            }

            return comments;
        } catch (error) {
            return null;
        }
    }

    async function createDanmaku(comments) {
        if (comments && comments.length > 0) {
            // v2：缓存原始弹幕，改设置或容器被 React 摘掉时可以本地重渲染
            window.ede.lastRawComments = comments;
            window.ede.lastRawCommentsItemId = itemId;
            window.ede.lastStats = danmakuSourceStats(comments);
        }
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
            const deadline = Date.now() + 15000;
            while (!document.querySelector(mediaContainerQueryStr)?.children.length) {
                if (Date.now() > deadline) {
                    throw new Error('等待播放器容器超时');
                }
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        };

        // v2：超时后释放 loading 并排队重试，不再无限等待
        try {
            await waitForMediaContainer();
        } catch (err) {
            showDebugInfo(err.message);
            window.ede.loading = false;
            scheduleDanmakuRetry(err.message);
            return;
        }

        let _container = null;
        document.querySelectorAll(mediaContainerQueryStr).forEach((element) => {
            if (!element.classList.contains('hide')) {
                _container = element;
            }
        });
        if (!_container) {
            showDebugInfo('未找到播放器容器');
            window.ede.loading = false;
            scheduleDanmakuRetry('未找到播放器容器');
            return;
        }

        let _comments = preProcessDanmaku(comments, _container.offsetWidth, _container.offsetHeight);

        showDebugInfo(`弹幕加载成功: ${_comments.length}`);
        if (window.ede.lastBlocked > 0) {
            showDebugInfo(`屏蔽规则过滤: ${window.ede.lastBlocked} 条`);
        }
        if (window.ede.lastStats) {
            showDebugInfo(`弹幕来源统计: ${formatSourceStats(window.ede.lastStats)}`);
        }
        if (window.ede.episode_info) {
            displayDanmakuInfo(window.ede.episode_info);
        }
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
            window.ede.loading = false;
            scheduleDanmakuRetry('未找到video');
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

        window.ede.danmaku = new (getDanmakuClass())({
            container: wrapper,
            media: _media,
            comments: finalComments,
            engine: 'canvas',
            speed: window.ede.speed,
        });

        window.ede.danmakuSwitch === 1 ? window.ede.danmaku.show() : window.ede.danmaku.hide();

        // v2：重置重试计数并启动容器看门狗
        resetDanmakuRetry();
        startDanmakuWatchdog();

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
                const sleep = new Promise((resolve) => setTimeout(resolve, 3000));
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
            // v2：新版 React 客户端没有 div.skinHeader，找得到就挂上去，找不到就挂到 body，避免整条链路报错
            const infoHeader = document.querySelector('div.skinHeader') || document.querySelector('.skinHeader') || document.body;
            infoHeader.appendChild(infoContainer);
        }
        const statsText = window.ede.lastStats ? ` | ${formatSourceStats(window.ede.lastStats)}` : '';
        infoContainer.innerText = `弹幕匹配信息：${info.animeTitle} - ${info.episodeTitle}${statsText}`;
        // v2（上游 issue #98）：匹配信息不再永久挡在左上角，N 秒后自动淡出，0 表示常显
        if (infoContainer._hideTimer) {
            clearTimeout(infoContainer._hideTimer);
        }
        infoContainer.style.transition = 'opacity 0.8s ease';
        infoContainer.style.opacity = '1';
        const hideSeconds = window.ede.infoHideSeconds;
        if (hideSeconds > 0) {
            infoContainer._hideTimer = setTimeout(() => {
                infoContainer.style.opacity = '0';
                infoContainer._hideTimer = null;
            }, hideSeconds * 1000);
        }
    }

    function reloadDanmaku(type = 'check') {
        if (window.ede.loading) {
            // v2：loading 超过 20 秒视为卡死（旧版会一直卡住，只能刷新页面）
            if (window.ede.loadingSince && Date.now() - window.ede.loadingSince > 20000) {
                showDebugInfo('检测到弹幕加载卡死，已强制重置');
                window.ede.loading = false;
            } else {
                showDebugInfo('正在重新加载');
                return;
            }
        }
        window.ede.loading = true;
        window.ede.loadingSince = Date.now();
        if (window.ede.useXmlDanmaku === 1) {
            getItemId()
                .then((itemId) => {
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
                })
                .then((itemId) => getCommentsByPluginApi(itemId))
                .then((comments) => {
                    if (comments?.length > 0) {
                        return createDanmaku(comments)
                            .then(() => {
                                showDebugInfo('本地弹幕就位');
                            })
                            .then(() => {
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
            .then(
                (episodeId) =>
                    getComments(episodeId).then((comments) =>
                        createDanmaku(comments).then(() => {
                            showDebugInfo('弹幕就位');
                        }),
                    ),
                (msg) => {
                    if (msg && msg !== '当前播放视频未变动') {
                        showDebugInfo(msg);
                        // v2：在线搜索无结果时，用 Jellyfin 弹幕插件（后端就是御坂网络）的弹幕兜底
                        if (window.ede.xmlFallback === 1 && type !== 'search') {
                            return tryXmlDanmakuFallback();
                        }
                    }
                },
            )
            .then(() => {
                window.ede.loading = false;
                window.ede.loadingSince = 0;
                const danmakuCtr = document.getElementById('danmakuCtr');
                if (danmakuCtr && danmakuCtr.style && danmakuCtr.style.opacity !== '1') {
                    danmakuCtr.style.opacity = 1;
                }
            });
    }

    function preProcessDanmaku(all_cmts, containerWidth, containerHeight) {
        const { fontSize, fontOptions, fontFamily, speed, heightRatio, danmakuFilter, danmakuModeFilter, danmakuDensityLimit, curEpOffset } = window.ede;

        // v2：先按屏蔽规则过滤原始弹幕（关键词 / 正则 / 发送者 / 颜色）
        const shieldResult = shieldFilter(all_cmts);
        all_cmts = shieldResult.comments;
        window.ede.lastBlocked = shieldResult.blocked;

        // 来源过滤规则
        // v2：来源标签大小写不敏感——御坂网络写的是小写 [bilibili]/[gamer]，
        //     旧代码用 startsWith('[BiliBili]') 判断，指向御坂网络时过滤开关其实一直没生效
        const disableBilibili = (danmakuFilter & 1) === 1;
        const disableGamer = (danmakuFilter & 2) === 2;
        const disableDandan = (danmakuFilter & 4) === 4;
        const disableOther = (danmakuFilter & 8) === 8;

        const dandanRegex = disableDandan ? /^(?!\[)|^.{0,3}\]/ : null;
        const otherRegex = disableOther ? /^\[(?!(bilibili|gamer)).{3,}\]/i : null;

        // 模式过滤规则
        let enabledModes = new Set([1, 4, 5, 6]);
        if ((danmakuModeFilter & 1) === 1) enabledModes.delete(4); // bottom
        if ((danmakuModeFilter & 2) === 2) enabledModes.delete(5); // top
        if ((danmakuModeFilter & 4) === 4) {
            enabledModes.delete(1);
            enabledModes.delete(6);
        } // rtl & ltr

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

            // 来源过滤（v2：小写来源标签同样能匹配）
            const userLower = String(user || '').toLowerCase();
            if (
                (disableBilibili && userLower.startsWith('[bilibili]')) ||
                (disableGamer && userLower.startsWith('[gamer]')) ||
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
                text: cleanDanmakuText(comment.m),
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

        return maybeMergeSimilar(resultComments);
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
        const { speed, fontSize, fontOptions, fontFamily, heightRatio } = window.ede;

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
        const { speed, fontSize, heightRatio } = window.ede;

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
            bottom: [],
        };
        for (const d of sortedDanmaku) {
            if (segregatedDanmaku[d.mode]) {
                segregatedDanmaku[d.mode].push(d);
            }
        }

        // 处理滚动弹幕
        let rtlResults = [];
        if (segregatedDanmaku.rtl.length > 0) {
            rtlResults = filterOverlappedScrollDanmaku(segregatedDanmaku.rtl, containerWidth, containerHeight);
        }
        let ltrResults = [];
        if (segregatedDanmaku.ltr.length > 0) {
            ltrResults = filterOverlappedScrollDanmaku(segregatedDanmaku.ltr, containerWidth, containerHeight);
        }

        // 处理顶部弹幕
        let topResults = [];
        if (segregatedDanmaku.top.length > 0) {
            topResults = filterOverlappedFixedDanmaku(segregatedDanmaku.top, containerWidth, containerHeight);
        }

        // 处理底部弹幕
        let bottomResults = [];
        if (segregatedDanmaku.bottom.length > 0) {
            bottomResults = filterOverlappedFixedDanmaku(segregatedDanmaku.bottom, containerWidth, containerHeight);
        }

        return [...rtlResults, ...ltrResults, ...topResults, ...bottomResults].sort((a, b) => a.time - b.time);
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
    };

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
                // v2（上游 issue #72）：UI/监听轮询先无条件注册。
                // 旧版把这两行放在“等 itemId”之后，而等 itemId 失败时会 throw，
                // 结果是脚本加载了却没有任何按钮、控制台也不报错。
                setInterval(() => {
                    initUI();
                }, check_interval);

                setInterval(() => {
                    initListener();
                }, check_interval);

                // 新版前端不用在这里等 itemId：getEmbyItemInfo 自己会等（有超时）
                if (!isNewJellyfin) {
                    // v2：非新版前端同样不要死循环
                    let retry = 0;
                    while (retry < 50) {
                        const sessions = await ApiClient.getSessions().catch(() => null);
                        if (sessions) {
                            break;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 200));
                        retry++;
                    }
                }
            })();
        }
    });

    // 为内容区域的设置项添加样式
    function styleSettingItemForContent(item) {
        // 检查是否是控制功能卡片，如果是则跳过样式处理
        if (item.classList && item.classList.contains('controlCard')) {
            return;
        }

        item.classList.add('settingItem');

        // 调整标签和输入控件布局
        const label = item.querySelector('span, label');
        const input = item.querySelector('input, div:last-child');

        if (label && input) {
            // 标签样式
            label.classList.add('settingLabel');

            if (input.tagName === 'INPUT') {
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
                        if (inputElement.id === 'danmakuDensityLimit') {
                            const densityMap = {
                                0: '不限制',
                                1: '低',
                                2: '中',
                                3: '高',
                            };
                            return densityMap[value] || value;
                        }
                        return value;
                    };

                    // 初始化显示值
                    valueLabel.textContent = getDisplayValue(input.value || '0', input);

                    // 设置滑块样式
                    input.classList.add('styledRange');

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
                } else if (input.type === 'text' || input.type === 'number') {
                    // 文本/数值输入框样式
                    input.classList.add('styledTextInput');
                } else if (input.type === 'checkbox' || input.type === 'radio') {
                    // 复选框/单选框基础样式 - 改用CSS类
                    input.classList.add('checkbox-item-custom');
                    input.classList.add(input.type === 'radio' ? 'radio' : 'checkbox');

                    // 添加选中状态更新函数
                    const updateCheckboxStyle = () => {
                        if (input.checked) {
                            input.classList.add('checked');
                        } else {
                            input.classList.remove('checked');
                        }
                    };

                    // 绑定事件
                    input.addEventListener('change', updateCheckboxStyle);

                    // 初始化样式
                    updateCheckboxStyle();
                }
            }
        }

        // 处理复选框组 - 改为横向占满布局
        const checkboxGroup = item.querySelectorAll('input[type="checkbox"], input[type="radio"]');
        if (checkboxGroup.length > 1) {
            // 设置容器样式为列布局
            item.classList.add('setting-item-column');

            item.classList.add('checkbox-group-container');

            // 处理每个复选框的容器
            checkboxGroup.forEach((checkbox) => {
                const parent = checkbox.parentElement;
                if (parent) {
                    // 设置父容器样式
                    parent.classList.add('checkbox-item-parent');

                    // 设置复选框样式
                    checkbox.classList.add('checkbox-item-custom');
                    checkbox.classList.add(checkbox.type === 'radio' ? 'radio' : 'checkbox');

                    // 处理标签文本和右对齐
                    parent.childNodes.forEach((node) => {
                        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            const span = document.createElement('span');
                            span.textContent = node.textContent.trim();
                            span.classList.add('checkbox-item-label');
                            parent.replaceChild(span, node);
                        }
                    });

                    // 创建选中状态指示器（勾选标记或圆点）
                    const indicator = document.createElement('div');
                    indicator.className = checkbox.type === 'checkbox' ? 'check-mark' : 'radio-dot';
                    checkbox.appendChild(indicator);

                    // 更新样式函数，处理选中状态的外观变化
                    const updateStyle = () => {
                        const indicator = checkbox.querySelector('.check-mark, .radio-dot');
                        
                        if (checkbox.checked) {
                            // 选中状态样式
                            checkbox.classList.add('checked');
                            parent.classList.add('checked');
                            parent.classList.remove('unchecked');

                            // 显示指示器
                            if (indicator) {
                                indicator.classList.add('visible');
                            }

                            // 如果是单选框，更新同组中的其他单选框样式
                            if (checkbox.type === 'radio' && checkbox.name) {
                                document.querySelectorAll(`input[type="radio"][name="${checkbox.name}"]`).forEach((radio) => {
                                    if (radio !== checkbox && radio.checked === false) {
                                        const radioParent = radio.parentElement;
                                        const radioIndicator = radio.querySelector('.radio-dot');

                                        // 应用未选中样式
                                        radio.classList.remove('checked');
                                        if (radioParent) {
                                            radioParent.classList.remove('checked');
                                            radioParent.classList.add('unchecked');
                                        }

                                        // 隐藏指示器
                                        if (radioIndicator) {
                                            radioIndicator.classList.remove('visible');
                                        }
                                    }
                                });
                            }
                        } else {
                            // 未选中状态样式
                            checkbox.classList.remove('checked');
                            parent.classList.remove('checked');
                            parent.classList.add('unchecked');

                            // 隐藏指示器
                            if (indicator) {
                                indicator.classList.remove('visible');
                            }
                        }
                    };

                    // 绑定事件
                    checkbox.addEventListener('change', function (e) {
                        // Firefox兼容性：确保单选框组至少有一个保持选中状态
                        if (isFirefox() && checkbox.type === 'radio' && checkbox.name) {
                            const radioGroup = document.querySelectorAll(`input[type="radio"][name="${checkbox.name}"]`);
                            const checkedCount = Array.from(radioGroup).filter((radio) => radio.checked).length;

                            // 如果当前单选框被取消选中，且这是组中唯一选中的，则阻止取消选中
                            if (!checkbox.checked && checkedCount === 0) {
                                e.preventDefault();
                                checkbox.checked = true;
                                return;
                            }
                        }
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
                                    const checkedCount = Array.from(radioGroup).filter((radio) => radio.checked).length;

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
                                    cancelable: true,
                                });
                                checkbox.dispatchEvent(changeEvent);
                            }
                        } else {
                            checkbox.click();
                        }
                    });

                    // 确保复选框/单选框点击事件不会触发父元素的点击
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
        /* 统一滚动条样式 */
        .danmakuSidebar .danmakuSettingsContainer::-webkit-scrollbar,
        .danmakuTabsContainer::-webkit-scrollbar {
            width: 6px;
            height: 4px;
        }

        .danmakuSidebar .danmakuSettingsContainer::-webkit-scrollbar-track,
        .danmakuTabsContainer::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.1);
            border-radius: 3px;
        }

        .danmakuSidebar .danmakuSettingsContainer::-webkit-scrollbar-thumb,
        .danmakuTabsContainer::-webkit-scrollbar-thumb {
            background: rgba(0, 164, 220, 1);
            border-radius: 3px;
        }

        /* 控制卡片悬停效果 */
        .controlCard {
            position: relative;
            overflow: hidden;
        }

        .controlCard::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.05), rgba(0, 164, 219, 0.05));
            opacity: 0;
            transition: opacity 0.3s ease;
            pointer-events: none;
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
            flex: 2 !important;
        }

        /* 强制约束复选框和单选框容器宽度 */
        .danmakuSidebar{
            position: fixed;
            top: 0;
            right: 0;
            width: 450px;
            max-width: 90vw;
            height: 100vh;
            background: rgba(18, 18, 20, 0.95);
            z-index: 1000000;
            display: flex;
            flex-direction: column;
            box-shadow: -5px 0 25px rgba(0, 0, 0, 0.5);
            transform: translateX(100%);
            transition: transform 0.3s ease-in-out;
            overflow: hidden;
            box-sizing: border-box;
            border-radius: 20px 0 0 0;
        }

        .danmakuSidebarHeader {
            padding: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            min-height: 60px;
        }

        .danmakuSidebarTitle {
            color: #fff;
            margin: 0;
            font-size: 20px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .danmakuSidebarButtons {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .danmakuSidebarSaveButton {
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
        }

        .danmakuSidebarSaveButton:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 164, 220, 0.4);
        }

        .danmakuSidebarCancelButton {
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
        }

        .danmakuSidebarCancelButton:hover {
            background: rgba(255, 255, 255, 0.15);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(255, 255, 255, 0.1);
        }

        .danmakuSettingsContainer {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
        }

        .dialogOverlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.6);
            z-index: 2000000;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .inputDialog {
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
        }

        .selectDialog {
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
        }

        .dialogTitle {
            color: #fff;
            margin: 0 0 16px 0;
            font-size: 18px;
            font-weight: 600;
        }

        .dialogActions {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
        }

        #dialogCancel,
        .dialogCancelButton {
            padding: 10px 20px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.3s;
        }

        #dialogCancel:hover,
        .dialogCancelButton:hover {
            background: rgba(255, 255, 255, 0.15);
            transform: translateY(-1px);
        }

        #dialogConfirm,
        .dialogConfirmButton {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            background: rgba(0, 164, 220, 1);
            color: #fff;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.3s;
        }

        #dialogConfirm:hover,
        .dialogConfirmButton:hover {
            background: rgba(0, 164, 220, 0.8);
            transform: translateY(-1px);
        }

        .glassLayer {
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
        }

        .selectDialogList {
            flex: 1;
            overflow-y: auto;
            margin-bottom: 20px;
            max-height: 400px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.05);
            scrollbar-width: thin;
            scrollbar-color: rgba(0, 164, 220, 0.5) rgba(0, 0, 0, 0.1);
        }

        .selectDialogList::-webkit-scrollbar {
            width: 8px;
        }
        .selectDialogList::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.1);
            border-radius: 4px;
        }
        .selectDialogList::-webkit-scrollbar-thumb {
            background: rgba(0, 164, 220, 0.5);
            border-radius: 4px;
        }
        .selectDialogList::-webkit-scrollbar-thumb:hover {
            background: rgba(0, 164, 220, 0.7);
        }

        /* 选择对话框选项样式 */
        .select-dialog-item {
            padding: 12px 16px !important;
            color: #fff !important;
            cursor: pointer !important;
            transition: all 0.3s !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
            background: transparent !important;
        }
        
        .select-dialog-item.selected {
            background: rgba(0, 164, 220, 0.2) !important;
        }
        
        .select-dialog-item:hover:not(.selected) {
            background: rgba(255, 255, 255, 0.08) !important;
        }

        /* 弹幕设置相关样式 */
        .settings-html-element {
            display: flex !important;
        }
        
        .settings-flex-auto {
            flex: 1 !important;
        }
        
        .settings-flex-grow {
            flex-grow: 1 !important;
        }
        
        /* 标签页按钮样式 */
        .danmaku-tab-button {
            padding: 10px 18px !important;
            border: none !important;
            border-radius: 8px !important;
            color: white !important;
            font-size: 14px !important;
            cursor: pointer !important;
            white-space: nowrap !important;
            flex-shrink: 0 !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        
        .danmaku-tab-button.inactive {
            background: rgba(255, 255, 255, 0.08) !important;
            font-weight: 500 !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
        }
        
        .danmaku-tab-button.active {
            background: rgba(0, 164, 220, 1) !important;
            font-weight: 600 !important;
            border: 1px solid transparent !important;
        }
        
        .danmaku-tab-button:hover:not(.active) {
            background: rgba(255, 255, 255, 0.15) !important;
            border-color: rgba(255, 255, 255, 0.2) !important;
        }
        
        /* 标签页内容样式 */
        .danmaku-tab-content {
            padding: 10px 0 !important;
            display: none !important;
        }
        
        .danmaku-tab-content.active {
            display: block !important;
        }
        
        .danmaku-tab-content.controls {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 16px !important;
            margin-bottom: 20px !important;
            padding: 0 !important;
        }

        .danmakuTabsContainer {
            display: flex;
            overflow-x: auto;
            padding: 16px 20px;
            background: rgba(0, 0, 0, 0.2);
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            scrollbar-width: thin;
            scrollbar-color: rgba(0, 164, 220, 0.5) rgba(0, 0, 0, 0.1);
            margin: -16px -16px 20px -16px;
            gap: 4px;
        }

        .danmakuSwitchCard,
        .logSwitchCard,
        .searchItemCard,
        .addSourceItemCard {
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
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .danmakuSwitchCard:hover {
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.12), rgba(0, 164, 219, 0.12));
            border-color: rgba(0, 164, 220, 0.4);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0, 164, 220, 0.15);
        }

        .logSwitchCard:hover {
            background: linear-gradient(135deg, rgba(76, 175, 80, 0.12), rgba(33, 150, 243, 0.12));
            border-color: rgba(76, 175, 80, 0.4);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(76, 175, 80, 0.15);
        }
        
        .searchItemCard:hover {
            background: linear-gradient(135deg, rgba(0, 188, 212, 0.12), rgba(0, 229, 255, 0.12));
            border-color: rgba(0, 188, 212, 0.4);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0, 188, 212, 0.15);
        }

        .addSourceItemCard:hover {
            background: linear-gradient(135deg, rgba(255, 152, 0, 0.12), rgba(255, 193, 7, 0.12));
            border-color: rgba(255, 152, 0, 0.4);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(255, 152, 0, 0.15);
        }

        .customCorsProxyCard {
            display: flex;
            flex-direction: column;
            gap: 16px;
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
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .controlInfo {
            display: flex;
            align-items: center;
            flex: 1;
        }

        .controlTitle {
            font-size: 15px;
            font-weight: 600;
            color: #fff;
            margin-bottom: 2px;
        }

        .controlDescription {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.7);
        }

        .searchItemControlAction {
            padding: 6px 12px;
            background: rgba(0, 188, 212, 0.15);
            border-radius: 6px;
            color: #00BCD4;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid rgba(0, 188, 212, 0.25);
        }

        .addSourceItemControlAction {
            padding: 6px 12px;
            background: rgba(255, 152, 0, 0.15);
            border-radius: 6px;
            color: #FF9800;
            font-size: 12px;
            font-weight: 500;
            border: 1px solid rgba(255, 152, 0, 0.25);
        }

        .settingLabel {
            font-size: 14px;
            font-weight: 500;
            color: #fff;
            flex: 0 0 auto;
            margin-right: 20px;
            min-width: 120px;
            text-align: left;
            line-height: 1.4;
        }

        .styledRange {
            max-width: 200px;
            height: 6px;
            border-radius: 3px;
            background: rgba(0, 164, 220, 1);
            outline: none;
            -webkit-appearance: none;
            appearance: none;
            flex: 1;
        }

        .styledTextInput{
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
            box-sizing: border-box;
            box-shadow: 
                0 2px 8px rgba(0, 164, 220, 0.15),
                inset 0 1px 2px rgba(255, 255, 255, 0.1),
                inset 0 -1px 1px rgba(0, 0, 0, 0.05);
        }

        .styledTextInput:focus {
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.18), rgba(0, 164, 219, 0.18)) !important;
            border-color: rgba(0, 164, 220, 0.8) !important;
            box-shadow:
                0 0 0 5px rgba(0, 164, 220, 0.2),
                0 6px 25px rgba(0, 164, 220, 0.35),
                inset 0 1px 2px rgba(255, 255, 255, 0.2),
                inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
            transform: translateY(-1px) scale(1.01) !important;
        }

        .styledTextInput:blur {
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.08), rgba(0, 164, 219, 0.08)) !important;
            border: 2px solid rgba(0, 164, 220, 0.4) !important;
            box-shadow: 0 2px 8px rgba(0, 164, 220, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
            transform: translateY(0) scale(1) !important;
        }

        .styledTextInput:hover:not(:focus) {
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.12), rgba(0, 164, 219, 0.12)) !important;
            border: 2px solid rgba(0, 164, 220, 0.6) !important;
            box-shadow: 0 4px 15px rgba(0, 164, 220, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.15), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
            transform: translateY(-1px) scale(1.01) !important;
        }
            
        .styledTextInput:not(:focus):not(:hover) {
            background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08)) !important;
            border: 2px solid rgba(128, 128, 128, 0.4) !important;
            box-shadow: 0 2px 8px rgba(128, 128, 128, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
            transform: translateY(0) scale(1) !important;
        }

        .settingItem {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            margin-bottom: 12px;
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02));
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            min-height: 56px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .settingItem input[type="text"],
        .settingItem input[type="number"],
        .settingItem input:not([type="checkbox"]):not([type="radio"]):not([type="range"]) {
            flex: 1;
        }

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

        /* 单个复选框/单选框样式（非组合） */
        .checkbox-item-custom {
            width: 18px !important;
            height: 18px !important;
            cursor: pointer !important;
            position: relative !important;
            -webkit-appearance: none !important;
            appearance: none !important;
            background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08)) !important;
            border: 2px solid rgba(128, 128, 128, 0.4) !important;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
            box-shadow: 
                0 2px 8px rgba(0, 164, 220, 0.15),
                inset 0 1px 2px rgba(255, 255, 255, 0.1),
                inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
        }
        
        .checkbox-item-custom.checked {
            background: rgba(0, 164, 220, 1) !important;
            border: 2px solid rgba(0, 164, 220, 0.8) !important;
            box-shadow: 0 2px 12px rgba(0, 164, 220, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
        }
        
        .checkbox-item-custom:hover:not(.checked) {
            border: 2px solid rgba(0, 164, 220, 0.6) !important;
            background: rgba(255, 255, 255, 0.15) !important;
        }
        
        /* 复选框组合样式覆盖单个样式 */
        .checkbox-item-parent .checkbox-item-custom {
            margin-right: 0 !important;
            margin-left: 0 !important;
            order: 1 !important;
            width: 22px !important;
            height: 22px !important;
            cursor: pointer !important;
            position: relative !important;
            -webkit-appearance: none !important;
            appearance: none !important;
            background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08)) !important;
            border: 2px solid rgba(128, 128, 128, 0.4) !important;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
            flex-shrink: 0 !important;
            box-shadow: 
                0 2px 8px rgba(0, 164, 220, 0.15),
                inset 0 1px 2px rgba(255, 255, 255, 0.1),
                inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
        }
        
        .checkbox-item-parent .checkbox-item-custom.checked {
            background: rgba(0, 164, 220, 1) !important;
            border: 2px solid rgba(0, 164, 220, 0.8) !important;
            box-shadow: 0 2px 12px rgba(0, 164, 220, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
            transform: scale(1.05) !important;
        }
        
        .checkbox-item-parent .checkbox-item-custom:not(.checked) {
            background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08)) !important;
            border: 2px solid rgba(128, 128, 128, 0.4) !important;
            box-shadow: 0 2px 8px rgba(128, 128, 128, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
            transform: scale(1) !important;
        }

        /* 复选框和单选框组样式 */
        .checkbox-group-container {
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
        }
        
        .checkbox-item-parent {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            width: 100% !important;
            max-width: 100% !important;
            padding: 16px 20px !important;
            margin-bottom: 8px !important;
            border-radius: 12px !important;
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.06), rgba(0, 164, 219, 0.06)) !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            color: rgba(255, 255, 255, 0.95) !important;
            border: 2px solid rgba(0, 164, 220, 0.4) !important;
            cursor: pointer !important;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
            min-height: 44px !important;
            position: relative !important;
            overflow: hidden !important;
            box-sizing: border-box !important;
            box-shadow: 
                0 2px 8px rgba(0, 164, 220, 0.1),
                inset 0 1px 2px rgba(255, 255, 255, 0.08),
                inset 0 -1px 1px rgba(0, 0, 0, 0.03) !important;
        }
        
        .checkbox-item-parent:hover {
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.08), rgba(0, 164, 219, 0.08)) !important;
            border: 2px solid rgba(0, 164, 220, 0.4) !important;
            transform: translateY(-1px) !important;
            box-shadow: 0 4px 12px rgba(0, 164, 220, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.15) !important;
        }
        
        .checkbox-item-parent.checked {
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.15), rgba(0, 164, 219, 0.15)) !important;
            border: 2px solid rgba(0, 164, 220, 0.6) !important;
            box-shadow: 0 2px 12px rgba(0, 164, 220, 0.25), inset 0 1px 2px rgba(255, 255, 255, 0.15), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
        }
        
        .checkbox-item-parent.checked:hover {
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.25), rgba(0, 164, 219, 0.25)) !important;
            border: 2px solid rgba(0, 164, 220, 0.7) !important;
            transform: translateY(-1px) !important;
            box-shadow: 0 4px 16px rgba(0, 164, 220, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.25) !important;
        }
        
        .checkbox-item-parent.unchecked {
            background: linear-gradient(135deg, rgba(128, 128, 128, 0.06), rgba(160, 160, 160, 0.06)) !important;
            border: 2px solid rgba(128, 128, 128, 0.2) !important;
            box-shadow: 0 2px 8px rgba(128, 128, 128, 0.1), inset 0 1px 2px rgba(255, 255, 255, 0.08), inset 0 -1px 1px rgba(0, 0, 0, 0.03) !important;
        }
        
        .checkbox-item-parent.unchecked:hover {
            background: linear-gradient(135deg, rgba(0, 164, 220, 0.08), rgba(0, 164, 219, 0.08)) !important;
            border: 2px solid rgba(0, 164, 220, 0.4) !important;
            transform: translateY(-1px) !important;
            box-shadow: 0 4px 12px rgba(0, 164, 220, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.15) !important;
        }
        
        .checkbox-item-custom {
            margin-right: 0 !important;
            margin-left: 0 !important;
            order: 1 !important;
            width: 22px !important;
            height: 22px !important;
            cursor: pointer !important;
            position: relative !important;
            -webkit-appearance: none !important;
            appearance: none !important;
            background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08)) !important;
            border: 2px solid rgba(128, 128, 128, 0.4) !important;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1) !important;
            flex-shrink: 0 !important;
            box-shadow: 
                0 2px 8px rgba(0, 164, 220, 0.15),
                inset 0 1px 2px rgba(255, 255, 255, 0.1),
                inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
        }
        
        .checkbox-item-custom.checkbox {
            border-radius: 6px !important;
        }
        
        .checkbox-item-custom.radio {
            border-radius: 50% !important;
        }
        
        .checkbox-item-custom.checked {
            background: rgba(0, 164, 220, 1) !important;
            border: 2px solid rgba(0, 164, 220, 0.8) !important;
            box-shadow: 0 2px 12px rgba(0, 164, 220, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.2), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
            transform: scale(1.05) !important;
        }
        
        .checkbox-item-custom:not(.checked) {
            background: linear-gradient(135deg, rgba(128, 128, 128, 0.08), rgba(160, 160, 160, 0.08)) !important;
            border: 2px solid rgba(128, 128, 128, 0.4) !important;
            box-shadow: 0 2px 8px rgba(128, 128, 128, 0.15), inset 0 1px 2px rgba(255, 255, 255, 0.1), inset 0 -1px 1px rgba(0, 0, 0, 0.05) !important;
            transform: scale(1) !important;
        }
        
        .checkbox-item-parent:hover .checkbox-item-custom:not(.checked) {
            border: 2px solid rgba(0, 164, 220, 0.6) !important;
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.15), rgba(0, 164, 220, 0.1)) !important;
            transform: scale(1.1) !important;
        }
        
        .checkbox-item-parent:hover .checkbox-item-custom.checked {
            transform: scale(1.15) !important;
        }
        
        .checkbox-item-label {
            flex: 1 !important;
            text-align: right !important;
            order: 2 !important;
            margin-right: 12px !important;
            line-height: 1.4 !important;
            word-wrap: break-word !important;
            overflow: hidden !important;
            max-width: calc(100% - 40px) !important;
            box-sizing: border-box !important;
        }
        
        .check-mark {
            position: absolute !important;
            left: 5px !important;
            top: 1px !important;
            width: 6px !important;
            height: 10px !important;
            border: solid white !important;
            border-width: 0 2px 2px 0 !important;
            transform: rotate(45deg) scale(0) !important;
            transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55) !important;
            opacity: 0 !important;
        }
        
        .check-mark.visible {
            transform: rotate(45deg) scale(1) !important;
            opacity: 1 !important;
        }
        
        .radio-dot {
            position: absolute !important;
            left: 50% !important;
            top: 50% !important;
            width: 8px !important;
            height: 8px !important;
            background: white !important;
            border-radius: 50% !important;
            transform: translate(-50%, -50%) scale(0) !important;
            transition: transform 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55) !important;
            opacity: 0 !important;
        }
        
        .radio-dot.visible {
            transform: translate(-50%, -50%) scale(1) !important;
            opacity: 1 !important;
        }
        
        .setting-item-column {
            flex-direction: column !important;
            align-items: flex-start !important;
            padding: 20px !important;
        }

        /* 调整播放器设置菜单位置 - 距离底部5%屏幕高度，位于右侧 - 仅在视频播放界面生效 */
        .actionSheet.centeredDialog:has([data-id="aspectratio"]):has([data-id="playbackrate"]),
        .actionSheet.centeredDialog.video-player-settings-menu {
            position: fixed !important;
            bottom: 5vh !important;
            top: auto !important;
            transform: none !important;
            margin: 0 !important;
        }

        .actionSheet.centeredDialog:has([data-id="aspectratio"]):has([data-id="playbackrate"])[style*="top:"],
        .actionSheet.centeredDialog:has([data-id="aspectratio"]):has([data-id="playbackrate"])[style*="left:"],
        .actionSheet.centeredDialog.video-player-settings-menu[style*="top:"],
        .actionSheet.centeredDialog.video-player-settings-menu[style*="left:"] {
            bottom: 5vh !important;
            top: auto !important;
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
        .modernSwitch {
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

        .modernSwitch input {
            opacity: 0 !important;
            width: 0 !important;
            height: 0 !important;
            position: absolute !important;
            margin: 0 !important;
        }

        .modernSlider {
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

        .modernSlider:before {
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

        .modernSwitch input:checked + .modernSlider {
            background: rgba(0, 164, 220, 1) !important;
            border-color: transparent !important;
        }

        .modernSwitch input:checked + .modernSlider:before {
            transform: translateX(20px) !important;
            box-shadow: 0 1px 4px rgba(0, 164, 220, 0.3) !important;
        }

        .modernSlider:hover {
            box-shadow: 0 0 8px rgba(0, 164, 220, 0.2) !important;
        }

        .modernSwitch input:checked + .modernSlider:hover {
            box-shadow: 0 0 8px rgba(0, 164, 220, 0.4) !important;
        }

        /* 控制卡片样式 */
        .controlCard {
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }

        .controlCard:hover {
            transform: translateY(-2px) !important;
        }

        /* 控制项样式 */
        .controlItem,
        .controlCard {
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }

        .controlItem:hover,
        .controlCard:hover {
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

        #dialogInput {
            width: 100%;
            margin-bottom: 20px;
            transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }

        /* 自定义CORS代理和API输入框样式 */
        .custom-input-group {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            margin-bottom: 8px;
        }

        .custom-input-label {
            width: 75px;
            text-align: right;
            flex-shrink: 0;
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px;
            font-weight: 500;
        }

        .custom-input-field {
            flex-grow: 1;
            width: 100%;
            padding: 10px 12px;
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.3);
            color: white;
            font-size: 13px;
            font-family: inherit;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            outline: none;
        }

        .custom-input-field::placeholder {
            color: rgba(255, 255, 255, 0.5);
        }

        .custom-input-field:hover {
            border-color: rgba(255, 255, 255, 0.25);
            background: rgba(0, 0, 0, 0.4);
        }

        .custom-input-field:focus {
            border-color: rgba(0, 164, 220, 0.6);
            background: rgba(0, 164, 220, 0.08);
            box-shadow: 0 0 0 2px rgba(0, 164, 220, 0.15);
            transform: translateY(-1px);
        }

        
        /* 响应式设计 */
        @media (max-width: 900px) {
            .controlCard {
                flex: 1 1 calc(50% - 12px) !important;
                min-width: 260px !important;
            }
        }
        
        @media (max-width: 600px) {
            .danmakuSidebar {
                width: 95% !important;
                max-width: none !important;
            }
            
            .controlCard {
                flex: 1 1 100% !important;
                min-width: 100% !important;
            }
        }

        @media (max-width: 400px) {
            .controlCard .controlInfo {
                flex-direction: column;
                align-items: flex-start;
                text-align: left;
            }

            .custom-input-group {
                flex-direction: column;
                align-items: stretch;
                gap: 6px;
            }
            
            .custom-input-label {
                width: auto;
                text-align: left;
                font-size: 12px;
            }
            
            .custom-input-field {
                padding: 8px 10px;
                font-size: 12px;
            }
        }

    /* ===== v2：屏蔽设置 / 控制卡片 ===== */
    .settingItem.danmaku-block-item {
        flex-wrap: wrap;
        align-items: flex-start;
    }

    .danmaku-block-input {
        flex: 1 1 100%;
        width: 100%;
        margin-top: 8px;
    }

    .danmaku-block-input textarea {
        width: 100%;
        min-height: 84px;
        box-sizing: border-box;
        resize: vertical;
        padding: 8px 10px;
        font-size: 12px;
        line-height: 1.5;
        color: inherit;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        font-family: Consolas, Monaco, monospace;
    }

    .danmaku-block-input input {
        width: 100%;
        box-sizing: border-box;
    }

    .danmaku-block-enable {
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
    }

    .danmaku-block-actions,
    .danmaku-offset-buttons {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
    }

    .danmakuHint {
        display: block;
        font-size: 12px;
        opacity: 0.7;
        line-height: 1.4;
    }

    .danmaku-block-actions button,
    .danmaku-offset-buttons button,
    .danmaku-card-button {
        padding: 6px 10px;
        font-size: 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        cursor: pointer;
    }

    .danmaku-block-actions button:hover,
    .danmaku-offset-buttons button:hover,
    .danmaku-card-button:hover {
        background: rgba(255, 255, 255, 0.18);
    }

    .danmakuMisakaRow {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        width: 100%;
        margin-top: 6px;
    }

    .danmakuMisakaRow input {
        flex: 1 1 45%;
        min-width: 120px;
        padding: 6px 8px;
        font-size: 12px;
        color: inherit;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
    }

    .danmakuTextDialog {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-width: 90vw;
        width: 520px;
    }

    .danmakuTextDialog textarea {
        width: 100%;
        min-height: 180px;
        box-sizing: border-box;
        padding: 8px 10px;
        font-size: 12px;
        font-family: Consolas, Monaco, monospace;
        color: inherit;
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-radius: 8px;
    }
    `;
    document.head.appendChild(style);
})();