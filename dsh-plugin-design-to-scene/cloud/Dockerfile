# 云端场景构建镜像：Node 22 + Blender 4.5 LTS + dsh-plugin-design-to-scene
#
# 构建（在插件仓库根目录）：
#   docker build -f cloud/Dockerfile -t dsh-design-to-scene:1.0.0 .
#
# 跑一次端到端（数据从本地挂进 /data）：
#   docker run --rm -v "$PWD/_work/cloud-data:/data" dsh-design-to-scene:1.0.0 \
#     node cloud/bin/scene-cli.mjs all \
#       --design /data/design-demo-b.png --legend /data/design-demo-b.legend.json \
#       --outDir /data/out --scale 100
#
# 说明：
#  - Blender 用官方 Linux 便携版（阿里云镜像下载，带 SHA 前缀校验可选）；不装 apt 版（Debian 只有 3.x）。
#  - 镜像只做「无 DSH 运行时」的离线场景构建；要把插件挂进已有 DSH 云实例，见 cloud/README-腾讯云部署.md。
#  - 纯 CPU 运行时 EEVEE 渲染可能不可用，插件会自动回退 Workbench（report.engine 会显示），GLB/脚本不受影响。
FROM node:22-bookworm-slim

ARG BLENDER_VERSION=4.5.15
ARG BLENDER_MIRROR=https://mirrors.aliyun.com/blender/release
ARG DEBIAN_FRONTEND=noninteractive

# Blender headless 运行依赖（不含输入法/桌面环境）
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates xz-utils \
        libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 \
        libgl1 libglu1-mesa libegl1 libsm6 libice6 libfontconfig1 libfreetype6 \
        libdbus-1-3 libgomp1 libsdl2-2.0-0 libtbb12 libwebp7 libopenjp2-7 \
        libpng16-16 libjpeg62-turbo libtiff6 libpcre2-8-0 \
    && rm -rf /var/lib/apt/lists/*

# Blender 官方便携版
RUN set -eux; \
    curl -fsSL --retry 3 -o /tmp/blender.tar.xz \
      "${BLENDER_MIRROR}/Blender${BLENDER_VERSION%.*}/blender-${BLENDER_VERSION}-linux-x64.tar.xz"; \
    mkdir -p /opt/blender; \
    tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1; \
    rm -f /tmp/blender.tar.xz; \
    ln -sf /opt/blender/blender /usr/local/bin/blender; \
    blender --version | head -n 2

ENV BLENDER_PATH=/opt/blender/blender
ENV NODE_ENV=production
WORKDIR /opt/dsh-plugin-design-to-scene

# 插件本体（.dockerignore 已排除 _work/_dist/node_modules 等）
COPY . /opt/dsh-plugin-design-to-scene

# 构建期自检：插件能加载、5 个工具齐全、示例 spec 可校验、CLI 可用（不跑 Blender 渲染，镜像构建更快）
RUN node -e "import('./index.js').then(m=>{const t=new Map();m.apply({tools:{register(d){t.set(d.name,d);return()=>{}}},skills:{register(s){return()=>{}}}},{});const want=['scene_build_blender','scene_parse_plan','scene_preview','scene_qx_plan','scene_spec_validate'];const got=[...t.keys()].sort();if(JSON.stringify(got)!==JSON.stringify(want))throw new Error('tools mismatch '+got);console.log('plugin ok:',got.join(','))})" \
 && node cloud/bin/scene-cli.mjs validate --spec examples/hall-demo.spec.json --out /tmp/check.json \
 && rm -f /tmp/check.json

# 默认给一个交互 shell；生产里用 `node cloud/bin/scene-cli.mjs ...` 直接跑
CMD ["bash"]
