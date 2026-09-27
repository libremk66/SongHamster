# 路径映射详解（LXServer × Emby × SongHamster）

SongHamster 做的事本质是：**LXServer 下载音乐 → SongHamster 整理移动 → Emby 扫描入库**。
三个服务必须访问**同一个音乐目录**——而 Docker 里每个容器只能看到自己挂载的路径。这就是路径容易搞混的根源。

## 一句话核心

> 宿主机上准备**一个音乐数据目录**，把它分别挂给三个容器（挂载点不同没关系）；
> 界面里填的每个路径，都是"**该容器自己看到的路径**"。

```
宿主机（唯一真相源）
/srv/lxmusic/
   ├─ 挂给 lxserver → 容器内 /server/music      LX 下载写这里
   ├─ 挂给 Emby    → 容器内 /media/music       媒体库扫描这里
   └─ 挂给 songhamster → 容器内 /data/music        SongHamster 读/移动/洗版
```

---

## ① LXServer（官方 compose 实例）

官方 `docker-compose.yml`（用户提供）：
```yaml
version: '3'
services:
  lx-sync-server:
    image: xcq0607/lxserver:latest
    container_name: lx-sync-server
    restart: unless-stopped
    ports:
      - "9527:9527"
    volumes:
      - ./data:/server/data      # 配置/数据库/用户数据
      - ./logs:/server/logs
      - ./cache:/server/cache
      - ./music:/server/music    # ← 音乐下载落盘目录（关键）
    environment:
      - NODE_ENV=production
```

**解释**：
- 容器内固定路径：配置 `/server/data`、缓存 `/server/cache`、**音乐 `/server/music`**
- 用户在 LXServer 界面/设置里选定的"下载位置"若指向 `music`，则文件落在 `/server/music/<用户名>/...`
- 想与另外两个服务共享，**只需把宿主机同一目录挂到这里的 `/server/music`**

---

## ② Emby（compose 实例）

```yaml
services:
  emby:
    image: emby/embyserver:latest
    container_name: emby
    restart: unless-stopped
    ports:
      - "8096:8096"
    volumes:
      - ./emby-config:/config                     # Emby 配置
      - ./music:/media/music                      # ← 同一宿主机目录，挂到 /media/music
      # 其它媒体目录按需挂载
```

**解释（Emby 侧需要三步，不只是挂载）**：

1. **挂载**：compose 卷把共享目录挂进 Emby 容器（`./music:/media/music`）——这一步只是让 Emby **有权限看到**宿主机目录
2. **建媒体库**：登录 Emby 管理后台 → 添加媒体库（类型选"音乐"）→ 在"文件夹"步骤选择**该挂载点下的路径**作为媒体库文件夹
   - 推荐：媒体库文件夹指向 `歌单同步` 子目录（只索引 SongHamster 管理的歌单文件夹），例如 Emby 后台选 `/media/music/歌单同步`
   - 也可以指向整个 `/media/music`（范围更大，Emby 索引更慢）
3. **SongHamster 里的 `libraryRoot` 填什么**：填你**在 Emby 后台给该媒体库选的文件夹路径**（Emby 容器内视角，如 `/media/music/歌单同步`）——SongHamster 用它与 Emby API 返回的媒体库位置做匹配（也可以点界面"探测媒体库"自动识别并填入）

⚠️ 概念区分：
- **挂载点**（/media/music）= Emby 容器能看到共享目录的入口
- **媒体库文件夹路径**（如 /media/music/歌单同步）= Emby 里那个音乐媒体库实际索引的目录，它**位于挂载点之下**（或等于挂载点）
- SongHamster 的 `libraryRoot` 匹配的是后者（媒体库文件夹），不是简单等同"挂载路径"——挂载只是前提

---

## ③ SongHamster（本项目 compose 实例）

```yaml
services:
  songhamster:
    image: your-registry/songhamster:latest          # 替换为你的镜像
    container_name: songhamster
    restart: unless-stopped
    ports:
      - "8935:8935"
    environment:
      SONGHAMSTER_AUTH_USER: admin
      SONGHAMSTER_AUTH_PASSWORD: change-me
      SONGHAMSTER_LXSERVER_URL: http://lx-sync-server:9527
      SONGHAMSTER_LXSERVER_KEY: <lx 用户 token>
      SONGHAMSTER_EMBY_URL: http://emby:8096
      SONGHAMSTER_EMBY_KEY: <emby api key>
    volumes:
      - ./music:/data/music     # ← 同一宿主机目录，挂到 /data/music（读/移动/洗版都在这）
      - ./songhamster-data:/data    # SongHamster 配置(config.yaml)与数据库放这里
```

**解释**：
- `./music:/data/music`：SongHamster 要**读写**它（把 lxserver 落盘文件移动进歌单文件夹、校验、洗版输出）
- `./songhamster-data:/data`：私有配置/数据库，不用共享

---

## 界面填写对照表

| 界面字段 | 填什么 | 为什么 |
|---------|--------|--------|
| LX 下载目录 `downloadRoot` | **本项目容器内**的路径，指向「歌单同步」的**父目录**（简单情况是 `/data/music`，见下方「注意层级」） | SongHamster 要读写它（移动/校验/洗版） |
| Emby 媒体库根 `libraryRoot` | **Emby 容器内**的**媒体库文件夹路径**（Emby 后台给该媒体库选的路径，如 `/media/music/歌单同步`） | 与 Emby API 返回的媒体库位置匹配（可点"探测媒体库"自动识别） |
| 曲库洗版目录 | 默认 `<downloadRoot>/曲库洗版`（可改） | 独立目录，旧文件零触碰 |

> ⚠️ **两个字段填的不是同一个目录**：`libraryRoot` 指向「歌单同步」**本身**，
> `downloadRoot` 指向它的**父目录**（映射时中间那层会被去掉，见 `src/core/paths.ts` 的文件头注释）。

**注意层级**：`downloadRoot` 要指向「歌单同步」的父目录 —— SongHamster 会自动在其下创建
`歌单同步/<歌单名>/` 存放歌单文件、`曲库洗版/` 与 `.songhamster-trash/`。

**两种常见情况**：

| 情况 | `downloadRoot` 填 | 说明 |
|------|------------------|------|
| lxserver **没设**「自定义音乐目录」 | 共享目录根，如 `/data/music` | lxserver 直接把文件写到根下 |
| lxserver **设了**「自定义音乐目录」（`customMusicDir`） | **往里进一层**，如 `/data/music/user1` | lxserver 按用户分目录，多出 `<用户名>/` 这层 |

> 💡 **怎么判断该填哪层**：那一层下面必须**同时**有 `歌单同步/` 和 `.songhamster-trash/`
> —— 后者是 SongHamster 自己建的回收站（`src/core/trash.ts:29`），它出现在哪层，哪层就是答案。
>
> ⚠️ 别再往深指（填到 `.../歌单同步` 会导致嵌套 `歌单同步/歌单同步/`）。

## 数据流转示意

下面按「lxserver 设了自定义音乐目录（按用户分目录）」画 —— 这是更常见也更容易填错的情况：

```
LXServer 下载 → /server/music/user1/xxx.flac
                （宿主机 ./music/user1/xxx.flac；文件名是 lxserver 的索引名「歌名 - 歌手 - 音质 - 专辑.ext」）
                    │ SongHamster 移动（下载根 = ./music/user1 这一层）
                    ▼
        /data/music/user1/歌单同步/<歌单名>/晴天.flac（宿主机 ./music/user1/歌单同步/...）
                    │ Emby 扫描（媒体库文件夹 = /media/music/user1/歌单同步 这一层）
                    ▼
        Emby 媒体库入库 → 加入播放列表
```

对应界面里就是 **`downloadRoot` = `/data/music/user1`**、**`libraryRoot` = `/media/music/user1/歌单同步`**
（注意：前者是后者的**父目录的父目录**，中间隔着 `user1/` 和 `歌单同步/` 两层）。

> 若 lxserver **没设**自定义音乐目录，去掉上面所有 `user1/` 那层即可。

## 常见错误自查

> ⚠️ **先记住：这些错，界面上的两个检查都验不出来。**
>
> | 检查 | 实际验什么 |
> |---|---|
> | 「测试连接」（LX） | 只打一次 `GET /api/user/list`，**纯 API 连通性** |
> | 「路径自检」下载目录那行 | 只验目录**存在且可写**（写个 `.write_test` 再删） |
> | 「路径自检」媒体库那行 | 媒体库匹配（**父子双向都认**） |
>
> 所以填错路径时它们照样报绿，**要到真跑同步才暴露**：要么报
> `源文件不存在: <下载目录>/xxx.flac`，要么在错的层级下新建一套空的 `歌单同步/`。

| 症状 | 原因 | 修复 |
|------|------|------|
| 两个检查全绿，但同步报「源文件不存在」 | `downloadRoot` 少了一层（lxserver 设了自定义音乐目录） | 往里进一层到 `<用户名>/`（见「界面填写对照表 · 两种常见情况」） |
| 冒出一个新的空 `歌单同步/`，Emby 却没新歌 | 同上 —— 文件被搬到错的层级去了 | 同上；搬错的文件要手工挪回 `user1/歌单同步/` |
| 下载文件出现在 lxserver 但 SongHamster 找不到 | SongHamster 容器没挂这目录 / 挂载点路径填错 | 检查 `./music` 是否也挂给了 songhamster |
| Emby 扫不到新歌单 | 媒体库文件夹没指向共享目录（或指向了别处） | 在 Emby 后台把媒体库文件夹指向共享目录挂载点下的路径（如 `/media/music/user1/歌单同步`） |
| 路径自检报"目录不存在/不可写" | 填了容器内不存在的路径（如宿主机路径） | downloadRoot 必须填**本项目容器内**看到的路径 |
| 出现 `歌单同步/歌单同步/` | downloadRoot 指得太深（指到「歌单同步」本身了） | 回退到「歌单同步」的**父目录** |
| 本机 npm run dev（非 Docker） | 无容器隔离 | downloadRoot 填宿主机路径（如 `/srv/lxmusic/user1`）；libraryRoot 填 Emby 里该媒体库显示的位置（如 `/srv/lxmusic/user1/歌单同步`） |

## 完整 compose 参考

见仓库根目录 `docker-compose.example.yml`（三段服务拼合版）。
