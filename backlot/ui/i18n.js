// Backlot UI i18n. English source strings are the keys; Chinese is the default.
// Unknown keys fall back to the English text, so data-driven strings never break.

const LANG_KEY = "backlot.lang";

export const lang = localStorage.getItem(LANG_KEY) === "en" ? "en" : "zh";
document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";

export function setLang(next) {
  localStorage.setItem(LANG_KEY, next === "en" ? "en" : "zh");
  location.reload();
}

const ZH = {
  // library
  "Backlot — Library": "Backlot — 项目库",
  "Library": "项目库",
  "{n} projects": "{n} 个项目",
  "No projects yet — run a production and it will appear here.": "还没有项目 —— 开始一次视频制作后，项目会出现在这里。",
  "IDLE": "空闲",
  "IDLE · {ago}": "空闲 · {ago}",
  "{n} LIVE": "{n} 个进行中",
  "LIVE": "进行中",
  "LIVE · {stage}": "进行中 · {stage}",
  "NO MEDIA YET": "暂无素材",
  "◈ AWAITING YOU": "◈ 等你确认",
  "⚠ STALLED?": "⚠ 疑似卡住？",
  "unknown": "未知",
  "{n} scenes": "{n} 个分镜",
  "{n} renders": "{n} 个成片",
  "light": "浅色",
  "dark": "深色",
  "Switch to {theme} theme": "切换到{theme}主题",
  "Switch language": "切换语言",
  "just now": "刚刚",
  "{n}m ago": "{n} 分钟前",
  "{n}h ago": "{n} 小时前",
  "{n}d ago": "{n} 天前",

  // header / rail
  "{type} pipeline": "{type} 流水线",
  "{n} scenes · {d}": "{n} 个分镜 · {d}",
  "generation spend": "生成花费",
  "awaiting your approval\nreply in chat to continue": "等待你的确认\n请在对话中回复以继续",
  "stalled? no activity for {m}m\nask the agent for status": "疑似卡住？已 {m} 分钟无动作\n可向 agent 询问进度",
  "{n} scene{s} done": "已完成 {n} 个分镜",
  "in progress": "进行中",
  "failed": "失败",
  "pending": "未开始",
  "completed": "已完成",
  "awaiting_human": "待你确认",
  "in_progress": "进行中",
  " · approved": " · 已批准",
  "unlisted": "未列入",
  "\"{name}\" ran but isn't declared by this pipeline's manifest": "“{name}”已运行，但未在该流水线清单中声明",

  // stages
  "research": "调研",
  "proposal": "方案",
  "idea": "创意",
  "script": "脚本",
  "scene_plan": "分镜规划",
  "assets": "素材",
  "edit": "剪辑",
  "compose": "合成",
  "publish": "发布",

  // artifacts
  "brief": "创意简报",
  "proposal_packet": "方案提案",
  "research_brief": "调研简报",
  "asset_manifest": "素材清单",
  "edit_decisions": "剪辑决策",
  "render_report": "渲染报告",
  "publish_log": "发布记录",
  "final_review": "终审",
  "decision_log": "决策日志",

  // drawer
  "{n} critical": "{n} 个严重问题",
  "{n} suggestions": "{n} 条建议",
  "{n} suggestion{s}": "{n} 条建议",
  "{n} nitpicks": "{n} 个细节",
  "review focus {x}": "审查重点 {x}",
  "This stage hasn't run yet.": "该阶段尚未运行。",
  "No canonical artifact found on disk for this stage.": "磁盘上没有找到该阶段的标准产物。",
  "⚑ GATE SKIPPED": "⚑ 已跳过关卡",
  "CLOSE ✕": "关闭 ✕",

  // script
  "Section": "段落",
  "{n} more sections": "还有 {n} 个段落",
  "APPROVED": "已批准",
  "PENDING APPROVAL": "待批准",
  "DRAFTING": "撰写中",
  "Click to expand full script": "点击展开完整脚本",
  "script · {d} · {n} sections": "脚本 · {d} · {n} 个段落",
  "⤢ EXPAND SCRIPT": "⤢ 展开脚本",
  "ESC · CLOSE": "ESC · 关闭",
  "END": "完",
  "Intent — {x}": "意图 — {x}",

  // approval review
  "Item {n}": "条目 {n}",
  "SELECTED": "已选",
  "{n} item{s}": "{n} 项",
  "platform": "平台",
  "duration": "时长",
  "tone": "语气",
  "style": "风格",
  "runtime": "渲染引擎",
  "pipeline": "流水线",
  "estimated cost": "预估费用",
  "concepts": "创意方向",
  "sources": "来源",
  "data points": "数据点",
  "angles": "切入角度",
  "sections": "段落",
  "scenes": "分镜",
  "types": "类型",
  "generation cost": "生成费用",
  "cuts": "剪切",
  "outputs": "输出",
  "destinations": "发布目的地",
  "WHY THIS CONCEPT  ": "选择理由  ",
  "The complete script preview is shown directly below.": "完整脚本预览见下方。",
  "Review timing and shot coverage in the storyboard below.": "请在下方分镜板中检查时间与镜头覆盖。",
  "Inspect every generated take in the filmstrip below before approving compose.": "批准合成前，请先在下方胶片条中检查每个生成的镜头。",
  "Production proposal": "制作方案",
  "Research brief": "调研简报",
  "Scene plan": "分镜规划",
  "Generated assets": "已生成素材",
  "Edit decisions": "剪辑决策",
  "Render report": "渲染报告",
  "Publish plan": "发布计划",
  "Publish destination": "发布目的地",
  "Nothing reviewable was found. ": "没有找到可审阅的内容。",
  "The {stage} checkpoint declares {names}, but Backlot could not load it.": "{stage} 检查点声明了 {names}，但 Backlot 无法加载。",
  "The {stage} checkpoint does not declare an artifact.": "{stage} 检查点没有声明产物。",
  "REVIEW GATE": "审阅关卡",
  "{stage} is ready for your review": "{stage} 已就绪，等你审阅",
  "Review the artifact here, then reply in chat to approve it or request changes.": "在这里审阅产物，然后在对话中回复以批准或提出修改。",
  "SELF-REVIEW  ": "自审  ",
  "Approval unlocks {stage}.": "批准后将进入「{stage}」。",
  "This is the final approval gate.": "这是最后一道审批关卡。",
  "OPEN FULL ARTIFACT": "打开完整产物",
  "The {stage} stage is waiting for your review. ": "「{stage}」阶段正在等你审阅。",
  "The agent is paused at this gate — reply ": "agent 已在此关卡暂停 —— 请",
  "in chat": "在对话中",
  " to approve or request changes.": "回复以批准或提出修改。",

  // decisions / activity
  "Decisions": "决策",
  "Activity": "动态",
  "decision": "决策",
  " · revised": " · 已修订",
  "also considered: ": "也考虑过：",
  "● running": "● 运行中",

  // storyboard
  "Storyboard": "分镜板",
  "{n} scenes{d} · card width ∝ duration": "{n} 个分镜{d} · 卡片宽度 ∝ 时长",
  "★ HERO": "★ 主打",
  "◉ GENERATING": "◉ 生成中",
  "snapshot": "快照",
  "asset unavailable": "素材不可用",
  "◆ BESPOKE": "◆ 定制",
  "hand-authored composition": "手工编写的合成",
  "asset in manifest, file missing": "清单中有该素材，但文件缺失",
  "no asset yet": "暂无素材",
  "take {n}": "第 {n} 条",
  "{n} TAKES": "{n} 条",
  "Click to read the full narration": "点击阅读完整旁白",
  "Play narration": "播放旁白",

  // renders / misc
  "Renders": "成片",
  "{n} version{s}": "{n} 个版本",
  "root": "根目录",
  "What the watcher found": "监视器发现的内容",
  "snapshots / verification frames": "快照 / 验证帧",
  "No pipeline state. ": "没有流水线状态。",
  "This project has no checkpoints — Backlot is showing what it found on disk. ": "该项目没有检查点 —— Backlot 展示的是磁盘上找到的内容。",
  "Runs that follow the checkpoint protocol get the full board.": "遵循检查点协议的运行会获得完整看板。",
  "scrub the whole run": "拖动查看整个流程",
  "▶ REPLAY RUN": "▶ 回放流程",
  "✕ LIVE": "✕ 回到实时",
  "PROJECT NOT FOUND": "未找到项目",
};

export function t(key, vars = {}) {
  const template = lang === "zh" && key in ZH ? ZH[key] : key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

// Pluralisation helper for English templates ("{n} scene{s}").
export const plural = (n) => (n === 1 ? "" : "s");
