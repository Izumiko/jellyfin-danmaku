# jellyfin-danmaku

## Jellyfin弹幕插件
![image](/Simple.png)

## 安装

任选以下一种方式安装即可，**方式1-3可以持久化。**

**注：** 安装完首次使用时，确保只有当前一个客户端访问服务器，以方便根据当前用户id获取Session时能唯一定位到当前客户端设备id。（主要是由于非Jellyfin Web客户端没有默认在localstorage中存储DeviceID）

### 1. 浏览器插件(推荐)

1. [安装Tampermonkey插件](https://www.tampermonkey.net/)
2. [添加脚本](https://jellyfin-danmaku.pages.dev/ede.user.js)

### 2. 反向代理处理(推荐)

#### 2.1 Nginx
使用Nginx反向代理`Jellyfin`并在`location`块中插入:
```
proxy_set_header Accept-Encoding "";
sub_filter '</body>' '<script src="https://jellyfin-danmaku.pages.dev/ede.user.js" defer></script></body>';
sub_filter_once on;
```
- [`完整示例`](https://github.com/Izumiko/jellyfin-danmaku/issues/8)

#### 2.2 Caddy

下载Caddy二进制文件时，增加第三方模块[`sjtug/caddy2-filter`](https://github.com/sjtug/caddy2-filter)，之后，在`Caddyfile`中按如下内容修改
```
# 全局设置
{
	order filter after encode
}

# 网站设置
example.com {
	filter {
		path .*/web/index.html.*
		search_pattern </body>
		replacement "<script src=\"https://jellyfin-danmaku.pages.dev/ede.user.js\" defer></script></body>"
		content_type text/html
	}
	reverse_proxy localhost:8096 {
		header_up Accept-Encoding identity
	}
}
```

### 3. 修改服务端启动命令
[思路来源](https://github.com/Izumiko/jellyfin-danmaku/issues/20)

#### 3.1 Docker模式启动的服务端
官方镜像的Entrypoint是`/jellyfin/jellyfin`，`hotio/jellyfin`镜像的Entrypoint是`/init`，可在`docker-compose.yml`的jellyfin部分增加一行如下代码，用带sed的Entrypoint替换默认的Entrypoint。

官方镜像：
```
entrypoint: sed -i 's#</div></body>#</div><script src="https://jellyfin-danmaku.pages.dev/ede.user.js" defer></script></body>#' /jellyfin/jellyfin-web/index.html && /jellyfin/jellyfin
```

`hotio/jellyfin`镜像：
```
entrypoint: sed -i 's#</div></body>#</div><script src="https://jellyfin-danmaku.pages.dev/ede.user.js" defer></script></body>#' /usr/share/jellyfin/web/index.html && /init
```

#### 3.2 直接用包管理器安装，并使用systemd管理的服务端
部分用户使用deb包或者Arch Linux的aur包安装Jellyfin，可以修改systemd service文件来实现启动时追加js脚本。
运行`systemctl edit jellyfin.service`，进入编辑界面，然后输入如下内容：

deb包安装的版本：
```
[Service]
ExecStartPre=-/usr/bin/sed -i 's#</div></body>#</div><script src="https://jellyfin-danmaku.pages.dev/ede.user.js" defer></script></body>#' /usr/share/jellyfin/web/index.html
```

aur安装的版本：
```
[Service]
ExecStartPre=-/usr/bin/sed -i 's#</div></body>#</div><script src="https://jellyfin-danmaku.pages.dev/ede.user.js" defer></script></body>#' /usr/lib/jellyfin/jellyfin-web/index.html
```

保存后，运行`systemctl daemon-reload`生效，`systemctl restart jellyfin`重启当前服务。

### 4. 修改服务端

修改文件 `/usr/share/jellyfin/web/index.html`
*(Default)*

或 `/jellyfin/jellyfin-web/index.html`
*(Official Docker)*

**在`</body>`前添加如下标签**

```html
<script src="https://jellyfin-danmaku.pages.dev/ede.user.js" defer></script>
```

**Shell中的操作命令为**

```bash
sed -i 's#</body>#<script src="https://jellyfin-danmaku.pages.dev/ede.user.js" defer></script></body>#' /jellyfin/jellyfin-web/index.html
```
*(Official Docker)*

```bash
sed -i 's#</body>#<script src="https://jellyfin-danmaku.pages.dev/ede.user.js" defer></script></body>#' /usr/share/jellyfin/web/index.html
```
*(Default)*

该方式安装与浏览器插件安装**可同时使用不冲突**

### 5. 修改客户端

类似服务端方式,解包后修改 dashboard-ui/index.html 再重新打包即可,iOS 需要通过类似 AltStore 方式自签,请自行 Google 解决

## 界面

**请注意Readme上方截图可能与最新版存在差异,请以实际版本与说明为准**

左下方新增如下按钮,若按钮透明度与"暂停"等其他原始按钮存在差异,说明插件正在进行加载

- 弹幕开关: 切换弹幕显示/隐藏状态
- 手动匹配: 手动输入信息匹配弹幕
- 简繁转换: 在原始弹幕/简体中文/繁体中文3种模式切换
- 弹幕密度: 依据水平和垂直密度过滤,弹幕0级无限制*
- 添加弹幕源: 手动添加自定义弹幕源
- 弹幕设置:
  - 设置弹幕透明度[0,1]
  - 设置弹幕速度[0,1000]
  - 设置弹幕大小[0,30]
  - 设置弹幕区域占屏幕的高度比例[0,1]
  - 设置弹幕用户名过滤,支持选项[B.G.D.O]:
    - 分别对应:哔哩哔哩,巴哈姆特,弹弹Play,其他

 **除0级外均带有每3秒6条的垂直方向弹幕密度限制,高于该限制密度的顶部/底部弹幕将会被转为普通弹幕*

## 弹幕

弹幕来源为 [弹弹 play](https://www.dandanplay.com/) ,已开启弹幕聚合(Acfun/Bili/Tucao/Baha/5DM/iQIYI等不知名网站弹幕融合)

## 数据

匹配完成后对应关系会保存在**浏览器(或客户端)本地存储**中,后续播放(包括同季的其他集)会优先按照保存的匹配记录载入弹幕

## 常见弹幕加载错误/失败原因

1. 译名导致的异常: 如『よふかしのうた』 Emby 识别为《彻夜之歌》后因为弹弹 play 中为《夜曲》导致无法匹配
2. 存在多季/剧场版/OVA 等导致的异常: 如『OVERLORD』第四季若使用S[N]格式归档(如OVERLORD/S4E1.mkv或OVERLORD/S4/E1.mkv),可能出现匹配失败/错误等现象
3. 其他加载BUG: ~~鉴定为后端程序猿不会前端还要硬写JS~~,有BUG麻烦 [开个issue](https://github.com/Izumiko/jellyfin-danmaku/issues/new/choose) THX

**首次播放时请检查当前弹幕信息是否正确匹配,若匹配错误请尝试手动匹配**


[![Stargazers over time](https://starchart.cc/Izumiko/jellyfin-danmaku.svg)](https://starchart.cc/Izumiko/jellyfin-danmaku)
