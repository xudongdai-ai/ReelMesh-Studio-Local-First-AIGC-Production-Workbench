# MiniMax H3 云显卡部署包

这个目录只负责把 MiniMax H3 的 SGLang 服务启动起来，ReelMesh Studio 桌面端负责提交任务、轮询状态和下载 MP4。这里不放账号、访问密钥或域名。

## 推荐租用规格

生产环境建议租用同一台机器上的 `4 × NVIDIA H100 80GB`，并确认四张卡之间有高速互联。预算有限时可以选择 `4 × NVIDIA A100 80GB`，速度会慢一些，但比单张卡更符合官方 BF16 多卡方案。

不建议直接租一张 24GB 或 48GB 卡跑官方 H3 BF16 服务。H3 是 33B 模型，官方 SGLang 启动示例使用 4 张 GPU；短边 768、4–15 秒的视频也应该先按这个基线规划容量。

建议同时准备：

- Linux x86_64，NVIDIA 驱动和 CUDA 与 SGLang 版本匹配；
- 至少 300GB 可用 NVMe，留出模型、缓存、日志和视频空间；
- 足够的主机内存；
- 一个公网 HTTPS 地址，反向代理到本机 `30010`，并限制访问来源；
- 防火墙只开放 HTTPS，不要把 SGLang 的内部端口直接暴露给全网。

实际价格、库存和区域需要在云厂商控制台确认。可优先比较 Hyperstack、RunPod 等提供整机多卡的服务；不要因为单卡小时价低就拆成四台机器，H3 需要同机多卡通信。

## 安装与启动

在 4 卡 GPU 机器上执行：

```bash
uv pip install --system "sglang[diffusion]" --prerelease=allow
MODEL_PATH=MiniMaxAI/MiniMax-H3 MODEL_VARIANT=fl2va PORT=30010 ./start-fl2va.sh
```

模型路径应指向 `MiniMaxAI/MiniMax-H3` 根目录，不要直接指向某个子目录。默认的 `fl2va` 服务用于文字生成视频和首帧生成视频；如果只需要文字生成视频，也可以用 `t2va` 任务模式由上层接口提交。

官方多卡基线等价于：

```bash
sglang serve \
  --model-path MiniMaxAI/MiniMax-H3 \
  --num-gpus 4 \
  --tp-size 2 \
  --ulysses-degree 2 \
  --encoder-parallel auto \
  --performance-mode speed \
  --host 0.0.0.0 \
  --port 30010 \
  --model-variant fl2va
```

这套参数对应当前 SGLang 对 4×H100 80GB 的速度基线；如果你的机器是 PCIe 拓扑且更看重显存余量，可改用 `--tp-size 4 --ulysses-degree 1`。如果需要 `ref2va` 参考图/参考视频模式，建议先单独开一套服务，使用 `30011` 端口，避免和主生产服务争抢显存：

```bash
sglang serve \
  --model-path MiniMaxAI/MiniMax-H3 \
  --num-gpus 4 \
  --ulysses-degree 4 \
  --performance-mode speed \
  --host 0.0.0.0 \
  --port 30011 \
  --model-variant ref2va
```

## 上线前检查

```bash
curl -fsS http://127.0.0.1:30010/health
curl -fsS http://127.0.0.1:30010/v1/models
```

ReelMesh Studio 需要把反向代理后的 HTTPS 地址填到“云显卡连接”，例如 `https://h3.example.com`，模型标识填 `MiniMaxAI/MiniMax-H3`。应用会使用 `/v1/videos` 创建异步任务，随后轮询任务状态并下载完成的 MP4；它不会把不存在的成片显示成成功。

首帧或参考素材模式还有一个前提：图片/视频必须能被远端 H3 服务读取。当前桌面端先以 `t2va` 为主，待云端文件上传或共享存储打通后再启用远端参考素材，避免把 Mac 本地路径误传给云服务器。

## 我可以帮你部署到哪一步

我可以继续帮你准备启动参数、反向代理、健康检查和 ReelMesh Studio 连接配置，也可以在你提供云厂商的 SSH 或控制台 API 访问方式后协助执行部署。租卡和云账号需要由你在云厂商侧完成；不要把 SSH 私钥、API 密钥或登录密码粘贴到聊天里，使用临时凭证或安全的环境变量更合适。

部署完成后只需要回到软件：`云显卡连接` → 填 HTTPS 地址 → 填模型标识 → 保存并检测连接。
