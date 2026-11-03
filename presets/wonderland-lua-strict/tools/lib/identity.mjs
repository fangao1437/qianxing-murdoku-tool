// 预设身份的唯一配置处（P13：一个事实只能有一个权威位置）。
// 改预设 id / 显示名 / 顺序，只改这里。

export const ROW_ID = 'preset-wonderland-lua-strict'; // profile patch 里的 Loader 行 id
export const PRESET_ID = 'wonderland-lua-strict';     // 预设身份（显示在「设置 → Agent 预设」）
export const PRESET_NAME = '千星 2D+Lua 游戏制作（严格版）';
export const PRESET_DESCRIPTION =
  '同一套七步流程与平台事实，但「什么才算验证过」的门槛更高：交付级结论必须带推翻条件与度量对齐说明。';
export const PRESET_ORDER = 13;

// bundle 包的 npm 名（build-bundle.mjs 写进 package.json）
export const BUNDLE_PACKAGE = 'dsh-preset-wonderland-lua-strict';
