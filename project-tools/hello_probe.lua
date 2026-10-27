--[[----------------------------------------------------------------------------
  hello_probe.lua —— 「存活探针」，被追加在打包产物 dist/client_script.lua 的**末尾**。

  为什么放在末尾：
    它要包装 bundle 里 entry_client_script.lua 已经定义好的 OnInit / OnStart / ...，
    所以必须在它们**之后**执行。

  它回答三个问题：
    Q1 整份脚本有没有被编译并执行到底？   → `[probe] chunk executed to end`
    Q2 生命周期回调有没有被引擎调用？     → `[probe] OnInit called` / `OnStart called`
    Q3 运行时到底有哪些客户端控件？       → 控件树 dump（名字+id）

  ★ 双通道日志：关键行同时用 print（普通级）和 printerr（错误级）写。
    官方文档 157/160 行：print → 普通级别日志，printerr → 错误级别日志。
    如果【日志】窗口只显示错误级别，普通级的 print 会被过滤掉 —— 双写可以排除这个变量。

  ★ 肉眼可见的存活证明（完全不依赖日志）：
    找到 cell.1.1 / board / script.object，把它们放大、移位、改文字。
    试玩时看到按钮变大 / 位置跳到左上 / 文字变成 PROBE-OK，就说明脚本活着。
    OnInit 没触发时也会在前 600 帧里反复重试，所以控件晚出现也能补上。
--]]--

do
  local ok_install, install_err = pcall(function()

    local function emit(level, s)
      local line = "[probe] " .. tostring(s)
      if level == "err" then
        if printerr then printerr(line) end
        if print then print(line) end          -- 双写，保证至少有一条能过过滤
      else
        if print then print(line) end
      end
    end

    local function P(s)  emit("info", s) end
    local function PE(s) emit("err",  s) end   -- 关键里程碑：双通道

    -- ---------- Q1：整份 chunk 执行到底了 ----------
    PE("chunk executed to end")
    P("_VERSION=" .. tostring(_VERSION)
      .. "  os.time=" .. tostring(os and os.time and os.time())
      .. "  game=" .. tostring(game ~= nil)
      .. "  script=" .. tostring(script ~= nil)
      .. "  print=" .. tostring(print ~= nil)
      .. "  printerr=" .. tostring(printerr ~= nil))

    local LIFECYCLE = {
      "OnInit", "OnStart", "OnEnable", "OnDisable",
      "OnUpdate", "OnLevelUpdate", "OnDestroy",
    }

    local env = _ENV or _G

    do
      local have = {}
      for i = 1, #LIFECYCLE do
        if type(env[LIFECYCLE[i]]) == "function" then have[#have + 1] = LIFECYCLE[i] end
      end
      PE("lifecycle defined by bundle: " .. table.concat(have, ", "))
    end

    -- ---------- 控件查找（不依赖 script.object）----------
    local function get_roots()
      if not (game and game.GetClientUIRoots) then return nil end
      local ok, r = pcall(game.GetClientUIRoots)
      if ok and type(r) == "table" then return r end
      return nil
    end

    local function find_in(ctrl, name, depth)
      if ctrl == nil or depth > 16 then return nil end
      local ok, cname = pcall(function() return ctrl.name end)
      if ok and cname == name then return ctrl end
      local kids
      pcall(function() kids = ctrl:GetChildren() end)
      if type(kids) == "table" then
        for i = 1, #kids do
          local hit = find_in(kids[i], name, depth + 1)
          if hit then return hit end
        end
      end
      return nil
    end

    local function find_ctrl(name)
      local r = get_roots()
      if not r then return nil end
      for i = 1, #r do
        local hit = find_in(r[i], name, 0)
        if hit then return hit end
      end
      return nil
    end

    -- ---------- Q3：控件树 dump ----------
    local function dump_tree()
      local roots = get_roots()
      if not roots then P("game.GetClientUIRoots unavailable"); return end
      local n = 0
      for _ = 1, #roots do n = n + 1 end
      P("GetClientUIRoots -> " .. n .. " root(s)")

      local budget = 80
      local function walk(c, depth)
        if c == nil or depth > 3 or budget <= 0 then return end
        budget = budget - 1
        local name, id, vis = "?", "?", "?"
        pcall(function() name = tostring(c.name) end)
        pcall(function() id = tostring(c.id) end)
        pcall(function() vis = tostring(c.visible) .. "/" .. tostring(c.active) end)
        P(string.rep("  ", depth) .. "- name=" .. name .. " id=" .. id .. " vis/act=" .. vis)
        local kids
        pcall(function() kids = c:GetChildren() end)
        if type(kids) == "table" then
          for i = 1, #kids do walk(kids[i], depth + 1) end
        end
      end
      for i = 1, #roots do walk(roots[i], 1) end
      if budget <= 0 then P("(tree dump truncated)") end

      if game.PrintClientUITree then
        P("calling game.PrintClientUITree()")
        pcall(game.PrintClientUITree)
      end
    end

    -- ---------- ★ 肉眼可见的存活证明 ----------
    local proved = false
    local function visible_proof(loud)
      local targets = {}
      local c
      c = find_ctrl("cell.1.1");  if c then targets[#targets + 1] = { "cell.1.1", c } end
      c = find_ctrl("board");     if c then targets[#targets + 1] = { "board", c } end
      if script and script.object then
        targets[#targets + 1] = { "script.object", script.object }
      end
      if #targets == 0 then
        if loud then P("visible proof: no target control found yet") end
        return false
      end

      for i = 1, #targets do
        local nm, t = targets[i][1], targets[i][2]
        local did = {}
        if pcall(function() t:SetSizeDelta(420, 420) end)    then did[#did + 1] = "size=420x420" end
        if pcall(function() t:SetAnchoredPosition(30, 120) end) then did[#did + 1] = "pos=(30,120)" end
        if pcall(function() t:SetLocalScale(1.6, 1.6, 1) end) then did[#did + 1] = "scale=1.6" end

        local ntext, nkids = 0, 0
        pcall(function() if t.text ~= nil then t.text = "PROBE-OK"; ntext = ntext + 1 end end)

        -- ★ 不依赖锚点、不依赖文本字段的硬证据：
        --   把每个子控件（例如 cell.1.1 下面那个图片控件）放大到 600x600 并挪到父控件正中。
        --   子控件的大小是它自己的属性，父控件怎么锚定都不影响 —— 那个图标会明显变巨大。
        pcall(function()
          local kids = t:GetChildren()
          if type(kids) == "table" then
            for k = 1, #kids do
              local kid = kids[k]
              nkids = nkids + 1
              pcall(function() kid:SetSizeDelta(600, 600) end)
              pcall(function() kid:SetAnchoredPosition(0, 0) end)
              pcall(function() kid:SetLocalScale(1.0, 1.0, 1) end)
              if kid.text ~= nil then kid.text = "PROBE-OK"; ntext = ntext + 1 end
            end
          end
        end)

        if ntext > 0 then did[#did + 1] = "text x" .. ntext end
        if nkids > 0 then did[#did + 1] = "children resized x" .. nkids end

        PE("VISIBLE PROOF on " .. nm .. ": " ..
           (#did > 0 and table.concat(did, ", ") or "NOTHING WORKED (no Set* / text field)"))
      end
      return true
    end

    -- 先静默试一次（此刻控件可能还没就绪）
    proved = visible_proof(false)
    if proved then PE("visible proof applied at chunk level") end

    -- ---------- Q2：包装生命周期 ----------
    local function get_fn(name)
      local ok, f = pcall(function() return env[name] end)
      if ok and type(f) == "function" then return f end
      return nil
    end

    local function set_fn(name, f)
      local ok = pcall(function() env[name] = f end)
      if not ok then P("cannot wrap " .. name .. " (env is read-only)") end
      return ok
    end

    local function wrap(name, body)
      local orig = get_fn(name)
      set_fn(name, function(...)
        PE(name .. " called")
        if body then body() end
        if orig then return orig(...) end
      end)
    end

    wrap("OnInit", function()
      dump_tree()
      if visible_proof(true) then proved = true end
    end)
    wrap("OnStart")

    do
      local frames = 0
      local orig_update = get_fn("OnUpdate")
      set_fn("OnUpdate", function(dt)
        frames = frames + 1
        if frames == 1 then PE("OnUpdate first frame") end
        -- OnInit 没触发 / 控件晚出现：前 600 帧里持续尝试可见证明
        if not proved and frames % 20 == 0 and frames <= 600 then
          if visible_proof(true) then proved = true end
        end
        if frames == 300 then P("OnUpdate alive: 300 frames") end
        if orig_update then return orig_update(dt) end
      end)
    end

    wrap("OnEnable")
    wrap("OnDisable")
    wrap("OnDestroy")

    PE("probe armed")
  end)

  if not ok_install then
    local msg = "[probe] FAILED to install probe: " .. tostring(install_err)
    if printerr then printerr(msg) end
    if print then print(msg) end
  end
end
