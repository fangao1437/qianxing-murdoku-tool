-- tests/offline/stub_engine.lua —— 离线桩：用纯 Lua 模拟千星客户端控件与 game 表
--
-- 目的：不开模拟器就能验证 module 形态（不抢全局生命周期、Tutorial.install 能跑通、翻页/页签生效）。
-- 依据：适配层契约（docs/repo-survey.md §2.5）—— 真实 API 形状取自官方文档 + 实测日志：
--   game.GetClientUIRoots() / FindClientUIRoot(name)（点号）
--   ctrl.name / ctrl.visible（可读）· ctrl:GetChildren() / ctrl:GetChild(name) / ctrl:SetVisible(b)
--   ctrl:AddCursorEventListener(Enum.CursorEventType.CursorClick, cb)
-- 注意：真机/模拟器里控件是 **userdata**，这里用 table 模拟——所以框架必须两种都认
--   （Engine.is_ctrl 就是这么来的）。
return function()
  local function new_control(name, kind)
    local c = {
      name = name,
      kind = kind or "container",
      visible = true,
      active = true,
      text = "",
      children = {},
      _click = {},
      _key = {},
    }
    function c:GetChildren()
      local out = {}
      for i = 1, #self.children do out[i] = self.children[i] end
      return out
    end
    function c:GetChild(n)
      for _, kid in ipairs(self.children) do
        if kid.name == n then return kid end
      end
      return nil
    end
    function c:SetVisible(v) self.visible = v and true or false end
    function c:SetActive(v) self.active = v and true or false end
    function c:AddCursorEventListener(et, cb) self._click[et] = cb end
    function c:RemoveCursorEventListener(et, cb) self._click[et] = nil end
    function c:AddKeyEventListener(key, cb) self._key[key] = cb end
    function c:SetImage(src, id) self.imageId = id end
    function c:SimulateCursorClick()
      local cb = self._click[Enum.CursorEventType.CursorClick]
      if cb then cb({}) end
    end
    return c
  end

  local function factory()
    return {
      container = function(name) return new_control(name, "container") end,
      textbox = function(name) return new_control(name, "textbox") end,
      button = function(name) return new_control(name, "button") end,
      image = function(name) return new_control(name, "image") end,
    }
  end

  -- 组装：客户端控件容器 → app.root → screen.demo（2 页 / 2 页签 / next / pager）
  local C = factory()
  local screen_container = C.container("客户端控件容器")
  local root = C.container("app.root")
  local screen = C.container("screen.demo")
  local p1, p2 = C.container("page.p1"), C.container("page.p2")
  local tab1, tab2 = C.button("tab.p1"), C.button("tab.p2")
  local next_btn = C.button("btn.next")
  local pager = C.textbox("hud.pager")
  p2.visible = false
  screen.children = { tab1, tab2, next_btn, pager, p1, p2 }
  root.children = { screen }
  screen_container.children = { root }

  _G.Enum = {
    CursorEventType = { CursorDown = 1, CursorUp = 2, CursorClick = 3 },
    KeyboardKeyCode = { Left = 100, Right = 101 },
  }
  local sent = {}
  _G.game = {
    GetClientUIRoots = function() return { root } end,
    FindClientUIRoot = function(n) if n == root.name then return root end return nil end,
    PrintClientUITree = function() end,
    GetUICanvasSize = function() return 1280, 720 end,
    ServerSignal = function(name)
      local sig = { name = name, params = {} }
      function sig:AddInt(v) self.params[#self.params + 1] = v end
      function sig:AddString(v) self.params[#self.params + 1] = v end
      function sig:AddBool(v) self.params[#self.params + 1] = v end
      function sig:SendSignal() sent[#sent + 1] = { name = self.name, params = self.params } end
      return sig
    end,
  }
  return { root = root, screen = screen, p1 = p1, p2 = p2, pager = pager, next = next_btn, tab2 = tab2, sent = sent }
end
