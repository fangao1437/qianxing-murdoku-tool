#!/usr/bin/env bash
# 腾讯云 Linux 云主机（Ubuntu 22.04/24.04、Debian 12）一键部署：Node 22 + Blender 4.5 LTS + 本插件。
#
# 用法（在服务器上，插件目录内）：
#   sudo bash cloud/install-on-server.sh
#   # 可选环境变量：
#   #   DSH_PROFILE=web            有 dsh CLI 时装进哪个 profile（默认 web）
#   #   INSTALL_DIR=/opt/dsh-plugin-design-to-scene
#   #   BLENDER_VERSION=4.5.15     默认 4.5.15
#   #   SKIP_DSH_REGISTER=1        只装 Node/Blender/插件文件，不碰 DSH
#
# 幂等：重复执行会跳过已存在的 Node/Blender，只更新插件目录。
set -euo pipefail

BLENDER_VERSION="${BLENDER_VERSION:-4.5.15}"
INSTALL_DIR="${INSTALL_DIR:-/opt/dsh-plugin-design-to-scene}"
DSH_PROFILE="${DSH_PROFILE:-web}"
NODE_VERSION="${NODE_VERSION:-22.21.0}"
BLENDER_MIRROR="${BLENDER_MIRROR:-https://mirrors.aliyun.com/blender/release}"
NODE_MIRROR="${NODE_MIRROR:-https://npmmirror.com/mirrors/node}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$(cd "${SCRIPT_DIR}/.." && pwd)"

log() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '\n[错误] %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行：sudo bash cloud/install-on-server.sh"

log "1/6 安装系统依赖（Blender headless 运行库 + curl/xz）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  curl ca-certificates xz-utils tar \
  libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 \
  libgl1 libglu1-mesa libegl1 libsm6 libice6 libfontconfig1 libfreetype6 \
  libdbus-1-3 libgomp1 libsdl2-2.0-0 libtbb12 libwebp7 libopenjp2-7 \
  libpng16-16 libjpeg62-turbo libtiff6 libpcre2-8-0 >/dev/null

log "2/6 安装 Node.js ${NODE_VERSION}（npmmirror 镜像）"
if command -v node >/dev/null 2>&1 && node -e "process.exit(Number(process.versions.node.split('.')[0])>=20?0:1)"; then
  log "   已存在 Node $(node --version)，跳过"
else
  curl -fsSL --retry 3 -o /tmp/node.tar.xz "${NODE_MIRROR}/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  mkdir -p /usr/local/lib/nodejs
  tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs
  ln -sf "/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-x64/bin/node" /usr/local/bin/node
  ln -sf "/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-x64/bin/npm" /usr/local/bin/npm
  ln -sf "/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-x64/bin/npx" /usr/local/bin/npx
  rm -f /tmp/node.tar.xz
  log "   Node $(node --version) / npm $(npm --version)"
fi

log "3/6 安装 Blender ${BLENDER_VERSION} LTS（阿里云镜像）"
if [ -x /opt/blender/blender ] && /opt/blender/blender --version 2>/dev/null | head -n1 | grep -q "${BLENDER_VERSION}"; then
  log "   /opt/blender 已是 ${BLENDER_VERSION}，跳过"
else
  curl -fsSL --retry 3 -o /tmp/blender.tar.xz \
    "${BLENDER_MIRROR}/Blender${BLENDER_VERSION%.*}/blender-${BLENDER_VERSION}-linux-x64.tar.xz"
  mkdir -p /opt/blender
  tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1
  rm -f /tmp/blender.tar.xz
  ln -sf /opt/blender/blender /usr/local/bin/blender
fi
/opt/blender/blender --version | head -n 2
export BLENDER_PATH=/opt/blender/blender

log "4/6 部署插件到 ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
# 排除数据/缓存/构建产物；保留 examples/test/cloud（云端验收要用）
tar -C "${PLUGIN_SRC}" \
  --exclude='_work' --exclude='node_modules' --exclude='.git' --exclude='*.zip' \
  -cf - . | tar -C "${INSTALL_DIR}" -xf -
mkdir -p /data/cloud-data
log "   插件文件：$(find "${INSTALL_DIR}" -type f | wc -l) 个"

log "5/6 冒烟验证（不跑 Blender 渲染）"
cd "${INSTALL_DIR}"
node -e "import('./index.js').then(m=>{const t=new Map();m.apply({tools:{register(d){t.set(d.name,d);return()=>{}}},skills:{register(s){return()=>{}}}},{});const want=['scene_build_blender','scene_parse_plan','scene_preview','scene_qx_plan','scene_spec_validate'];const got=[...t.keys()].sort();if(JSON.stringify(got)!==JSON.stringify(want))throw new Error('tools mismatch: '+got);console.log('插件加载 OK，工具：'+got.join(', '))})"
node cloud/bin/scene-cli.mjs validate --spec examples/hall-demo.spec.json --out /tmp/spec-check.json
rm -f /tmp/spec-check.json
log "   冒烟通过；Blender: $(/opt/blender/blender --version | head -n1)"

log "6/6 注册到 DSH（可选）"
if [ "${SKIP_DSH_REGISTER:-0}" = "1" ]; then
  log "   按 SKIP_DSH_REGISTER=1 跳过"
elif command -v dsh >/dev/null 2>&1; then
  dsh plugin --profile "${DSH_PROFILE}" add "${INSTALL_DIR}" || die "dsh plugin add 失败（检查 dsh 版本/权限）"
  log "   已装进 profile：${DSH_PROFILE}（改配置后重启该 profile 的 dsh 进程生效）"
else
  log "   未检测到 dsh CLI，跳过自动注册。手动方式（在装了 DSH 的环境里）："
  log "     dsh plugin --profile ${DSH_PROFILE} add ${INSTALL_DIR}"
  log "     或在 DSH 会话里：plugin_manager { action: \"install_bundle\", target: \"${INSTALL_DIR}\" }"
fi

cat <<EOF

============================================================
部署完成（腾讯云 Linux）
  插件目录 : ${INSTALL_DIR}
  Blender  : /opt/blender/blender（$(/opt/blender/blender --version | head -n1)）
  Node     : $(node --version)
  数据目录 : /data/cloud-data
  场景 CLI : cd ${INSTALL_DIR} && node cloud/bin/scene-cli.mjs help

下一步（端到端自测，含 Blender 渲染）：
  mkdir -p /data/cloud-data/in /data/cloud-data/out
  cp ${INSTALL_DIR}/examples/design-demo-b.* ${INSTALL_DIR}/examples/hall-demo.spec.json /data/cloud-data/in/
  cd ${INSTALL_DIR}
  node cloud/bin/scene-cli.mjs all \\
    --design /data/cloud-data/in/design-demo-b.png \\
    --legend /data/cloud-data/in/design-demo-b.legend.json \\
    --outDir /data/cloud-data/out

预期：out/blender-scene/{scene.blend,scene.glb,render-top.png,render-perspective.png}
      + out/plan-preview.png + out/qx-plan/{placement.json,plan.md}
============================================================
EOF
