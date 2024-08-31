// ==UserScript==
// @name         Jellyfin danmaku extension
// @description  Jellyfin弹幕插件
// @namespace    https://github.com/RyoLee
// @author       RyoLee
// @version      1.44
// @copyright    2022, RyoLee (https://github.com/RyoLee)
// @license      MIT; https://raw.githubusercontent.com/Izumiko/jellyfin-danmaku/jellyfin/LICENSE
// @icon         https://github.githubassets.com/pinned-octocat.svg
// @updateURL    https://cdn.jsdelivr.net/gh/Izumiko/jellyfin-danmaku@gh-pages/ede.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/Izumiko/jellyfin-danmaku@gh-pages/ede.user.js
// @grant        GM_xmlhttpRequest
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
    const isInTampermonkey = !(typeof GM_xmlhttpRequest === 'undefined');
    const corsProxy = 'https://ddplay-api.930524.xyz/cors/';
    const apiPrefix = isInTampermonkey ? 'https://api.dandanplay.net' : corsProxy + 'https://api.dandanplay.net';
    // const apiPrefix = 'https://api.930524.xyz';
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
    const uiQueryStr = '.osdTimeText';
    const mediaContainerQueryStr = "div[data-type='video-osd']";
    const mediaQueryStr = 'video';

    const displayButtonOpts = {
        title: '弹幕开关',
        id: 'displayDanmaku',
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

    const sourceButtonOpts = {
        title: '增加弹幕源',
        id: 'addDanmakuSource',
        class: source_icon,
        onclick: () => {
            showDebugInfo('手动增加弹幕源');
            let source = prompt('请输入弹幕源地址:');
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
        },
    };

    const logButtonOpts = {
        title: '日志开关',
        id: 'displayLog',
        onclick: () => {
            if (window.ede.loading) {
                showDebugInfo('正在加载,请稍后再试');
                return;
            }
            window.ede.logSwitch = (window.ede.logSwitch + 1) % 2;
            window.localStorage.setItem('logSwitch', window.ede.logSwitch);
            document.querySelector('#displayLog').children[0].className = spanClass + log_icons[window.ede.logSwitch];
            let logSpan = document.querySelector('#debugInfo');
            if (logSpan) {
                window.ede.logSwitch == 1 ? (logSpan.style.display = 'block') && showDebugInfo('开启日志显示') : (logSpan.style.display = 'none');
            }
        }
    };

    const settingButtonOpts = {
        title: '弹幕设置',
        id: 'danmakuSettings',
        class: settings_icon,
        onclick: () => {
            if (document.getElementById('danmakuModal')) {
                return;
            }
            const modal = document.createElement('div');
            modal.id = 'danmakuModal';
            modal.className = 'dialogContainer';
            modal.innerHTML = `
                <div class="dialog" style="padding: 20px; border-radius: .3em; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);">
                    <div style="display: flex; flex-direction: column; gap: 5px;">
                        <div style="display: flex;">
                            <span id="lbopacity" style="flex: auto;">透明度:</span>
                            <input style="width: 50%;" type="range" id="opacity" min="0" max="1" step="0.1" value="${window.ede.opacity || 0.7}" />
                        </div>
                        <div style="display: flex;">
                            <span id="lbspeed" style="flex: auto;">弹幕速度:</span>
                            <input style="width: 50%;" type="range" id="speed" min="20" max="600" step="10" value="${window.ede.speed || 200}" />
                        </div>
                        <div style="display: flex;">
                            <span id="lbfontSize" style="flex: auto;">字体大小:</span>
                            <input style="width: 50%;" type="range" id="fontSize" min="8" max="80" step="1" value="${window.ede.fontSize || 18}" />
                        </div>
                        <div style="display: flex;">
                            <span id="lbheightRatio" style="flex: auto;">高度比例:</span>
                            <input style="width: 50%;" type="range" id="heightRatio" min="0" max="1" step="0.05" value="${window.ede.heightRatio || 0.9}" />
                        </div>
                        <div style="display: flex;">
                            <span id="lbdanmakuDensityLimit" style="flex: auto;">密度限制等级:</span>
                            <input style="width: 50%;" type="range" id="danmakuDensityLimit"  min="0" max="3" step="1" value="${window.ede.danmakuDensityLimit}" />
                        </div>
                        <div style="display: flex;">
                            <label style="flex: auto;">弹幕过滤:</label>
                            <div><input type="checkbox" id="filterBilibili" name="danmakuFilter" value="1" ${((window.ede.danmakuFilter & 1) === 1) ? 'checked' : ''} />
                                <label for="filterBilibili">B站</label></div>
                            <div><input type="checkbox" id="filterGamer" name="danmakuFilter" value="2" ${((window.ede.danmakuFilter & 2) === 2) ? 'checked' : ''} />
                                <label for="filterGamer">巴哈</label></div>
                            <div><input type="checkbox" id="filterDanDanPlay" name="danmakuFilter" value="4" ${((window.ede.danmakuFilter & 4) === 4) ? 'checked' : ''} />
                                <label for="filterDanDanPlay">弹弹</label></div>
                            <div><input type="checkbox" id="filterOthers" name="danmakuFilter" value="8" ${((window.ede.danmakuFilter & 8) === 8) ? 'checked' : ''} />
                                <label for="filterOthers">其他</label></div>
                        </div>
                        <div style="display: flex;">
                            <label style="flex: auto;">弹幕类型过滤:</label>
                            <div><input type="checkbox" id="filterBottom" name="danmakuModeFilter" value="1" ${((window.ede.danmakuModeFilter & 1) === 1) ? 'checked' : ''} />
                                <label for="filterBottom">底部</label></div>
                            <div><input type="checkbox" id="filterTop" name="danmakuModeFilter" value="2" ${((window.ede.danmakuModeFilter & 2) === 2) ? 'checked' : ''} />
                                <label for="filterTop">顶部</label></div>
                            <div><input type="checkbox" id="filterRoll" name="danmakuModeFilter" value="4" ${((window.ede.danmakuModeFilter & 4) === 4) ? 'checked' : ''} />
                                <label for="filterRoll">滚动</label></div>
                        </div>
                        <div style="display: flex;">
                            <label style="flex: auto;">简繁转换:</label>
                            <div><input type="radio" id="chConvert0" name="chConvert" value="0" ${(window.ede.chConvert === 0) ? 'checked' : ''}>
                                <label for="chConvert0">不转换</label></div>
                            <div><input type="radio" id="chConvert1" name="chConvert" value="1" ${(window.ede.chConvert === 1) ? 'checked' : ''}>
                                <label for="chConvert1">简体</label></div>
                            <div><input type="radio" id="chConvert2" name="chConvert" value="2" ${(window.ede.chConvert === 2) ? 'checked' : ''}>
                                <label for="chConvert2">繁体</label></div>
                        </div>
                        <div style="display: flex;">
                            <label style="flex: auto;">使用本地xml弹幕:</label>
                            <div><input type="radio" id="enableXmlDanmaku" name="useXmlDanmaku" value="1" ${(window.ede.useXmlDanmaku === 1) ? 'checked' : ''}>
                                <label for="chConvert0">是</label></div>
                            <div><input type="radio" id="disableXmlDanmaku" name="useXmlDanmaku" value="0" ${(window.ede.useXmlDanmaku === 0) ? 'checked' : ''}>
                                <label for="chConvert1">否</label></div>
                        </div>
                        <div style="display: flex;">
                            <label style="flex: auto;">当前弹幕偏移时间:</label>
                            <div><input style="flex-grow: 1;" id="danmakuOffsetTime" placeholder="秒" value="${window.ede.curEpOffset || 0}" /></div>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 10px;">
                        <button id="saveSettings" class="raised button-submit block btnSave formDialogFooterItem emby-button">保存设置</button>
                        <button id="cancelSettings" class="raised button-cancel block btnCancel formDialogFooterItem emby-button">取消</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);

            function showCurrentVal(id, ticks) {
                const val = document.getElementById(id).value;
                const span = document.getElementById('lb' + id);
                const prefix = span.innerText.split(':')[0];
                if (ticks) {
                    span.innerText = prefix + ': ' + ticks[val];
                } else {
                    span.innerText = prefix + ': ' + val;
                }
            }

            showCurrentVal('opacity');
            showCurrentVal('speed');
            showCurrentVal('fontSize');
            showCurrentVal('heightRatio');
            showCurrentVal('danmakuDensityLimit', ['无', '低', '中', '高']);

            const closeModal = () => {
                document.body.removeChild(modal);
            };

            document.getElementById('saveSettings').onclick = () => {
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
                    reloadDanmaku('reload');
                    closeModal();
                } catch (e) {
                    alert(`Invalid input: ${e.message}`);
                }
            };
            document.getElementById('cancelSettings').onclick = closeModal;

            document.getElementById('opacity').oninput = () => showCurrentVal('opacity');
            document.getElementById('speed').oninput = () => showCurrentVal('speed');
            document.getElementById('fontSize').oninput = () => showCurrentVal('fontSize');
            document.getElementById('heightRatio').oninput = () => showCurrentVal('heightRatio');
            document.getElementById('danmakuDensityLimit').oninput = () => showCurrentVal('danmakuDensityLimit', ['无', '低', '中', '高']);
        }
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
    !function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t="undefined"!=typeof globalThis?globalThis:t||self).Danmaku=e()}(this,(function(){"use strict";var t=function(){if("undefined"==typeof document)return"transform";for(var t=["oTransform","msTransform","mozTransform","webkitTransform","transform"],e=document.createElement("div").style,i=0;i<t.length;i++)if(t[i]in e)return t[i];return"transform"}();function e(t){var e=document.createElement("div");if(e.style.cssText="position:absolute;","function"==typeof t.render){var i=t.render();if(i instanceof HTMLElement)return e.appendChild(i),e}if(e.textContent=t.text,t.style)for(var n in t.style)e.style[n]=t.style[n];return e}var i={name:"dom",init:function(){var t=document.createElement("div");return t.style.cssText="overflow:hidden;white-space:nowrap;transform:translateZ(0);",t},clear:function(t){for(var e=t.lastChild;e;)t.removeChild(e),e=t.lastChild},resize:function(t,e,i){t.style.width=e+"px",t.style.height=i+"px"},framing:function(){},setup:function(t,i){var n=document.createDocumentFragment(),s=0,r=null;for(s=0;s<i.length;s++)(r=i[s]).node=r.node||e(r),n.appendChild(r.node);for(i.length&&t.appendChild(n),s=0;s<i.length;s++)(r=i[s]).width=r.width||r.node.offsetWidth,r.height=r.height||r.node.offsetHeight},render:function(e,i){i.node.style[t]="translate("+i.x+"px,"+i.y+"px)"},remove:function(t,e){t.removeChild(e.node),this.media||(e.node=null)}},n="undefined"!=typeof window&&window.devicePixelRatio||1,s=Object.create(null);function r(t,e){if("function"==typeof t.render){var i=t.render();if(i instanceof HTMLCanvasElement)return t.width=i.width,t.height=i.height,i}var r=document.createElement("canvas"),h=r.getContext("2d"),o=t.style||{};o.font=o.font||"10px sans-serif",o.textBaseline=o.textBaseline||"bottom";var a=1*o.lineWidth;for(var d in a=a>0&&a!==1/0?Math.ceil(a):1*!!o.strokeStyle,h.font=o.font,t.width=t.width||Math.max(1,Math.ceil(h.measureText(t.text).width)+2*a),t.height=t.height||Math.ceil(function(t,e){if(s[t])return s[t];var i=12,n=t.match(/(\d+(?:\.\d+)?)(px|%|em|rem)(?:\s*\/\s*(\d+(?:\.\d+)?)(px|%|em|rem)?)?/);if(n){var r=1*n[1]||10,h=n[2],o=1*n[3]||1.2,a=n[4];"%"===h&&(r*=e.container/100),"em"===h&&(r*=e.container),"rem"===h&&(r*=e.root),"px"===a&&(i=o),"%"===a&&(i=r*o/100),"em"===a&&(i=r*o),"rem"===a&&(i=e.root*o),void 0===a&&(i=r*o)}return s[t]=i,i}(o.font,e))+2*a,r.width=t.width*n,r.height=t.height*n,h.scale(n,n),o)h[d]=o[d];var u=0;switch(o.textBaseline){case"top":case"hanging":u=a;break;case"middle":u=t.height>>1;break;default:u=t.height-a}return o.strokeStyle&&h.strokeText(t.text,a,u),h.fillText(t.text,a,u),r}function h(t){return 1*window.getComputedStyle(t,null).getPropertyValue("font-size").match(/(.+)px/)[1]}var o={name:"canvas",init:function(t){var e=document.createElement("canvas");return e.context=e.getContext("2d"),e._fontSize={root:h(document.getElementsByTagName("html")[0]),container:h(t)},e},clear:function(t,e){t.context.clearRect(0,0,t.width,t.height);for(var i=0;i<e.length;i++)e[i].canvas=null},resize:function(t,e,i){t.width=e*n,t.height=i*n,t.style.width=e+"px",t.style.height=i+"px"},framing:function(t){t.context.clearRect(0,0,t.width,t.height)},setup:function(t,e){for(var i=0;i<e.length;i++){var n=e[i];n.canvas=r(n,t._fontSize)}},render:function(t,e){t.context.drawImage(e.canvas,e.x*n,e.y*n)},remove:function(t,e){e.canvas=null}};function a(t){var e=this,i=this.media?this.media.currentTime:Date.now()/1e3,n=this.media?this.media.playbackRate:1;function s(t,s){if("top"===s.mode||"bottom"===s.mode)return i-t.time<e._.duration;var r=(e._.width+t.width)*(i-t.time)*n/e._.duration;if(t.width>r)return!0;var h=e._.duration+t.time-i,o=e._.width+s.width,a=e.media?s.time:s._utc,d=o*(i-a)*n/e._.duration,u=e._.width-d;return h>e._.duration*u/(e._.width+s.width)}for(var r=this._.space[t.mode],h=0,o=0,a=1;a<r.length;a++){var d=r[a],u=t.height;if("top"!==t.mode&&"bottom"!==t.mode||(u+=d.height),d.range-d.height-r[h].range>=u){o=a;break}s(d,t)&&(h=a)}var m=r[h].range,c={range:m+t.height,time:this.media?t.time:t._utc,width:t.width,height:t.height};return r.splice(h+1,o-h-1,c),"bottom"===t.mode?this._.height-t.height-m%this._.height:m%(this._.height-t.height)}var d="undefined"!=typeof window&&(window.requestAnimationFrame||window.mozRequestAnimationFrame||window.webkitRequestAnimationFrame)||function(t){return setTimeout(t,50/3)},u="undefined"!=typeof window&&(window.cancelAnimationFrame||window.mozCancelAnimationFrame||window.webkitCancelAnimationFrame)||clearTimeout;function m(t,e,i){for(var n=0,s=0,r=t.length;s<r-1;)i>=t[n=s+r>>1][e]?s=n:r=n;return t[s]&&i<t[s][e]?s:r}function c(t){return/^(ltr|top|bottom)$/i.test(t)?t.toLowerCase():"rtl"}function l(){var t=9007199254740991;return[{range:0,time:-t,width:t,height:0},{range:t,time:t,width:0,height:0}]}function f(t){t.ltr=l(),t.rtl=l(),t.top=l(),t.bottom=l()}function p(){if(!this._.visible||!this._.paused)return this;if(this._.paused=!1,this.media)for(var t=0;t<this._.runningList.length;t++){var e=this._.runningList[t];e._utc=Date.now()/1e3-(this.media.currentTime-e.time)}var i=this,n=function(t,e,i,n){return function(){t(this._.stage);var s=Date.now()/1e3,r=this.media?this.media.currentTime:s,h=this.media?this.media.playbackRate:1,o=null,d=0,u=0;for(u=this._.runningList.length-1;u>=0;u--)o=this._.runningList[u],r-(d=this.media?o.time:o._utc)>this._.duration&&(n(this._.stage,o),this._.runningList.splice(u,1));for(var m=[];this._.position<this.comments.length&&(o=this.comments[this._.position],!((d=this.media?o.time:o._utc)>=r));)r-d>this._.duration||(this.media&&(o._utc=s-(this.media.currentTime-o.time)),m.push(o)),++this._.position;for(e(this._.stage,m),u=0;u<m.length;u++)(o=m[u]).y=a.call(this,o),this._.runningList.push(o);for(u=0;u<this._.runningList.length;u++){o=this._.runningList[u];var c=(this._.width+o.width)*(s-o._utc)*h/this._.duration;"ltr"===o.mode&&(o.x=c-o.width+.5|0),"rtl"===o.mode&&(o.x=this._.width-c+.5|0),"top"!==o.mode&&"bottom"!==o.mode||(o.x=this._.width-o.width>>1),i(this._.stage,o)}}}(this._.engine.framing.bind(this),this._.engine.setup.bind(this),this._.engine.render.bind(this),this._.engine.remove.bind(this));return this._.requestID=d((function t(){n.call(i),i._.requestID=d(t)})),this}function g(){return!this._.visible||this._.paused||(this._.paused=!0,u(this._.requestID),this._.requestID=0),this}function _(){if(!this.media)return this;this.clear(),f(this._.space);var t=m(this.comments,"time",this.media.currentTime);return this._.position=Math.max(0,t-1),this}function v(t){t.play=p.bind(this),t.pause=g.bind(this),t.seeking=_.bind(this),this.media.addEventListener("play",t.play),this.media.addEventListener("pause",t.pause),this.media.addEventListener("playing",t.play),this.media.addEventListener("waiting",t.pause),this.media.addEventListener("seeking",t.seeking)}function w(t){this.media.removeEventListener("play",t.play),this.media.removeEventListener("pause",t.pause),this.media.removeEventListener("playing",t.play),this.media.removeEventListener("waiting",t.pause),this.media.removeEventListener("seeking",t.seeking),t.play=null,t.pause=null,t.seeking=null}function y(t){this._={},this.container=t.container||document.createElement("div"),this.media=t.media,this._.visible=!0,this.engine=(t.engine||"DOM").toLowerCase(),this._.engine="canvas"===this.engine?o:i,this._.requestID=0,this._.speed=Math.max(0,t.speed)||144,this._.duration=4,this.comments=t.comments||[],this.comments.sort((function(t,e){return t.time-e.time}));for(var e=0;e<this.comments.length;e++)this.comments[e].mode=c(this.comments[e].mode);return this._.runningList=[],this._.position=0,this._.paused=!0,this.media&&(this._.listener={},v.call(this,this._.listener)),this._.stage=this._.engine.init(this.container),this._.stage.style.cssText+="position:relative;pointer-events:none;",this.resize(),this.container.appendChild(this._.stage),this._.space={},f(this._.space),this.media&&this.media.paused||(_.call(this),p.call(this)),this}function x(){if(!this.container)return this;for(var t in g.call(this),this.clear(),this.container.removeChild(this._.stage),this.media&&w.call(this,this._.listener),this)Object.prototype.hasOwnProperty.call(this,t)&&(this[t]=null);return this}var b=["mode","time","text","render","style"];function L(t){if(!t||"[object Object]"!==Object.prototype.toString.call(t))return this;for(var e={},i=0;i<b.length;i++)void 0!==t[b[i]]&&(e[b[i]]=t[b[i]]);if(e.text=(e.text||"").toString(),e.mode=c(e.mode),e._utc=Date.now()/1e3,this.media){var n=0;void 0===e.time?(e.time=this.media.currentTime,n=this._.position):(n=m(this.comments,"time",e.time))<this._.position&&(this._.position+=1),this.comments.splice(n,0,e)}else this.comments.push(e);return this}function T(){return this._.visible?this:(this._.visible=!0,this.media&&this.media.paused||(_.call(this),p.call(this)),this)}function E(){return this._.visible?(g.call(this),this.clear(),this._.visible=!1,this):this}function k(){return this._.engine.clear(this._.stage,this._.runningList),this._.runningList=[],this}function C(){return this._.width=this.container.offsetWidth,this._.height=this.container.offsetHeight,this._.engine.resize(this._.stage,this._.width,this._.height),this._.duration=this._.width/this._.speed,this}var D={get:function(){return this._.speed},set:function(t){return"number"!=typeof t||isNaN(t)||!isFinite(t)||t<=0?this._.speed:(this._.speed=t,this._.width&&(this._.duration=this._.width/t),t)}};function z(t){t&&y.call(this,t)}return z.prototype.destroy=function(){return x.call(this)},z.prototype.emit=function(t){return L.call(this,t)},z.prototype.show=function(){return T.call(this)},z.prototype.hide=function(){return E.call(this)},z.prototype.clear=function(){return k.call(this)},z.prototype.resize=function(){return C.call(this)},Object.defineProperty(z.prototype,"speed",D),z}));
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
            // 使用Jellyfin弹幕插件提供的xml弹幕替代本脚本在线搜索的弹幕
            const useXmlDanmaku = window.localStorage.getItem('useXmlDanmaku');
            this.useXmlDanmaku = useXmlDanmaku ? parseInt(useXmlDanmaku) : 0;
            // 当前剧集弹幕偏移时间
            this.curEpOffset = 0;
            this.curEpOffsetModified = false;

            this.danmaku = null;
            this.episode_info = null;
            this.obResize = null;
            this.obMutation = null;
            this.loading = false;
        }
    }

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
        // 手动增加弹幕源
        menubar.appendChild(createButton(sourceButtonOpts));
        // 弹幕设置
        menubar.appendChild(createButton(settingButtonOpts));
        // 日志开关
        logButtonOpts.class = log_icons[window.ede.logSwitch];
        menubar.appendChild(createButton(logButtonOpts));
        // 发送弹幕
        menubar.appendChild(createButton(sendDanmakuOpts));

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
                            font: `${window.ede.fontSize}px sans-serif`,
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
        showDebugInfo('获取Item信息成功: ' + (playingInfo.SeriesName || playingInfo.Name));
        return playingInfo;
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
            });
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
            if (animeName == null || animeName == '') {
                return null;
            }
        }
        const _episode_key_offset = _episode_key + '_offset';
        if (window.ede.curEpOffsetModified) {
            window.localStorage.setItem(_episode_key_offset, window.ede.curEpOffset);
        }
        window.ede.curEpOffset = window.localStorage.getItem(_episode_key_offset) || 0;

        let searchUrl = apiPrefix + '/api/v2/search/episodes?anime=' + animeName + '&withRelated=true';
        let animaInfo = await makeGetRequest(searchUrl)
            .then((response) => isInTampermonkey ? JSON.parse(response) : response.json())
            .catch((error) => {
                showDebugInfo('查询失败:', error);
                return null;
            });
        if (animaInfo.animes.length == 0) {
            const seriesInfo = await ApiClient.getItem(ApiClient.getCurrentUserId(), item.SeriesId || item.Id);
            animeName = seriesInfo.OriginalTitle;
            if (animeName.length > 0) {
                searchUrl = apiPrefix + '/api/v2/search/episodes?anime=' + animeName + '&withRelated=true';
                animaInfo = await makeGetRequest(searchUrl)
                    .then((response) => isInTampermonkey ? JSON.parse(response) : response.json())
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
            selecAnime_id = prompt('选择节目:\n' + anime_lists_str, selecAnime_id);
            selecAnime_id = parseInt(selecAnime_id) - 1;
            window.localStorage.setItem(_id_key, animaInfo.animes[selecAnime_id].animeId);
            window.localStorage.setItem(_name_key, animaInfo.animes[selecAnime_id].animeTitle);
            let episode_lists_str = ep2string(animaInfo.animes[selecAnime_id].episodes);
            episode = prompt('选择剧集:\n' + episode_lists_str, parseInt(episode) || 1);
            if (episode == null || episode == '') {
                return null;
            }
            episode = parseInt(episode) - 1;
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
        const url_ext = apiPrefix + '/api/v2/extcomment?url=';
        try {
            let response = await makeGetRequest(url_all);
            let data = isInTampermonkey ? JSON.parse(response) : await response.json();
            const nonDandan = /^.{3,}\]/; // 匹配非弹弹play弹幕
            let hasRelated = false;
            for (const c of data.comments) {
                if (nonDandan.test(c.p.split(',').pop())) {
                    hasRelated = true;
                    break;
                }
            }
            if (hasRelated) { // 实际包含第三方弹幕
                showDebugInfo('弹幕下载成功: ' + data.comments.length);
                return data.comments;
            } else {
                showDebugInfo('缺少第三方弹幕，尝试获取');
            }
            let comments = data.comments;
            response = await makeGetRequest(url_related);
            data = isInTampermonkey ? JSON.parse(response) : await response.json();
            showDebugInfo('第三方弹幕源个数：' + data.relateds.length);

            if (data.relateds.length > 0) {
                // 根据设置过滤弹幕源
                let src = [];
                for (const s of data.relateds) {
                    if ((danmakuFilter & 1) !== 1 && s.url.includes('bilibili')) {
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
                    const data = isInTampermonkey ? JSON.parse(response) : await response.json();
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
        const url = apiPrefix + '/api/v2/extcomment?url=' + url_encoded;
        for (let i = 0; i < 2; i++) {
            try {
                const response = await makeGetRequest(url);
                const data = isInTampermonkey ? JSON.parse(response) : await response.json();
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
        const path = window.location.pathname.replace(/\/web\//, '/api/danmu/');
        const url = window.location.origin + path + jellyfinItemId + '/raw';
        const response = await makeGetRequest(url);
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

        let _comments = danmakuFilter(danmakuParser(comments));
        showDebugInfo(`弹幕加载成功: ${_comments.length}`);
        showDebugInfo(`弹幕透明度：${window.ede.opacity}`);
        showDebugInfo(`弹幕速度：${window.ede.speed}`);
        showDebugInfo(`弹幕高度比例：${window.ede.heightRatio}`);
        showDebugInfo(`弹幕来源过滤：${window.ede.danmakuFilter}`);
        showDebugInfo(`弹幕模式过滤：${window.ede.danmakuModeFilter}`);
        showDebugInfo(`弹幕字号：${window.ede.fontSize}`);
        showDebugInfo(`屏幕分辨率：${window.screen.width}x${window.screen.height}`);
        if (window.ede.curEpOffset !== 0) showDebugInfo(`当前弹幕偏移：${window.ede.curEpOffset} 秒`);

        const waitForMediaContainer = async () => {
            while (!document.querySelector(mediaContainerQueryStr)) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        };

        await waitForMediaContainer();

        let _container = null;
        const reactRoot = document.getElementById('reactRoot');
        document.querySelectorAll(mediaContainerQueryStr).forEach((element) => {
            if (!element.classList.contains('hide')) {
                _container = element;
            }
        });

        if (!_container) {
            showDebugInfo('未找到播放器');
            return;
        }

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

        window.ede.danmaku = new Danmaku({
            container: wrapper,
            media: _media,
            comments: _comments,
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

    async function reloadDanmaku(type = 'check') {
        if (window.ede.loading) {
            showDebugInfo('正在重新加载');
            return;
        }
        window.ede.loading = true;
        if (window.ede.useXmlDanmaku === 1) {
            const comments = await getItemId().then((itemId) => {
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
            }).then((itemId) => getCommentsByPluginApi(itemId));
            
            if (comments.length > 0) {
                createDanmaku(comments).then(() => {
                    showDebugInfo('本地弹幕就位');
                }).then(() => {
                    window.ede.loading = false;
                    const danmakuCtr = document.getElementById('danmakuCtr');
                    if (danmakuCtr && danmakuCtr.style && danmakuCtr.style.opacity !== '1') {
                        danmakuCtr.style.opacity = 1;
                    }
                });
                return;
            }

            showDebugInfo('本地弹幕加载失败，尝试在线加载');
        }
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
        const level = window.ede.danmakuDensityLimit;
        if (level === 0) {
            return comments;
        }

        let _container = null;
        document.querySelectorAll(mediaContainerQueryStr).forEach((element) => {
            if (!element.classList.contains('hide')) {
                _container = element;
            }
        });

        const containerWidth = _container.offsetWidth;
        const containerHeight = _container.offsetHeight * window.ede.heightRatio - 18;
        const duration = Math.ceil(containerWidth / window.ede.speed);
        const lines = Math.floor(containerHeight / window.ede.fontSize) - 1;

        const limit = (9 - level * 2) * lines;
        const verticalLimit = lines - 1 > 0 ? lines - 1 : 1;
        const resultComments = [];

        const timeBuckets = {};
        const verticalTimeBuckets = {};

        comments.forEach(comment => {
            const timeIndex = Math.ceil(comment.time / duration);

            if (!timeBuckets[timeIndex]) {
                timeBuckets[timeIndex] = 0;
            }
            if (!verticalTimeBuckets[timeIndex]) {
                verticalTimeBuckets[timeIndex] = 0;
            }

            if (comment.mode === 'top' || comment.mode === 'bottom') {
                if (verticalTimeBuckets[timeIndex] < verticalLimit) {
                    verticalTimeBuckets[timeIndex]++;
                    resultComments.push(comment);
                }
            } else {
                if (timeBuckets[timeIndex] < limit) {
                    timeBuckets[timeIndex]++;
                    resultComments.push(comment);
                }
            }
        });

        return resultComments;
    }

    function danmakuParser(all_cmts) {
        const { fontSize, danmakuFilter, danmakuModeFilter, curEpOffset } = window.ede;

        const disableBilibili = (danmakuFilter & 1) === 1;
        const disableGamer = (danmakuFilter & 2) === 2;
        const disableDandan = (danmakuFilter & 4) === 4;
        const disableOther = (danmakuFilter & 8) === 8;

        let filterule = '';
        if (disableDandan) { filterule += '^(?!\\[)|\^.{0,3}\\]'; }
        if (disableBilibili) { filterule += (filterule ? '|' : '') + '\^\\[BiliBili\\]'; }
        if (disableGamer) { filterule += (filterule ? '|' : '') + '\^\\[Gamer\\]'; }
        if (disableOther) { filterule += (filterule ? '|' : '') + '\^\\[\(\?\!\(BiliBili\|Gamer\)\).{3,}\\]'; }
        if (filterule === '') { filterule = '!.*'; }
        const danmakuFilteRule = new RegExp(filterule);

        // 使用Map去重
        const unique_cmts = [];
        const cmtMap = new Map();
        const removeUserRegex = /,[^,]+$/; //p: time,modeId,colorValue,user
        all_cmts.forEach((comment) => {
            const p = comment.p.replace(removeUserRegex, '');
            if (!cmtMap.has(p + comment.m)) {
                cmtMap.set(p + comment.m, true);
                unique_cmts.push(comment);
            }
        });

        let enabledMode = [1, 4, 5, 6];
        if ((danmakuModeFilter & 1) === 1) { enabledMode = enabledMode.filter((v) => v !== 4); }
        if ((danmakuModeFilter & 2) === 2) { enabledMode = enabledMode.filter((v) => v !== 5); }
        if ((danmakuModeFilter & 4) === 4) { enabledMode = enabledMode.filter((v) => v !== 6 && v !== 1); }

        return unique_cmts
            .filter((comment) => {
                const user = comment.p.split(',')[3];
                const modeId = parseInt(comment.p.split(',')[1], 10);
                return !danmakuFilteRule.test(comment.m) && enabledMode.includes(modeId);
            })
            .map((comment) => {
                const [time, modeId, colorValue] = comment.p.split(',').map((v, i) => i === 0 ? parseFloat(v) : parseInt(v, 10));
                const mode = { 1: 'rtl', 4: 'bottom', 5: 'top', 6: 'ltr' }[modeId];

                const color = colorValue.toString(16).padStart(6, '0');
                return {
                    text: comment.m,
                    mode,
                    time: time + curEpOffset,
                    style: {
                        font: `${fontSize}px sans-serif`,
                        fillStyle: `#${color}`,
                        strokeStyle: color === '000000' ? '#fff' : '#000',
                        lineWidth: 2.0,
                    },
                };
            });
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

    waitForElement('.htmlvideoplayer').then(() => {
        if (!window.ede) {
            window.ede = new EDE();

            var materialIcon = document.querySelector('.material-icons');
            var fontFamily = window.getComputedStyle(materialIcon).fontFamily;
            if (fontFamily === '"Font Awesome 6 Pro"') {
                danmaku_icons = ['fa-comment-slash', 'fa-comment'];
                log_icons = ['fa-toilet-paper-slash', 'fa-toilet-paper'];
                searchButtonOpts.class = 'fa-search';
                sourceButtonOpts.class = 'fa-square-plus';
                settingButtonOpts.class = 'fa-sliders';
                sendDanmakuOpts.class = 'fa-paper-plane';
            }

            (async () => {
                while (!(await ApiClient.getSessions())) {
                    await new Promise((resolve) => setTimeout(resolve, 200));
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
})();
