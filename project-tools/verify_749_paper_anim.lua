-- tests/verify_749_paper_anim.lua —— 749 背包与商店右侧纸张覆盖切换动画端到端高仿真验证
-- 用法：lua tests/verify_749_paper_anim.lua <tree749.lua> <749.lua> <out.json>
local tree_path = assert(arg[1], "missing tree_path")
local script_path = assert(arg[2], "missing script_path")
local out_json = assert(arg[3], "missing out_json")

local TREE_SPEC = assert(dofile(tree_path))

local function json_esc(s)
  return '"' .. tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n'):gsub('\r', '\\r'):gsub('\t', '\\t') .. '"'
end
local function is_array(t)
  local n = 0
  for k in pairs(t) do
    if type(k) ~= "number" or k < 1 or math.floor(k) ~= k then return false end
    if k > n then n = k end
  end
  for i = 1, n do if t[i] == nil then return false end end
  return n > 0
end
local function to_json(v)
  local tv = type(v)
  if v == nil then return "null"
  elseif tv == "boolean" then return v and "true" or "false"
  elseif tv == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if math.floor(v) == v and math.abs(v) < 1e15 then return string.format("%d", v) end
    return string.format("%.4f", v)
  elseif tv == "string" then return json_esc(v)
  elseif tv == "table" then
    if is_array(v) then
      local out = {}
      for i = 1, #v do out[i] = to_json(v[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    else
      local keys = {}
      for k in pairs(v) do keys[#keys + 1] = tostring(k) end
      table.sort(keys)
      local out = {}
      for i = 1, #keys do
        local k = keys[i]
        out[i] = json_esc(k) .. ":" .. to_json(v[k])
      end
      return "{" .. table.concat(out, ",") .. "}"
    end
  end
  return "null"
end

local function make_sandbox(lua_path, opts)
  opts = opts or {}
  local stats = {
    api = 0, get_kids = 0, get_child = 0, set_vis = 0, set_pos = 0,
    set_scale = 0, set_rot = 0, set_text = 0, set_col = 0, last_sib = 0,
  }
  local canvas_w, canvas_h = opts.cw or 1920, opts.ch or 1080
  local all_nodes, by_name = {}, {}
  local ctrl_mt

  local function new_node(id, name, init)
    init = init or {}
    local raw = {
      _id = id, _name = name or "",
      _visible = true, _active = true, _ray = false, _blk = true, _intr = true,
      _showCursor = false, _disablePass = false, _disableKeyPass = false,
      _text = "", _fontSize = 18, _minFontSize = 10, _adaptiveFontSize = true,
      _fontColor = 0xFF493321, _imageColor = 0xFFFFFFFF,
      _imageId = 100001, _imageSource = 4294967295, _imageType = 0,
      _clickAudioId = 1, _prefabIndex = id,
      _px = init.px or 0, _py = init.py or 0,
      _sx = 1, _sy = 1, _sz = 1,
      _rx = 0, _ry = 0, _rz = init.rz or 0,
      _w = init.w or 120, _h = init.h or 120,
      _ax0 = 0.5, _ay0 = 0.5, _ax1 = 0.5, _ay1 = 0.5, _pivx = 0.5, _pivy = 0.5,
      _kids = {}, _parent = nil, _listeners = {}, _key_listeners = {}, _kind = "UIControl",
    }
    local obj = setmetatable({ _raw = raw }, ctrl_mt)
    all_nodes[#all_nodes + 1] = obj
    if name and name ~= "" and by_name[name] == nil then by_name[name] = obj end
    return obj
  end

  local methods = {}
  function methods:GetChildren()
    stats.api = stats.api + 1; stats.get_kids = stats.get_kids + 1
    local res, ks = {}, self._raw._kids
    for i = 1, #ks do res[i] = ks[i] end
    return res
  end
  function methods:GetChild(nm)
    stats.api = stats.api + 1; stats.get_child = stats.get_child + 1
    local ks = self._raw._kids
    for i = 1, #ks do if ks[i]._raw._name == nm then return ks[i] end end
    return nil
  end
  function methods:SetVisible(v)
    stats.api = stats.api + 1; stats.set_vis = stats.set_vis + 1
    self._raw._visible = v and true or false
  end
  function methods:SetActive(v)
    stats.api = stats.api + 1
    self._raw._active = v and true or false
  end
  function methods:GetAnchoredPosition()
    stats.api = stats.api + 1
    return self._raw._px, self._raw._py
  end
  function methods:SetAnchoredPosition(x, y)
    stats.api = stats.api + 1; stats.set_pos = stats.set_pos + 1
    self._raw._px, self._raw._py = x, y
  end
  function methods:GetLocalScale()
    stats.api = stats.api + 1
    return self._raw._sx, self._raw._sy, self._raw._sz
  end
  function methods:SetLocalScale(sx, sy, sz)
    stats.api = stats.api + 1; stats.set_scale = stats.set_scale + 1
    self._raw._sx, self._raw._sy, self._raw._sz = sx, sy, sz or 1
  end
  function methods:GetLocalRotation()
    stats.api = stats.api + 1
    -- 模拟真机 [0, 360) 欧拉角回读，验证我们不依赖绝对旋转起点
    local rz = self._raw._rz % 360
    if rz < 0 then rz = rz + 360 end
    return self._raw._rx, self._raw._ry, rz
  end
  function methods:SetLocalRotation(rx, ry, rz)
    stats.api = stats.api + 1; stats.set_rot = stats.set_rot + 1
    self._raw._rx, self._raw._ry, self._raw._rz = rx, ry, rz
  end
  function methods:GetSizeDelta() stats.api = stats.api + 1; return self._raw._w, self._raw._h end
  function methods:SetSizeDelta(w, h) stats.api = stats.api + 1; self._raw._w, self._raw._h = w, h end
  function methods:SetAnchorMin(x, y) self._raw._ax0, self._raw._ay0 = x, y end
  function methods:SetAnchorMax(x, y) self._raw._ax1, self._raw._ay1 = x, y end
  function methods:SetPivot(x, y) self._raw._pivx, self._raw._pivy = x, y end
  function methods:SetAsLastSibling()
    stats.api = stats.api + 1; stats.last_sib = stats.last_sib + 1
    local p = self._raw._parent
    if p then
      local ks = p._raw._kids
      for i = 1, #ks do
        if ks[i] == self then table.remove(ks, i); ks[#ks + 1] = self; break end
      end
    end
  end
  function methods:SetSiblingIndex(idx)
    stats.api = stats.api + 1
    local p = self._raw._parent
    if p then
      local ks = p._raw._kids
      for i = 1, #ks do if ks[i] == self then table.remove(ks, i); break end end
      local pos = math.max(1, math.min(#ks + 1, (tonumber(idx) or 0) + 1))
      table.insert(ks, pos, self)
    end
  end
  function methods:GetSiblingIndex()
    local p = self._raw._parent
    if not p then return -1 end
    local ks = p._raw._kids
    for i = 1, #ks do if ks[i] == self then return i - 1 end end
    return -1
  end
  function methods:SetText(t) stats.api = stats.api + 1; stats.set_text = stats.set_text + 1; self._raw._text = tostring(t or "") end
  function methods:SetImage(src, id) stats.api = stats.api + 1; self._raw._imageSource = src; self._raw._imageId = id end
  function methods:AddCursorEventListener(ev, fn)
    stats.api = stats.api + 1
    local list = self._raw._listeners[ev]
    if not list then list = {}; self._raw._listeners[ev] = list end
    list[#list + 1] = fn
    return true
  end
  function methods:AddKeyEventListener(ev, fn) stats.api = stats.api + 1; self._raw._key_listeners[ev] = fn; return true end
  function methods:FireClick()
    if self._raw._ray ~= true then return false end
    local list = self._raw._listeners[1]
    if not list or #list == 0 then return false end
    for i = 1, #list do list[i]({ GetUIPos = function() return 0, 0 end }) end
    return true
  end

  local prop_map = {
    name = "_name", visible = "_visible", active = "_active",
    raycastTarget = "_ray", blockRaycast = "_blk", interactable = "_intr",
    showCursor = "_showCursor", disableCursorEventPassthrough = "_disablePass",
    disableKeyEventPassthrough = "_disableKeyPass",
    text = "_text", fontSize = "_fontSize", minimumFontSize = "_minFontSize",
    adaptiveFontSize = "_adaptiveFontSize", fontColor = "_fontColor",
    imageColor = "_imageColor", imageId = "_imageId", imageSource = "_imageSource",
    imageType = "_imageType", clickAudioId = "_clickAudioId", kind = "_kind", prefabIndex = "_prefabIndex",
    anchoredPositionX = "_px", anchoredPositionY = "_py",
    localScaleX = "_sx", localScaleY = "_sy", localScaleZ = "_sz",
    localRotationX = "_rx", localRotationY = "_ry", localRotationZ = "_rz",
  }

  ctrl_mt = {
    __index = function(self, k)
      local m = methods[k]
      if m ~= nil then return m end
      local fk = prop_map[k]
      if fk ~= nil then
        if k == "localRotationZ" then
          local rz = self._raw._rz % 360
          if rz < 0 then rz = rz + 360 end
          return rz
        end
        return self._raw[fk]
      end
      return nil
    end,
    __newindex = function(self, k, v)
      local fk = prop_map[k]
      if fk ~= nil then
        if k == "text" then stats.set_text = stats.set_text + 1 end
        if k == "imageColor" or k == "fontColor" then stats.set_col = stats.set_col + 1 end
        self._raw[fk] = v
      else
        rawset(self, k, v)
      end
    end,
  }

  local function build_tree(spec, parent)
    local node = new_node(spec.id, spec.name)
    node._raw._parent = parent
    if parent then parent._raw._kids[#parent._raw._kids + 1] = node end
    if spec.kids then
      for i = 1, #spec.kids do build_tree(spec.kids[i], node) end
    end
    return node
  end
  local roots = {}
  for i = 1, #TREE_SPEC do roots[i] = build_tree(TREE_SPEC[i], nil) end

  local env = setmetatable({
    print = function() end,
    printerr = function() end,
    script = { EnableUpdate = function() end },
    Enum = {
      CursorEventType = { Click = 1, Down = 2, Up = 3, Drag = 4 },
      KeyEventType = {},
      TextHorizontalAlignment = { Left = 0, Middle = 1, Right = 2 },
      TextVerticalAlignment = { Top = 0, Middle = 1, Bottom = 2 },
      ImageSource = { Currency = 1 },
      EaseType = { Linear = 0, OutCubic = 1, OutQuad = 2, OutBack = 3, InQuad = 4 },
    },
    game = {
      GetClientUIRoots = function() return roots end,
      GetUICanvasSize = function() return canvas_w, canvas_h end,
      GetCurrentDevice = function() return "PC" end,
      GetCustomVariable = function() return nil end,
      SetCustomVariable = function() end,
      InstantiateClientUIControl = function() return nil end,
      DestroyClientUIControl = function() end,
    },
  }, { __index = _G })

  local chunk = assert(loadfile(lua_path, "t", env))
  chunk()
  env.OnInit()
  env.OnStart()

  local sb = { env = env, stats = stats, by_name = by_name, roots = roots }
  function sb:get_murdoku()
    local M, ad
    local i = 1
    while true do
      local nm, val = debug.getupvalue(env.OnUpdate, i)
      if not nm then break end
      if nm == "Murdoku" then M = val
      elseif nm == "adapter" then ad = val end
      i = i + 1
    end
    return M, ad
  end
  function sb:find(nm) return by_name[nm] end
  function sb:step(n, dt)
    dt = dt or (1 / 60)
    for _ = 1, (n or 1) do env.OnUpdate(dt) end
  end
  function sb:reset_stats()
    for k in pairs(stats) do stats[k] = 0 end
  end
  function sb:set_wallet(coins, clues, pending, last, positions, pos_last, posFirst)
    local M = self:get_murdoku()
    local ctrl = M.current().controller
    ctrl.opts.wallet = function()
      return coins, clues, pending or "", last or "-", positions, pos_last or "-", posFirst
    end
  end
  function sb:action(ev)
    local M = self:get_murdoku()
    local s = M.current()
    s.adapter.on_input(ev)
  end
  return sb
end

local checks = {}
local function rec(name, obj) checks[name] = obj end

-- 1. 商店：标题铭牌与底部按钮保持静止；中间独立档案纸卡使用「整纸一体柔性弯曲（16 段纸带 + 10 段内框带 + 上下角钉容器）」覆放（100% alpha=0xFF 实色，零半透明）；
--    严格按千星真机「容器隐藏不级联 + _enforce_hidden_subtrees 会逐叶子关灯」规则核验每一个弯曲纸带与旧纸叶子的显隐！
do
  local sb = make_sandbox(script_path)
  sb:set_wallet(50, 2, "", "-", 1, "-", false)
  sb:step(15) -- 在 home 页充分触发 _enforce_hidden_subtrees（会把 anim.bend / anim.under 子节点全关灯）
  sb:action({ action = "shop" })
  sb:step(1)
  local sheet = assert(sb:find("econ.shop736.anim.sheet"), "missing shop anim.sheet")
  local under = assert(sb:find("econ.shop736.anim.under"), "missing shop anim.under")
  local bend  = assert(sb:find("econ.shop736.anim.bend"),  "missing shop anim.bend")
  local ptopC = assert(sb:find("econ.shop736.anim.ptop"),  "missing shop anim.ptop")
  local pbotC = assert(sb:find("econ.shop736.anim.pbot"),  "missing shop anim.pbot")
  local topC  = assert(sb:find("econ.shop736.anim.top"),   "missing shop anim.top")
  local botC  = assert(sb:find("econ.shop736.anim.bot"),   "missing shop anim.bot")
  local br1   = assert(sb:find("econ.shop736.anim.b.br1"), "missing shop anim.b.br1")
  local br16  = assert(sb:find("econ.shop736.anim.b.br16"), "missing shop anim.b.br16")
  local fc1   = assert(sb:find("econ.shop736.anim.b.fc1"), "missing shop anim.b.fc1")
  local fc8   = assert(sb:find("econ.shop736.anim.b.fc8"), "missing shop anim.b.fc8")
  local fc16  = assert(sb:find("econ.shop736.anim.b.fc16"), "missing shop anim.b.fc16")
  local in1   = assert(sb:find("econ.shop736.anim.b.in1"), "missing shop anim.b.in1")
  local in10  = assert(sb:find("econ.shop736.anim.b.in10"), "missing shop anim.b.in10")
  local u_card_border = assert(sb:find("econ.shop736.anim.u.card.border"), "missing shop anim.u.card.border")
  local u_card_face   = assert(sb:find("econ.shop736.anim.u.card.face"),   "missing shop anim.u.card.face")
  local u_s65  = assert(sb:find("econ.shop736.anim.u.s65"), "missing shop anim.u.s65")
  local u_s66  = assert(sb:find("econ.shop736.anim.u.s66"), "missing shop anim.u.s66")
  local u_desc = assert(sb:find("econ.shop736.anim.u.desc"), "missing shop anim.u.desc")
  local u_price = assert(sb:find("econ.shop736.anim.u.price"), "missing shop anim.u.price")
  local live_name = assert(sb:find("econ.shop736.name"))
  local live_desc = assert(sb:find("econ.shop736.desc"))
  local live_price = assert(sb:find("econ.shop736.price"))
  local live_s66 = assert(sb:find("econ.shop736.s66"))
  local card_border = assert(sb:find("econ.shop736.card.border"), "missing shop card.border")
  local card_face = assert(sb:find("econ.shop736.card.face"), "missing shop card.face")
  local s37 = assert(sb:find("econ.shop736.s37"))
  local s71 = assert(sb:find("econ.shop736.s71"))
  local header_fixed_parent = (s37._raw._parent._raw._name == "econ.ui742" and live_name._raw._parent._raw._name == "econ.ui742")
  local button_fixed_parent = (s71._raw._parent._raw._name == "econ.ui742")
  local card_in_sheet = (card_border._raw._parent == sheet and card_face._raw._parent == sheet and live_s66._raw._parent == sheet and bend._raw._parent == sheet and ptopC._raw._parent == sheet and pbotC._raw._parent == sheet and topC._raw._parent == sheet and botC._raw._parent == sheet)
  local no_u_name = (sb:find("econ.shop736.anim.u.name") == nil)
  local no_semi_artifacts = (
    sb:find("econ.shop736.card.shadow") == nil
    and sb:find("econ.shop736.anim.shadow") == nil
    and sb:find("econ.shop736.anim.bend.shade") == nil
    and sb:find("econ.shop736.anim.bend.light") == nil
    and sb:find("econ.shop736.anim.curl.cut") == nil
  )

  local function all_bend_leaves_vis(want)
    for i = 1, 16 do
      if sb:find("econ.shop736.anim.b.br" .. i)._raw._visible ~= want then return false end
      if sb:find("econ.shop736.anim.b.fc" .. i)._raw._visible ~= want then return false end
    end
    for j = 1, 10 do
      if sb:find("econ.shop736.anim.b.in" .. j)._raw._visible ~= want then return false end
    end
    return true
  end

  -- 辅助函数：测量 16 段纸带左右边缘实际多段弧长、四角净空与相邻条带半宽跳变（验证基尔霍夫薄板不可伸长 + 不撞标题铭牌 + 右上角零阶梯）
  local function measure_paper_edges(prefix, cardW, cardH)
    local lx_prev, ly_prev, rx_prev, ry_prev, prev_hw
    local lLen, rLen, max_step_x = 0, 0, 0
    local tl_y, tr_y, tr_x, bl_y = 0, 0, 0, 0
    local stripH = cardH / 16
    for i = 1, 16 do
      local fc = sb:find(prefix .. "anim.b.fc" .. i)._raw
      local rad = fc._rz * math.pi / 180
      local sa, ca = math.sin(rad), math.cos(rad)
      local offF = (i == 1 and (-4.0 * fc._sy)) or (i == 16 and (4.0 * fc._sy)) or 0
      local cx = fc._px + offF * sa
      local cy = fc._py - offF * ca
      local hw = 0.5 * cardW * fc._sx
      local lx, ly = cx - hw * ca, cy - hw * sa
      local rx, ry = cx + hw * ca, cy + hw * sa
      if i > 1 then
        lLen = lLen + math.sqrt((lx - lx_prev) ^ 2 + (ly - ly_prev) ^ 2)
        rLen = rLen + math.sqrt((rx - rx_prev) ^ 2 + (ry - ry_prev) ^ 2)
        local dhw = math.abs(hw - prev_hw)
        if dhw > max_step_x then max_step_x = dhw end
      end
      lx_prev, ly_prev, rx_prev, ry_prev, prev_hw = lx, ly, rx, ry, hw
      if i == 1 then
        local topCx = cx - 0.5 * stripH * fc._sy * sa
        local topCy = cy + 0.5 * stripH * fc._sy * ca
        tl_y = topCy - hw * sa
        tr_y = topCy + hw * sa
        tr_x = topCx + hw * ca
      elseif i == 16 then
        local botCy = cy - 0.5 * stripH * fc._sy * ca
        bl_y = botCy - hw * sa
      end
    end
    return lLen, rLen, bl_y, tl_y, tr_y, tr_x, max_step_x
  end

  local enter_under_vis = under._raw._visible
  local enter_bend_vis = bend._raw._visible
  local enter_bend_leaves_off = all_bend_leaves_vis(false)
  local enter_under_leaves_off = (u_card_border._raw._visible == false and u_card_face._raw._visible == false and u_s65._raw._visible == false and u_s66._raw._visible == false and u_desc._raw._visible == false)
  local enter_face_vis = (card_face._raw._visible == true and live_s66._raw._visible == true)
  local enter_top_x, enter_top_y = topC._raw._px, topC._raw._py
  local enter_bot_x, enter_bot_y = botC._raw._px, botC._raw._py
  local enter_desc = live_desc._raw._text
  local s37_px0, s37_py0 = s37._raw._px, s37._raw._py

  -- 点击位置揭示券 -> 触发整纸一体柔性弯曲覆纸动画（逐叶子点亮弯曲纸带与旧纸底面！）
  sb:action({ action = "store_position" })
  sb:step(3, 1/60)
  local mid1_under_vis = under._raw._visible
  local mid1_bend_vis = bend._raw._visible
  local mid1_bend_leaves_on = all_bend_leaves_vis(true)
  local mid1_under_leaves_on = (u_card_border._raw._visible == true and u_card_face._raw._visible == true and u_s65._raw._visible == true and u_s66._raw._visible == true)
  local mid1_face_vis = (card_face._raw._visible == false and card_border._raw._visible == false and live_s66._raw._visible == false)
  local mid1_u_desc = u_desc._raw._text
  local mid1_live_desc = live_desc._raw._text
  local mid1_top_x, mid1_top_rz = topC._raw._px, topC._raw._rz
  local mid1_bot_x, mid1_bot_rz = botC._raw._px, botC._raw._rz
  local mid1_fc1_rz, mid1_fc16_rz = fc1._raw._rz, fc16._raw._rz
  local mid1_fc1_sx, mid1_fc16_sx = fc1._raw._sx, fc16._raw._sx
  local mid1_in1_rz, mid1_in10_rz = in1._raw._rz, in10._raw._rz
  local mid1_fc1_alpha = math.floor(fc1._raw._imageColor / 16777216) % 256
  local mid1_in10_alpha = math.floor(in10._raw._imageColor / 16777216) % 256
  local mid1_lLen, mid1_rLen, mid1_blY, mid1_tlY, mid1_trY, mid1_trX, mid1_stepX = measure_paper_edges("econ.shop736.", 468, 530)
  local shop_rest_arc = 530 * 15 / 16
  -- 基尔霍夫薄板双模态解析积分门禁：单调柔弯、零拉伸、左上/右上距标题铭牌留足净空(< +16px)、右上无阶梯(stepX < 0.75px)、左下不戳出
  local real_flex_bend = (
    mid1_fc1_rz > 0.5 and mid1_fc1_rz < 2.2
    and mid1_fc16_rz > 1.5 and mid1_fc16_rz < 4.2
    and (mid1_fc16_rz - mid1_fc1_rz) > 0.8 and (mid1_fc16_rz - mid1_fc1_rz) < 3.2
    and math.abs(mid1_in10_rz - mid1_in1_rz) > 0.35
    and math.abs(pbotC._raw._rz - ptopC._raw._rz) > 0.35
    and math.abs(mid1_bot_rz - mid1_top_rz) > 0.35
    and mid1_lLen <= shop_rest_arc + 0.5
    and mid1_rLen <= shop_rest_arc + 0.5
    and mid1_blY >= -265.0 - 1.0
    and mid1_tlY <= 265.0 + 14.0
    and mid1_trY <= 265.0 + 16.0
    and mid1_trX <= 234.0 + 20.0
    and mid1_stepX < 0.75
  )
  local opaque_strips = (mid1_fc1_alpha == 255 and mid1_in10_alpha == 255)
  local moved_from_rest = (
    math.abs(mid1_top_x - enter_top_x) > 8
    and math.abs(mid1_top_x - enter_top_x) < 34
    and math.abs(mid1_bot_x - enter_bot_x) > 8
    and math.abs(mid1_bot_x - enter_bot_x) < 38
  )
  local header_still = (s37._raw._px == s37_px0 and s37._raw._py == s37_py0 and s37._raw._rz == 0)

  -- 中途约 0.22s：推进并逐步展平（纸尾角度与位移减小）
  sb:step(10, 1/60)
  local mid2_top_x, mid2_fc16_rz = topC._raw._px, fc16._raw._rz
  local progressing = (math.abs(mid2_top_x - enter_top_x) < math.abs(mid1_top_x - enter_top_x) and math.abs(mid2_fc16_rz) < math.abs(mid1_fc16_rz))

  -- 再点击线索核验券（中途打断/连续切换）-> 旧纸立刻接管“位置揭示券”的价格与说明，新纸重新覆入
  sb:action({ action = "store_clue" })
  sb:step(1, 1/60)
  local int_u_price = u_price._raw._text
  local int_live_price = live_price._raw._text
  local int_under_vis = under._raw._visible
  local int_bend_vis = bend._raw._visible
  local int_leaves_ok = (all_bend_leaves_vis(true) and u_card_face._raw._visible == true)
  local int_moved = (math.abs(topC._raw._px - enter_top_x) > 8)

  -- 推进至动画结束（> 0.38s）并走完射线 3 趟安全窗
  sb:step(60, 1/60)
  local end_under_vis = under._raw._visible
  local end_bend_vis = bend._raw._visible
  local end_bend_leaves_off = all_bend_leaves_vis(false)
  local end_under_leaves_off = (u_card_border._raw._visible == false and u_card_face._raw._visible == false and u_s65._raw._visible == false and u_s66._raw._visible == false and u_desc._raw._visible == false)
  local end_face_vis = (card_face._raw._visible == true and card_border._raw._visible == true and live_s66._raw._visible == true)
  local end_top_x, end_top_y, end_top_rz = topC._raw._px, topC._raw._py, topC._raw._rz
  local end_bot_x, end_bot_y, end_bot_rz = botC._raw._px, botC._raw._py, botC._raw._rz
  local end_pins_rest = (math.abs(ptopC._raw._rz) < 0.001 and math.abs(pbotC._raw._rz) < 0.001)

  -- 稳态零开销检查：静止 120 帧后动画层 0 次 pos/rot/scale 写入、0 次 GetChildren
  sb:reset_stats()
  sb:step(120, 1/60)
  local steady_pos = sb.stats.set_pos
  local steady_rot = sb.stats.set_rot
  local steady_kids = sb.stats.get_kids

  -- 重复点击同一个道具（store_clue）-> 介绍未变，不应重播动画
  sb:action({ action = "store_clue" })
  sb:step(1, 1/60)
  local same_click_under_vis = under._raw._visible
  local same_click_bend_vis = bend._raw._visible

  -- 点击取消（store_clear）-> 回到默认介绍，触发一次新纸覆盖
  sb:action({ action = "store_clear" })
  sb:step(1, 1/60)
  local clear_under_vis = under._raw._visible
  local clear_u_price = u_price._raw._text
  local clear_live_price = live_price._raw._text
  sb:step(40, 1/60)
  local clear_end_vis = under._raw._visible
  local clear_end_bend = bend._raw._visible
  local clear_end_leaves_off = all_bend_leaves_vis(false)

  -- 层序检查：顶部标题铭牌 s37、底部购买热区、确认弹窗遮罩 s148 均在 anim.sheet 之后（绝不被遮挡）
  sb:action({ action = "store_position" })
  sb:step(1, 1/60)
  sb:action({ action = "store_purchase" })
  sb:step(1, 1/60)
  local confirm_vis = sb:find("econ.shop736.s148")._raw._visible
  local s37_idx = s37:GetSiblingIndex()
  local s148_idx = sb:find("econ.shop736.s148"):GetSiblingIndex()
  local sheet_idx = sheet:GetSiblingIndex()
  local hit_pur_idx = sb:find("econ.shop736.hit.purchase"):GetSiblingIndex()

  rec("shop_paper_anim", {
    pass = (
      header_fixed_parent and button_fixed_parent and card_in_sheet and no_u_name and no_semi_artifacts
      and enter_under_vis == false and enter_bend_vis == false and enter_bend_leaves_off and enter_under_leaves_off and enter_face_vis
      and enter_desc == "选择左侧的道具查看用途。"
      and mid1_under_vis == true and mid1_bend_vis == true and mid1_bend_leaves_on and mid1_under_leaves_on and mid1_face_vis
      and mid1_u_desc == "选择左侧的道具查看用途。"
      and mid1_live_desc == "选中一名人物，将其棋子摆到正确位置。"
      and real_flex_bend and opaque_strips and moved_from_rest and header_still
      and progressing
      and int_under_vis == true and int_bend_vis == true and int_leaves_ok
      and int_u_price == "6 调查币"
      and int_live_price == "3 调查币"
      and int_moved
      and end_under_vis == false and end_bend_vis == false and end_bend_leaves_off and end_under_leaves_off and end_face_vis and end_pins_rest
      and math.abs(end_top_x - enter_top_x) < 0.001 and math.abs(end_top_y - enter_top_y) < 0.001 and math.abs(end_top_rz) < 0.001
      and math.abs(end_bot_x - enter_bot_x) < 0.001 and math.abs(end_bot_y - enter_bot_y) < 0.001 and math.abs(end_bot_rz) < 0.001
      and steady_pos == 0 and steady_rot == 0 and steady_kids == 0
      and same_click_under_vis == false and same_click_bend_vis == false
      and clear_under_vis == true and clear_u_price == "3 调查币" and clear_live_price == ""
      and clear_end_vis == false and clear_end_bend == false and clear_end_leaves_off
      and confirm_vis == true and s37_idx > sheet_idx and s148_idx > sheet_idx and hit_pur_idx > sheet_idx
    ),
    structure = { headerFixed = header_fixed_parent, buttonFixed = button_fixed_parent, cardInSheet = card_in_sheet, noUName = no_u_name, noSemiArtifacts = no_semi_artifacts },
    enter = { underVis = enter_under_vis, bendVis = enter_bend_vis, bendLeavesOff = enter_bend_leaves_off, underLeavesOff = enter_under_leaves_off, faceVis = enter_face_vis },
    mid1 = { underVis = mid1_under_vis, bendVis = mid1_bend_vis, bendLeavesOn = mid1_bend_leaves_on, underLeavesOn = mid1_under_leaves_on, staticHidden = mid1_face_vis, fc1Rz = mid1_fc1_rz, fc16Rz = mid1_fc16_rz, lLen = mid1_lLen, rLen = mid1_rLen, restArc = shop_rest_arc, blY = mid1_blY, tlY = mid1_tlY, trY = mid1_trY, trX = mid1_trX, maxStepX = mid1_stepX, in1Rz = mid1_in1_rz, in10Rz = mid1_in10_rz, topRz = mid1_top_rz, botRz = mid1_bot_rz, opaque = opaque_strips, headerStill = header_still },
    mid2 = { topX = mid2_top_x, fc16Rz = mid2_fc16_rz, progressing = progressing },
    interrupt = { underVis = int_under_vis, bendVis = int_bend_vis, leavesOk = int_leaves_ok, uPrice = int_u_price, livePrice = int_live_price, moved = int_moved },
    done = { underVis = end_under_vis, bendVis = end_bend_vis, bendLeavesOff = end_bend_leaves_off, underLeavesOff = end_under_leaves_off, faceVis = end_face_vis, pinsRest = end_pins_rest },
    steady = { setPos = steady_pos, setRot = steady_rot, getKids = steady_kids },
    sameClick = { underVis = same_click_under_vis, bendVis = same_click_bend_vis },
    clear = { underVis = clear_under_vis, uPrice = clear_u_price, livePrice = clear_live_price, endVis = clear_end_vis, endBend = clear_end_bend, leavesOff = clear_end_leaves_off },
    zOrder = { s37 = s37_idx, s148 = s148_idx, sheet = sheet_idx, hitPurchase = hit_pur_idx },
  })
end

-- 2. 背包：进入背包无动画；选道具触发整纸一体柔性弯曲覆纸（逐叶子点亮 16 纸带 + 14 内框带 + 旧纸底面，零半透明）；
--    动画中切离页面立刻逐叶子熄灭并复位、不闪烁、切回不残影
do
  local sb = make_sandbox(script_path)
  sb:set_wallet(35, 3, "", "case_001:c1:1", 2, "case_001:A:2:3", true)
  sb:step(15)
  sb:action({ action = "bag" })
  sb:step(1)
  local sheet = assert(sb:find("econ.bag741.anim.sheet"), "missing bag anim.sheet")
  local under = assert(sb:find("econ.bag741.anim.under"), "missing bag anim.under")
  local bend  = assert(sb:find("econ.bag741.anim.bend"),  "missing bag anim.bend")
  local ptopC = assert(sb:find("econ.bag741.anim.ptop"),  "missing bag anim.ptop")
  local pbotC = assert(sb:find("econ.bag741.anim.pbot"),  "missing bag anim.pbot")
  local topC  = assert(sb:find("econ.bag741.anim.top"),   "missing bag anim.top")
  local botC  = assert(sb:find("econ.bag741.anim.bot"),   "missing bag anim.bot")
  local ptop  = assert(sb:find("econ.bag741.paper.top"),  "missing bag paper.top")
  local plbl  = assert(sb:find("econ.bag741.paper.label"), "missing bag paper.label")
  local pbod  = assert(sb:find("econ.bag741.paper.body"), "missing bag paper.body")
  local fc1   = assert(sb:find("econ.bag741.anim.b.fc1"), "missing bag anim.b.fc1")
  local fc8   = assert(sb:find("econ.bag741.anim.b.fc8"), "missing bag anim.b.fc8")
  local fc16  = assert(sb:find("econ.bag741.anim.b.fc16"), "missing bag anim.b.fc16")
  local in1   = assert(sb:find("econ.bag741.anim.b.in1"), "missing bag anim.b.in1")
  local in14  = assert(sb:find("econ.bag741.anim.b.in14"), "missing bag anim.b.in14")
  local u_ptop = assert(sb:find("econ.bag741.anim.u.paper.top"), "missing bag anim.u.paper.top")
  local u_pbod = assert(sb:find("econ.bag741.anim.u.paper.body"), "missing bag anim.u.paper.body")
  local u_title = assert(sb:find("econ.bag741.anim.u.title"), "missing bag anim.u.title")
  local live_title = assert(sb:find("econ.bag741.title"))
  local b_no_semi = (
    sb:find("econ.bag741.anim.shadow") == nil
    and sb:find("econ.bag741.anim.bend.shade") == nil
    and sb:find("econ.bag741.anim.bend.light") == nil
    and sb:find("econ.bag741.anim.curl.cut") == nil
  )

  local function bag_bend_leaves(want)
    for i = 1, 16 do
      if sb:find("econ.bag741.anim.b.br" .. i)._raw._visible ~= want then return false end
      if sb:find("econ.bag741.anim.b.fc" .. i)._raw._visible ~= want then return false end
    end
    for j = 1, 14 do
      if sb:find("econ.bag741.anim.b.in" .. j)._raw._visible ~= want then return false end
    end
    return true
  end

  local enter_under_vis = under._raw._visible
  local enter_bend_vis = bend._raw._visible
  local enter_leaves_off = (bag_bend_leaves(false) and u_ptop._raw._visible == false and u_pbod._raw._visible == false)
  local enter_ptop_vis = (ptop._raw._visible == true and plbl._raw._visible == true and pbod._raw._visible == true)
  local enter_top_x, enter_top_y = topC._raw._px, topC._raw._py
  local enter_bot_x, enter_bot_y = botC._raw._px, botC._raw._py
  local enter_title = live_title._raw._text

  -- 选位置揭示券
  sb:action({ action = "econ_position" })
  sb:step(3, 1/60)
  local b1_under_vis = under._raw._visible
  local b1_bend_vis = bend._raw._visible
  local b1_leaves_on = (bag_bend_leaves(true) and u_ptop._raw._visible == true and u_pbod._raw._visible == true)
  local b1_static_hidden = (ptop._raw._visible == false and plbl._raw._visible == false and pbod._raw._visible == false)
  local b1_u_title = u_title._raw._text
  local b1_live_title = live_title._raw._text
  local function measure_bag_edges(cardW, cardH)
    local lx_prev, ly_prev, rx_prev, ry_prev, prev_hw
    local lLen, rLen, max_step_x = 0, 0, 0
    local tl_y, tr_y, bl_y = 0, 0, 0
    local stripH = cardH / 16
    for i = 1, 16 do
      local fc = sb:find("econ.bag741.anim.b.fc" .. i)._raw
      local rad = fc._rz * math.pi / 180
      local sa, ca = math.sin(rad), math.cos(rad)
      local offF = (i == 1 and (-4.0 * fc._sy)) or (i == 16 and (4.0 * fc._sy)) or 0
      local cx = fc._px + offF * sa
      local cy = fc._py - offF * ca
      local hw = 0.5 * cardW * fc._sx
      local lx, ly = cx - hw * ca, cy - hw * sa
      local rx, ry = cx + hw * ca, cy + hw * sa
      if i > 1 then
        lLen = lLen + math.sqrt((lx - lx_prev) ^ 2 + (ly - ly_prev) ^ 2)
        rLen = rLen + math.sqrt((rx - rx_prev) ^ 2 + (ry - ry_prev) ^ 2)
        local dhw = math.abs(hw - prev_hw)
        if dhw > max_step_x then max_step_x = dhw end
      end
      lx_prev, ly_prev, rx_prev, ry_prev, prev_hw = lx, ly, rx, ry, hw
      if i == 1 then
        local topCy = cy + 0.5 * stripH * fc._sy * ca
        tl_y = topCy - hw * sa
        tr_y = topCy + hw * sa
      elseif i == 16 then
        local botCy = cy - 0.5 * stripH * fc._sy * ca
        bl_y = botCy - hw * sa
      end
    end
    return lLen, rLen, bl_y, tl_y, tr_y, max_step_x
  end

  local b1_lLen, b1_rLen, b1_blY, b1_tlY, b1_trY, b1_stepX = measure_bag_edges(408.5, 616.3333)
  local bag_rest_arc = 616.3333 * 15 / 16
  local b1_flex = (
    fc1._raw._rz > 0.5 and fc1._raw._rz < 2.2
    and fc16._raw._rz > 1.5 and fc16._raw._rz < 4.2
    and (fc16._raw._rz - fc1._raw._rz) > 0.8 and (fc16._raw._rz - fc1._raw._rz) < 3.2
    and math.abs(in14._raw._rz - in1._raw._rz) > 0.5
    and math.abs(pbotC._raw._rz - ptopC._raw._rz) > 0.35
    and b1_lLen <= bag_rest_arc + 0.5
    and b1_rLen <= bag_rest_arc + 0.5
    and b1_blY >= -308.17 - 1.0
    and b1_trY <= 308.17 + 16.0
    and b1_stepX < 0.75
  )
  local b1_opaque = ((math.floor(fc1._raw._imageColor / 16777216) % 256) == 255 and (math.floor(in14._raw._imageColor / 16777216) % 256) == 255)
  local b1_moved = (math.abs(topC._raw._px - enter_top_x) > 8 and math.abs(topC._raw._px - enter_top_x) < 34)

  -- 推进几帧后切选线索核验券（打断并再叠新纸）
  sb:step(10, 1/60)
  local b1_mid_fc16_rz = fc16._raw._rz
  local b1_prog = (math.abs(b1_mid_fc16_rz) < math.abs(fc16._raw._rz) or math.abs(topC._raw._px - enter_top_x) < 90)
  sb:action({ action = "econ_clue" })
  sb:step(1, 1/60)
  local b2_u_title = u_title._raw._text
  local b2_live_title = live_title._raw._text
  local b2_under_vis = under._raw._visible

  -- 推进完毕并走完射线安全窗
  sb:step(60, 1/60)
  local b_end_vis = under._raw._visible
  local b_end_bend = bend._raw._visible
  local b_end_leaves_off = (bag_bend_leaves(false) and u_ptop._raw._visible == false and u_pbod._raw._visible == false and u_title._raw._visible == false)
  local b_end_ptop = (ptop._raw._visible == true and plbl._raw._visible == true and pbod._raw._visible == true)
  local b_end_top_x, b_end_top_y, b_end_top_rz = topC._raw._px, topC._raw._py, topC._raw._rz
  local b_end_bot_x, b_end_bot_y, b_end_bot_rz = botC._raw._px, botC._raw._py, botC._raw._rz

  -- 稳态零开销检查
  sb:reset_stats()
  sb:step(120, 1/60)
  local b_steady_pos = sb.stats.set_pos
  local b_steady_rot = sb.stats.set_rot
  local b_steady_kids = sb.stats.get_kids

  -- 动画播放中途立刻点返回首页 -> 必须立即逐叶子关灯 anim.under/anim.bend 且绝不误点亮 paper.top
  sb:action({ action = "econ_position" })
  sb:step(3, 1/60)
  local mid_before_leave = (under._raw._visible and bend._raw._visible and bag_bend_leaves(true))
  sb:action({ action = "econ_back" })
  sb:step(1, 1/60)
  local after_leave_under_vis = under._raw._visible
  local after_leave_bend_vis = bend._raw._visible
  local after_leave_leaves_off = (bag_bend_leaves(false) and u_ptop._raw._visible == false and u_title._raw._visible == false)
  local after_leave_top_x, after_leave_top_rz = topC._raw._px, topC._raw._rz

  -- 重新进入背包：应以默认介绍无残影干净呈现
  sb:action({ action = "bag" })
  sb:step(1, 1/60)
  local reenter_under_vis = under._raw._visible
  local reenter_bend_vis = bend._raw._visible
  local reenter_title = live_title._raw._text

  rec("bag_paper_anim", {
    pass = (
      b_no_semi
      and enter_under_vis == false and enter_bend_vis == false and enter_leaves_off and enter_ptop_vis
      and enter_title == "调查背包"
      and b1_under_vis == true and b1_bend_vis == true and b1_leaves_on and b1_static_hidden
      and b1_flex and b1_opaque and b1_prog
      and b1_u_title == "调查背包" and b1_live_title == "位置揭示券" and b1_moved
      and b2_under_vis == true and b2_u_title == "位置揭示券" and b2_live_title == "线索核验券"
      and b_end_vis == false and b_end_bend == false and b_end_leaves_off and b_end_ptop
      and math.abs(b_end_top_x - enter_top_x) < 0.001 and math.abs(b_end_top_y - enter_top_y) < 0.001 and math.abs(b_end_top_rz) < 0.001
      and math.abs(b_end_bot_x - enter_bot_x) < 0.001 and math.abs(b_end_bot_y - enter_bot_y) < 0.001 and math.abs(b_end_bot_rz) < 0.001
      and b_steady_pos == 0 and b_steady_rot == 0 and b_steady_kids == 0
      and mid_before_leave == true
      and after_leave_under_vis == false and after_leave_bend_vis == false and after_leave_leaves_off
      and math.abs(after_leave_top_x - enter_top_x) < 0.001 and math.abs(after_leave_top_rz) < 0.001
      and reenter_under_vis == false and reenter_bend_vis == false and reenter_title == "调查背包"
    ),
    noSemiArtifacts = b_no_semi,
    enter = { underVis = enter_under_vis, bendVis = enter_bend_vis, leavesOff = enter_leaves_off, ptopVis = enter_ptop_vis, title = enter_title },
    step1 = { underVis = b1_under_vis, bendVis = b1_bend_vis, leavesOn = b1_leaves_on, staticHidden = b1_static_hidden, flex = b1_flex, fc1Rz = fc1._raw._rz, fc16Rz = fc16._raw._rz, lLen = b1_lLen, rLen = b1_rLen, restArc = bag_rest_arc, blY = b1_blY, tlY = b1_tlY, trY = b1_trY, maxStepX = b1_stepX, opaque = b1_opaque, uTitle = b1_u_title, liveTitle = b1_live_title },
    step2 = { underVis = b2_under_vis, uTitle = b2_u_title, liveTitle = b2_live_title },
    done = { underVis = b_end_vis, bendVis = b_end_bend, leavesOff = b_end_leaves_off, ptopVis = b_end_ptop },
    steady = { setPos = b_steady_pos, setRot = b_steady_rot, getKids = b_steady_kids },
    leaveAbort = { midBefore = mid_before_leave, afterVis = after_leave_under_vis, afterBend = after_leave_bend_vis, leavesOff = after_leave_leaves_off, topX = after_leave_top_x, topRz = after_leave_top_rz },
    reenter = { underVis = reenter_under_vis, bendVis = reenter_bend_vis, title = reenter_title },
  })
end

-- 3. 商店道具图元同步切换检查：从 position 切到 clue 时，旧底纸上 s110..s122 亮而 s125..s132 灭，新纸上 s125..s132 亮而 s110..s122 灭
do
  local sb = make_sandbox(script_path)
  sb:set_wallet(50, 1, "", "-", 1, "-", false)
  sb:step(15)
  sb:action({ action = "shop" })
  sb:step(1)
  sb:action({ action = "store_position" })
  sb:step(30, 1/60) -- 落定在 position
  sb:action({ action = "store_clue" })
  sb:step(1, 1/60)
  local u_pos_vis = assert(sb:find("econ.shop736.anim.u.s110"))._raw._visible
  local u_clue_vis = assert(sb:find("econ.shop736.anim.u.s125"))._raw._visible
  local live_pos_vis = assert(sb:find("econ.shop736.s110"))._raw._visible
  local live_clue_vis = assert(sb:find("econ.shop736.s125"))._raw._visible
  -- 再切到空（store_clear），旧底纸应显示 clue 图标，新纸无图标
  sb:step(30, 1/60)
  sb:action({ action = "store_clear" })
  sb:step(1, 1/60)
  local u2_pos_vis = sb:find("econ.shop736.anim.u.s110")._raw._visible
  local u2_clue_vis = sb:find("econ.shop736.anim.u.s125")._raw._visible
  local live2_clue_vis = sb:find("econ.shop736.s125")._raw._visible
  rec("shop_icon_layers_on_under_sheet", {
    pass = (
      u_pos_vis == true and u_clue_vis == false
      and live_pos_vis == false and live_clue_vis == true
      and u2_pos_vis == false and u2_clue_vis == true and live2_clue_vis == false
    ),
    posToClue = { uPos = u_pos_vis, uClue = u_clue_vis, livePos = live_pos_vis, liveClue = live_clue_vis },
    clueToEmpty = { uPos = u2_pos_vis, uClue = u2_clue_vis, liveClue = live2_clue_vis },
  })
end

-- 4. 购买全流程绝不触发纸张动画：未选道具点购买、余额不足点购买、正常选中道具弹出确认并确认购买成功（持有数与状态文案刷新），均不得触发动画；
--    购买后切换另一件道具时，旧纸仍准确展示购买后的最新持有数
do
  local sb = make_sandbox(script_path)
  local coins, clues, positions = 50, 1, 1
  local M = sb:get_murdoku()
  local ctrl = M.current().controller
  ctrl.opts.wallet = function() return coins, clues, "", "-", positions, "-", false end
  ctrl.opts.trade = function(op, kind)
    if op == "buy" and kind == "position" then
      coins = coins - 6; positions = positions + 1
      return true, "购买成功"
    end
    return false, "失败"
  end
  sb:step(15)
  sb:action({ action = "shop" })
  sb:step(1)
  local bend = sb:find("econ.shop736.anim.bend")
  local under = sb:find("econ.shop736.anim.under")
  local u_owned = sb:find("econ.shop736.anim.u.owned")
  local live_owned = sb:find("econ.shop736.owned")
  local live_status = sb:find("econ.shop736.status")

  -- 4a. 未选道具直接点购买 -> status 变为“请先选择道具”，但不触发动画
  sb:action({ action = "store_purchase" })
  sb:step(1, 1/60)
  local no_pick_anim = (under._raw._visible == false and bend._raw._visible == false)
  local no_pick_status = live_status._raw._text

  -- 4b. 选中位置揭示券并等待落定
  sb:action({ action = "store_position" })
  sb:step(45, 1/60)
  -- 点购买弹确认框 -> 不触发动画
  sb:action({ action = "store_purchase" })
  sb:step(1, 1/60)
  local open_confirm_no_anim = (under._raw._visible == false and bend._raw._visible == false)
  -- 点确认购买 -> 持有数变 2、状态变“购买成功”，但不触发动画
  sb:action({ action = "store_yes" })
  sb:step(2, 1/60)
  local buy_yes_no_anim = (under._raw._visible == false and bend._raw._visible == false)
  local after_buy_owned = live_owned._raw._text
  local after_buy_status = live_status._raw._text

  -- 4c. 余额不足点购买 -> status 变为“调查币不足”，不触发动画
  coins = 1
  sb:action({ action = "store_purchase" })
  sb:step(1, 1/60)
  local poor_no_anim = (under._raw._visible == false and bend._raw._visible == false)
  local poor_status = live_status._raw._text

  -- 4d. 购买后再切换到线索核验券 -> 此时触发动画，且旧纸准确展示更新后的“持有 2 张”
  sb:action({ action = "store_clue" })
  sb:step(1, 1/60)
  local next_switch_anim = (under._raw._visible == true and bend._raw._visible == true)
  local next_u_owned = u_owned._raw._text

  rec("shop_purchase_never_triggers_anim", {
    pass = (
      no_pick_anim and no_pick_status == "请先选择道具"
      and open_confirm_no_anim
      and buy_yes_no_anim and after_buy_owned == "持有 2 张" and after_buy_status == "购买成功"
      and poor_no_anim and poor_status == "调查币不足"
      and next_switch_anim and next_u_owned == "持有 2 张"
    ),
    noPick = { noAnim = no_pick_anim, status = no_pick_status },
    buyFlow = { openNoAnim = open_confirm_no_anim, yesNoAnim = buy_yes_no_anim, owned = after_buy_owned, status = after_buy_status },
    poor = { noAnim = poor_no_anim, status = poor_status },
    nextSwitch = { triggered = next_switch_anim, uOwned = next_u_owned },
  })
end

-- 5. 无额外渲染器冲突检查：动画进行期间再次调用 Controller:render() 不会把 anim.top 位置强制改回静止位
do
  local sb = make_sandbox(script_path)
  sb:set_wallet(50, 2, "", "-", 2, "-", false)
  sb:step(15)
  sb:action({ action = "bag" })
  sb:step(1)
  sb:action({ action = "econ_clue" })
  sb:step(3, 1/60)
  local topC = sb:find("econ.bag741.anim.top")
  local px_before, py_before = topC._raw._px, topC._raw._py
  local M = sb:get_murdoku()
  local sess = M.current()
  sess.controller.dirty = true
  sess.controller:render(sess.adapter, true)
  local px_after, py_after = topC._raw._px, topC._raw._py
  rec("render_does_not_clobber_anim_transform", {
    pass = (math.abs(px_before) > 10 and px_after == px_before and py_after == py_before),
    before = { px = px_before, py = py_before },
    after = { px = px_after, py = py_after },
  })
end

local all_pass = true
for k, v in pairs(checks) do
  if not v.pass then all_pass = false end
end
local out = { schema = "749-paper-anim-v5", pass = all_pass, checks = checks }
local f = assert(io.open(out_json, "w"))
f:write(to_json(out))
f:close()
print("VERIFY_749_PASS=" .. tostring(all_pass))
for k, v in pairs(checks) do
  print("  " .. k .. " = " .. tostring(v.pass) .. (v.pass and "" or (" " .. to_json(v))))
end
assert(all_pass, "verify_749_paper_anim failed")
