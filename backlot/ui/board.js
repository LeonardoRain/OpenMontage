// Backlot project board — renders BoardState and stays live via SSE.

import {
  STAGE_ICONS, el, fmtAgo, fmtClock, fmtDuration, fmtMoney,
  getJSON, mediaURL, renderLangToggle, subscribe, thumbURL, waveBars,
} from "/ui/lib.js";
import { lang, plural, t } from "/ui/i18n.js";

const rawProjectPath = location.pathname.split("/p/")[1] || "";
const projectId = decodeURIComponent(rawProjectPath);
const encodedProjectId = encodeURIComponent(projectId);
const app = document.getElementById("app");
const modal = document.getElementById("modal");
const player = document.getElementById("player");

const THEME_KEY = "backlot.theme";
let currentTheme = localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
let state = null;
let selectedStage = null;   // stage drawer open for this stage name
let activeRender = 0;
let replay = null;          // {t0, t1, t, playing} — replay mode when non-null
let firstPaint = true;

function applyTheme(theme) {
  currentTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = currentTheme;
  localStorage.setItem(THEME_KEY, currentTheme);
}

function renderThemeToggle() {
  const next = currentTheme === "light" ? "dark" : "light";
  return el("button", {
    class: "theme-toggle",
    type: "button",
    title: t("Switch to {theme} theme", { theme: t(next) }),
    "aria-label": t("Switch to {theme} theme", { theme: t(next) }),
    "aria-pressed": currentTheme === "light" ? "true" : "false",
    onclick: () => {
      applyTheme(next);
      render();
    },
  }, el("span", { class: "theme-toggle-icon", "aria-hidden": "true" }, currentTheme === "light" ? "☾" : "☀"));
}

applyTheme(currentTheme);

// ---------------------------------------------------------------------------
// header slate
// ---------------------------------------------------------------------------

function renderSlate(s) {
  const board = s.storyboard;
  const chips = [
    el("span", { class: "chip" }, t("{type} pipeline", { type: s.pipeline.pipeline_type })),
    board && board.total_duration_seconds
      ? el("span", { class: "chip" }, t("{n} scenes · {d}", { n: board.scenes.length, d: fmtDuration(board.total_duration_seconds) }))
      : null,
    s.style_playbook ? el("span", { class: "chip" }, s.style_playbook) : null,
  ];

  const awaiting = s.stages.find((x) => x.status === "awaiting_human");
  const inProgress = s.stages.find((x) => x.status === "in_progress");
  const stalled = s.stages.find((x) => x.stalled);
  let liveEl;
  if (awaiting) {
    liveEl = el("span", { class: "live" }, el("span", { class: "dot" }), t("◈ AWAITING YOU"));
  } else if (stalled) {
    liveEl = el("span", { class: "live", style: "color:var(--red)" },
      el("span", { class: "dot", style: "background:var(--red);animation:none" }), t("⚠ STALLED?"));
  } else if (s.live || inProgress) {
    liveEl = el("span", { class: "live" }, el("span", { class: "dot" }), t("LIVE"));
  } else {
    liveEl = el("span", { class: "live idle" }, el("span", { class: "dot" }),
      s.last_activity ? t("IDLE · {ago}", { ago: fmtAgo(s.last_activity).toUpperCase() }) : t("IDLE"));
  }

  const cost = el("div", { class: "cost" });
  if (s.cost) {
    const spent = s.cost.total_spent_usd ?? 0;
    const budget = spent + (s.cost.budget_remaining_usd ?? 0);
    const hasBudget = s.cost.budget_remaining_usd != null;
    const pct = hasBudget && budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
    cost.append(el("div", { class: "nums" }, el("b", {}, fmtMoney(spent)),
      hasBudget ? el("span", {}, ` / ${fmtMoney(budget)}`) : ""));
    if (hasBudget) {
      cost.append(el("div", { class: "bar" }, el("i", {
        class: pct > 90 ? "crit" : pct > 75 ? "warn" : "", style: `width:${pct}%`,
      })));
    }
    cost.append(el("div", { class: "label" }, t("generation spend")));
  }

  return el("header", { class: "slate" },
    el("div", { class: "clapper" }),
    el("div", {},
      el("a", { class: "wordmark", href: "/", style: "text-decoration:none" }, "Backlot"),
      el("h1", {}, s.title),
    ),
    ...chips,
    el("div", { class: "spacer" }),
    renderLangToggle(),
    renderThemeToggle(),
    liveEl,
    cost,
  );
}

// ---------------------------------------------------------------------------
// stage rail
// ---------------------------------------------------------------------------

function stageSub(st) {
  if (st.status === "awaiting_human") return t("awaiting your approval\nreply in chat to continue");
  if (st.status === "in_progress" && st.stalled) {
    return t("stalled? no activity for {m}m\nask the agent for status", { m: st.stalled_minutes });
  }
  if (st.status === "in_progress" && st.partial_progress) {
    const done = st.partial_progress.completed_scene_ids;
    if (Array.isArray(done)) return t("{n} scene{s} done", { n: done.length, s: plural(done.length) });
    return t("in progress");
  }
  if (st.status === "in_progress") return t("in progress");
  if (st.status === "failed") return st.error ? String(st.error).slice(0, 60) : t("failed");
  if (st.timestamp) {
    const approved = st.gated && st.human_approved ? t(" · approved") : "";
    return fmtClock(st.timestamp) + approved;
  }
  return "";
}

function renderRail(s) {
  const rail = el("nav", { class: "rail" });
  let pendingIndex = 1;
  for (const st of s.stages) {
    const cls = st.status === "completed" ? "done"
      : st.status === "in_progress" ? (st.stalled ? "active stalled" : "active")
      : st.status === "awaiting_human" ? "await"
      : st.status === "failed" ? "failed" : "";
    const icon = STAGE_ICONS[st.status] || String(pendingIndex);
    if (!STAGE_ICONS[st.status]) pendingIndex += 1;
    const node = el("div", {
      class: `stage ${cls}${selectedStage === st.name ? " selected" : ""}${st.undeclared ? " undeclared" : ""}`,
      title: st.undeclared ? t("\"{name}\" ran but isn't declared by this pipeline's manifest", { name: st.name }) : null,
      onclick: () => toggleDrawer(st.name),
    },
      el("span", { class: "line" }),
      el("span", { class: "node" }, icon),
      el("span", { class: "name" }, t(st.name)),
      el("span", { class: "sub", style: "white-space:pre-line" },
        st.undeclared ? `${stageSub(st)}\n${t("unlisted")}`.trim() : stageSub(st)),
    );
    rail.append(node);
  }
  return rail;
}

function toggleDrawer(stageName) {
  selectedStage = selectedStage === stageName ? null : stageName;
  render();
}

const STAGE_ARTIFACTS = {
  research: ["research_brief"],
  proposal: ["proposal_packet"],
  idea: ["brief"],
  script: ["script"],
  scene_plan: ["scene_plan"],
  assets: ["asset_manifest"],
  edit: ["edit_decisions"],
  compose: ["render_report", "final_review"],
  publish: ["publish_log"],
};

function artifactNamesForStage(st) {
  const declared = Array.isArray(st.produces) ? st.produces : [];
  const fallback = STAGE_ARTIFACTS[st.name] || [];
  return [...new Set([...declared, ...fallback].filter(Boolean))];
}

function reviewMetrics(review) {
  const nested = review && review.summary && typeof review.summary === "object"
    ? review.summary : {};
  return {
    critical: Number((review && review.critical) ?? nested.critical ?? 0),
    suggestions: Number((review && review.suggestions) ?? nested.suggestions ?? 0),
    nitpicks: Number((review && review.nitpicks) ?? nested.nitpicks ?? 0),
  };
}

function reviewSummaryText(review) {
  if (!review) return "";
  if (typeof review.summary === "string") return review.summary;
  const nested = review.summary && typeof review.summary === "object" ? review.summary : {};
  const counts = reviewMetrics(review);
  return [
    review.decision,
    t("{n} critical", { n: counts.critical }),
    t("{n} suggestion{s}", { n: counts.suggestions, s: plural(counts.suggestions) }),
    nested.review_focus_met ? t("review focus {x}", { x: nested.review_focus_met }) : null,
    nested.schema_validation,
  ].filter(Boolean).join(" · ");
}

function renderDrawer(s) {
  if (!selectedStage) return null;
  const st = s.stages.find((x) => x.name === selectedStage);
  if (!st) return null;

  const body = el("div", { class: "drawer-body" });

  if (st.review) {
    const metrics = reviewMetrics(st.review);
    const summary = reviewSummaryText(st.review);
    body.append(el("div", { class: "findings", style: "margin-bottom:12px" },
      el("span", { class: `f ${metrics.critical ? "crit" : ""}` }, t("{n} critical", { n: metrics.critical })),
      el("span", { class: `f ${metrics.suggestions ? "sugg" : ""}` }, t("{n} suggestions", { n: metrics.suggestions })),
      el("span", { class: "f" }, t("{n} nitpicks", { n: metrics.nitpicks })),
      summary ? el("span", { style: "font-size:calc(11.5px * var(--fs-scale));color:var(--text-2);margin-left:8px" }, summary) : null,
    ));
  }

  const names = artifactNamesForStage(st);
  let shown = false;
  for (const name of names) {
    const artifact = s.artifacts[name];
    if (!artifact) continue;
    shown = true;
    body.append(
      el("div", { class: "d-cat", style: "font-family:var(--mono);font-size:calc(9.5px * var(--fs-scale));color:var(--text-3);letter-spacing:.1em;text-transform:uppercase;margin:6px 0 4px" }, lang === "zh" ? `${t(name)} · ${name}` : name),
      el("pre", {}, JSON.stringify(artifact, null, 2)),
    );
  }
  if (!shown) {
    body.append(el("div", { class: "hint" },
      st.status === "pending" ? t("This stage hasn't run yet.") : t("No canonical artifact found on disk for this stage.")));
  }

  return el("div", { class: "drawer" },
    el("div", { class: "drawer-head" },
      el("h3", {}, `${t(st.name)} — ${t(st.status)}`),
      st.gate_skipped ? el("span", { class: "gate-chip" }, t("⚑ GATE SKIPPED")) : null,
      st.versions > 1 ? el("span", { class: "ver-chip" }, `v${st.versions}`) : null,
      st.timestamp ? el("span", { class: "meta", style: "font-family:var(--mono);font-size:calc(10.5px * var(--fs-scale));color:var(--text-3)" }, st.timestamp) : null,
      el("span", { class: "close", onclick: () => toggleDrawer(st.name) }, t("CLOSE ✕")),
    ),
    body,
  );
}

// ---------------------------------------------------------------------------
// script card
// ---------------------------------------------------------------------------

function scriptSections(script, limit) {
  const sections = script.sections || [];
  const shown = limit ? sections.slice(0, limit) : sections;
  const nodes = [];
  for (const sec of shown) {
    nodes.push(el("div", { class: "sp-slug" },
      `${(sec.id || "").toUpperCase()} — ${sec.label || t("Section")} `,
      el("span", { class: "tc" }, `${fmtDuration(sec.start_seconds)} – ${fmtDuration(sec.end_seconds)}`)));
    if (sec.text) nodes.push(el("div", { class: "sp-action" }, sec.text));
    if (sec.speaker_directions) nodes.push(el("div", { class: "sp-paren" }, `(${sec.speaker_directions})`));
    const cues = sec.enhancement_cues || [];
    if (cues.length) {
      nodes.push(el("div", { style: "margin-left:42px" },
        cues.map((c) => el("span", { class: "sp-cue" }, `▸ ${c.type} · ${String(c.description || "").slice(0, 60)}`))));
    }
  }
  if (limit && sections.length > limit) {
    nodes.push(el("div", { class: "sp-fade" }, `… ${t("{n} more sections", { n: sections.length - limit })}`));
  }
  return nodes;
}

function renderScriptCard(s) {
  const script = s.artifacts.script;
  if (!script) return null;
  const scriptStage = s.stages.find((x) => x.name === "script");
  const status = scriptStage ? scriptStage.status : "unknown";
  const stamp = status === "completed"
    ? el("span", { class: "script-status script-approved" }, t("APPROVED"))
    : status === "awaiting_human"
      ? el("span", { class: "script-status script-pending" }, t("PENDING APPROVAL"))
      : status === "in_progress"
        ? el("span", { class: "script-status script-draft" }, t("DRAFTING"))
        : null;

  const card = el("div", { class: "script-card script-preview", title: t("Click to expand full script"), onclick: openScriptModal },
    stamp,
    el("div", { class: "sp-title" }, script.title || s.title),
    el("div", { class: "sp-meta" },
      t("script · {d} · {n} sections", { d: fmtDuration(script.total_duration_seconds), n: (script.sections || []).length })),
    ...scriptSections(script, 4),
    el("span", { class: "sp-expand" }, t("⤢ EXPAND SCRIPT")),
  );
  return card;
}

function humanize(value) {
  const key = String(value || "artifact");
  const label = t(key);
  return label !== key ? label : key.replaceAll("_", " ");
}

function shortText(value, limit = 180) {
  const text = String(value || "").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function reviewFact(label, value) {
  if (value == null || value === "") return null;
  return el("div", { class: "approval-fact" },
    el("span", {}, t(label)),
    el("b", {}, value),
  );
}

function reviewFacts(items) {
  const facts = items.filter(Boolean);
  return facts.length ? el("div", { class: "approval-facts" }, facts) : null;
}

function titledItems(items, selectedId = null) {
  const rows = (items || []).slice(0, 4).map((item, index) => {
    if (item == null) return null;
    if (typeof item !== "object") {
      return el("li", {}, shortText(item));
    }
    const id = item.id || item.concept_id || item.option_id;
    const title = item.title || item.name || item.display_name || item.label || id || item.path || item.platform || item.description || t("Item {n}", { n: index + 1 });
    const detail = item.hook || item.why_this_works || item.summary || item.description || item.silhouette_notes;
    return el("li", { class: id && id === selectedId ? "selected" : "" },
      el("div", { class: "approval-item-title" }, shortText(title, 100),
        id && id === selectedId ? el("span", { class: "approval-selected" }, t("SELECTED")) : null),
      detail && detail !== title ? el("p", {}, shortText(detail)) : null,
    );
  }).filter(Boolean);
  return rows.length ? el("ul", { class: "approval-items" }, rows) : null;
}

function genericArtifactSummary(artifact) {
  const facts = [];
  const items = [];
  for (const [key, value] of Object.entries(artifact || {})) {
    if (["version", "decision_log_ref"].includes(key)) continue;
    if (["string", "number", "boolean"].includes(typeof value)) {
      facts.push(reviewFact(humanize(key), shortText(value, 90)));
    } else if (Array.isArray(value)) {
      facts.push(reviewFact(humanize(key), t("{n} item{s}", { n: value.length, s: plural(value.length) })));
      if (!items.length && value.length) items.push(titledItems(value));
    }
    if (facts.length >= 6) break;
  }
  return [reviewFacts(facts), ...items].filter(Boolean);
}

function artifactReviewContent(name, artifact) {
  if (name === "brief") {
    return [
      artifact.hook ? el("p", { class: "approval-lead" }, artifact.hook) : null,
      reviewFacts([
        reviewFact("platform", artifact.target_platform),
        reviewFact("duration", artifact.target_duration_seconds != null ? fmtDuration(artifact.target_duration_seconds) : null),
        reviewFact("tone", artifact.tone),
        reviewFact("style", artifact.style),
      ]),
      titledItems(artifact.key_points),
    ].filter(Boolean);
  }
  if (name === "proposal_packet") {
    const selected = (artifact.selected_concept || {}).concept_id;
    const plan = artifact.production_plan || {};
    const cost = artifact.cost_estimate || {};
    return [
      reviewFacts([
        reviewFact("runtime", plan.render_runtime),
        reviewFact("pipeline", plan.pipeline),
        reviewFact("estimated cost", cost.total_estimated_usd != null ? fmtMoney(cost.total_estimated_usd) : null),
        reviewFact("concepts", Array.isArray(artifact.concept_options) ? artifact.concept_options.length : null),
      ]),
      titledItems(artifact.concept_options, selected),
      (artifact.selected_concept || {}).rationale
        ? el("p", { class: "approval-rationale" },
          el("b", {}, t("WHY THIS CONCEPT  ")), shortText(artifact.selected_concept.rationale))
        : null,
    ].filter(Boolean);
  }
  if (name === "research_brief") {
    return [
      artifact.topic ? el("p", { class: "approval-lead" }, artifact.topic) : null,
      reviewFacts([
        reviewFact("sources", Array.isArray(artifact.sources) ? artifact.sources.length : null),
        reviewFact("data points", Array.isArray(artifact.data_points) ? artifact.data_points.length : null),
        reviewFact("angles", Array.isArray(artifact.angles_discovered) ? artifact.angles_discovered.length : null),
      ]),
      titledItems(artifact.angles_discovered),
    ].filter(Boolean);
  }
  if (name === "script") {
    const first = (artifact.sections || [])[0];
    return [
      reviewFacts([
        reviewFact("duration", fmtDuration(artifact.total_duration_seconds)),
        reviewFact("sections", (artifact.sections || []).length),
      ]),
      first && first.text ? el("p", { class: "approval-lead" }, shortText(first.text, 220)) : null,
      el("p", { class: "approval-guidance" }, t("The complete script preview is shown directly below.")),
    ].filter(Boolean);
  }
  if (name === "scene_plan") {
    const scenes = artifact.scenes || [];
    const end = scenes.reduce((max, scene) => Math.max(max, Number(scene.end_seconds) || 0), 0);
    return [
      reviewFacts([
        reviewFact("scenes", scenes.length),
        reviewFact("duration", end ? fmtDuration(end) : null),
      ]),
      titledItems(scenes),
      el("p", { class: "approval-guidance" }, t("Review timing and shot coverage in the storyboard below.")),
    ].filter(Boolean);
  }
  if (name === "asset_manifest") {
    const assets = artifact.assets || [];
    const types = [...new Set(assets.map((asset) => asset.type).filter(Boolean))];
    return [
      reviewFacts([
        reviewFact("assets", assets.length),
        reviewFact("types", types.join(", ")),
        reviewFact("generation cost", artifact.total_cost_usd != null ? fmtMoney(artifact.total_cost_usd) : null),
      ]),
      titledItems(assets),
      el("p", { class: "approval-guidance" }, t("Inspect every generated take in the filmstrip below before approving compose.")),
    ].filter(Boolean);
  }
  if (name === "edit_decisions") {
    return [
      reviewFacts([
        reviewFact("cuts", Array.isArray(artifact.cuts) ? artifact.cuts.length : null),
        reviewFact("runtime", artifact.render_runtime || (artifact.metadata || {}).render_runtime),
      ]),
      titledItems(artifact.cuts),
    ].filter(Boolean);
  }
  if (name === "render_report") {
    return [
      reviewFacts([
        reviewFact("outputs", Array.isArray(artifact.outputs) ? artifact.outputs.length : null),
        reviewFact("duration", artifact.duration_seconds != null ? fmtDuration(artifact.duration_seconds) : null),
      ]),
      titledItems(artifact.outputs),
    ].filter(Boolean);
  }
  if (name === "publish_log") {
    return [
      reviewFacts([reviewFact("destinations", Array.isArray(artifact.entries) ? artifact.entries.length : null)]),
      titledItems((artifact.entries || []).map((entry) => ({
        title: entry.platform || entry.destination || t("Publish destination"),
        description: [entry.status, entry.url].filter(Boolean).join(" · "),
      }))),
    ].filter(Boolean);
  }
  return genericArtifactSummary(artifact);
}

function artifactReviewTitle(name, artifact, s) {
  if (name === "proposal_packet") {
    const selected = (artifact.selected_concept || {}).concept_id;
    const concept = (artifact.concept_options || []).find((item) => item.id === selected);
    return (concept && concept.title) || t("Production proposal");
  }
  if (name === "research_brief") return artifact.topic || t("Research brief");
  if (name === "scene_plan") return t("Scene plan");
  if (name === "asset_manifest") return t("Generated assets");
  if (name === "edit_decisions") return t("Edit decisions");
  if (name === "render_report") return t("Render report");
  if (name === "publish_log") return t("Publish plan");
  return artifact.title || artifact.name || s.title;
}

function renderApprovalReview(s) {
  const awaiting = s.stages.find((item) => item.status === "awaiting_human");
  if (!awaiting) return null;

  const names = artifactNamesForStage(awaiting);
  const entries = names
    .filter((name) => name !== "decision_log")
    .map((name) => [name, s.artifacts[name]])
    .filter(([, artifact]) => artifact && typeof artifact === "object");
  const stageIndex = s.stages.findIndex((item) => item.name === awaiting.name);
  const nextStage = stageIndex >= 0 ? s.stages[stageIndex + 1] : null;
  const review = awaiting.review || {};
  const reviewSummary = reviewSummaryText(review);

  const artifacts = entries.map(([name, artifact]) => el("article", {
    class: "approval-artifact",
    "data-artifact": name,
  },
    el("div", { class: "approval-artifact-kicker" }, humanize(name)),
    el("h2", {}, artifactReviewTitle(name, artifact, s)),
    ...artifactReviewContent(name, artifact),
  ));

  if (!artifacts.length) {
    artifacts.push(el("div", { class: "approval-missing", role: "alert" },
      el("b", {}, t("Nothing reviewable was found. ")),
      names.length
        ? t("The {stage} checkpoint declares {names}, but Backlot could not load it.", { stage: t(awaiting.name), names: names.map(humanize).join(", ") })
        : t("The {stage} checkpoint does not declare an artifact.", { stage: t(awaiting.name) }),
    ));
  }

  return el("section", { class: "approval-review", "data-stage": awaiting.name },
    el("div", { class: "approval-review-head" },
      el("div", {},
        el("div", { class: "approval-eyebrow" }, t("REVIEW GATE")),
        el("h2", {}, t("{stage} is ready for your review", { stage: humanize(awaiting.name) })),
        el("p", {}, t("Review the artifact here, then reply in chat to approve it or request changes.")),
      ),
      el("span", { class: "approval-status" }, t("PENDING APPROVAL")),
    ),
    reviewSummary ? el("div", { class: "approval-review-note" },
      el("b", {}, t("SELF-REVIEW  ")), shortText(reviewSummary, 260)) : null,
    el("div", { class: "approval-artifacts" }, artifacts),
    el("div", { class: "approval-review-foot" },
      el("span", {}, nextStage
        ? t("Approval unlocks {stage}.", { stage: humanize(nextStage.name) })
        : t("This is the final approval gate.")),
      el("button", { type: "button", onclick: () => toggleDrawer(awaiting.name) }, t("OPEN FULL ARTIFACT")),
    ),
  );
}

function openScriptModal() {
  const script = state && state.artifacts.script;
  if (!script) return;
  modal.innerHTML = "";
  modal.append(
    el("span", { class: "modal-close", onclick: closeModal }, t("ESC · CLOSE")),
    el("div", { class: "modal-page" },
      el("div", { class: "script-card", style: "cursor:default" },
        el("div", { class: "sp-title" }, script.title || state.title),
        el("div", { class: "sp-meta" },
          t("script · {d} · {n} sections", { d: fmtDuration(script.total_duration_seconds), n: (script.sections || []).length })),
        ...scriptSections(script, 0),
        el("div", { class: "sp-fade" }, t("END")),
      )),
  );
  modal.classList.add("open");
}

function openNarrModal(card) {
  modal.innerHTML = "";
  const meta = [sceneLabel(card.id), card.section_label, fmtDuration(card.duration_seconds)]
    .filter(Boolean).join(" · ");
  modal.append(
    el("span", { class: "modal-close", onclick: closeModal }, t("ESC · CLOSE")),
    el("div", { class: "modal-page" },
      el("div", { class: "script-card", style: "cursor:default" },
        el("div", { class: "sp-meta" }, meta),
        card.narration ? el("div", { class: "sp-action", style: "margin-left:0" }, card.narration) : null,
        card.shot_intent ? el("div", { class: "sp-paren", style: "margin-left:0" }, t("Intent — {x}", { x: card.shot_intent })) : null,
        card.description ? el("div", { class: "sp-paren", style: "margin-left:0" }, card.description) : null,
      )),
  );
  modal.classList.add("open");
}

function closeModal() { modal.classList.remove("open"); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

// ---------------------------------------------------------------------------
// right rail: decisions, activity
// ---------------------------------------------------------------------------

function renderDecisions(s) {
  const log = s.artifacts.decision_log;
  const decisions = (log && log.decisions) || [];
  if (!decisions.length) return null;
  const body = el("div", { class: "panel-body" });
  // Collapse by category+subject: a decision that changed mid-run (e.g. voice
  // openai_onyx → chirp3) is superseded by the later entry — show the CURRENT
  // choice, not the first one recorded, and mark that it was revised.
  const current = new Map();
  decisions.forEach((d, i) => {
    const key = `${d.category || "decision"}::${d.subject || ""}`;
    const prev = current.get(key);
    current.set(key, { d, order: i, revised: prev ? prev.revised + 1 : 0 });
  });
  const shown = [...current.values()].sort((a, b) => b.order - a.order).slice(0, 8);
  for (const { d, revised } of shown) {
    const selLabel = (() => {
      // Prefer the human label of the selected option over its bare id.
      const opt = (d.options_considered || []).find((o) => (o.option_id ?? o.label) === d.selected);
      return (opt && opt.label) || d.selected || "";
    })();
    const alts = (d.options_considered || [])
      .filter((o) => (o.option_id ?? o.label) !== d.selected && (o.option_id || o.label));
    body.append(el("div", { class: "decision" },
      el("div", { class: "d-cat" }, `${d.category || t("decision")}${d.confidence ? ` · ${d.confidence}` : ""}`,
        revised ? el("span", { class: "d-revised" }, t(" · revised")) : null),
      el("div", { class: "d-pick" }, `${d.subject || ""} `, el("span", { class: "arrow" }, "→"), ` ${selLabel}`),
      d.reason ? el("div", { class: "d-why" }, d.reason) : null,
      alts.length ? el("div", { class: "d-alt" }, t("also considered: "),
        alts.slice(0, 3).map((o, i) => [i ? " · " : "", el("s", {}, o.label || o.option_id)]).flat()) : null,
    ));
  }
  return el("div", { class: "panel" },
    el("div", { class: "panel-head" }, el("h2", {}, t("Decisions")), el("span", { class: "meta" }, "decision_log.json")),
    body);
}

function renderActivity(s) {
  const events = s.events || [];
  if (!events.length) return null;
  const body = el("div", { class: "panel-body" });
  // A start is "running" only until a later finish/error for the same
  // tool+scene closes it — closed starts are dropped (the finish row tells
  // the story), unmatched starts render as live. Counted (not keyed-single)
  // so parallel runs of the same tool on the same scene stay visible.
  const open = new Map(); // key -> {count, ev}
  const rows = [];
  for (const ev of events) {
    const key = `${ev.tool}:${ev.scene_id || ""}`;
    if (ev.event === "start") {
      const slot = open.get(key) || { count: 0, ev };
      slot.count += 1;
      slot.ev = ev;
      open.set(key, slot);
    } else {
      const slot = open.get(key);
      if (slot) {
        slot.count -= 1;
        if (slot.count <= 0) open.delete(key);
      }
      rows.push(ev);
    }
  }
  for (const slot of open.values()) rows.push(slot.ev);
  rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  for (const ev of rows.slice(-10).reverse()) {
    let statusEl;
    if (ev.event === "finish") {
      statusEl = el("span", { class: `status ${ev.success === false ? "err" : "ok"}` },
        `${ev.success === false ? "✕" : "✓"}${ev.duration_s != null ? ` ${ev.duration_s.toFixed ? ev.duration_s.toFixed(1) : ev.duration_s}s` : ""}${ev.cost_usd ? ` ${fmtMoney(ev.cost_usd)}` : ""}`);
    } else if (ev.event === "error") {
      statusEl = el("span", { class: "status err" }, "✕");
    } else {
      statusEl = el("span", { class: "status run" }, t("● running"));
    }
    body.append(el("div", { class: "act-row" },
      el("span", { class: "t" }, fmtClock(ev.ts)),
      el("span", { class: "tool" }, ev.tool || ""),
      el("span", { class: "target" }, ev.scene_id || ""),
      statusEl,
    ));
  }
  return el("div", { class: "panel" },
    el("div", { class: "panel-head" }, el("h2", {}, t("Activity")), el("span", { class: "meta" }, "events.jsonl")),
    body);
}

// ---------------------------------------------------------------------------
// storyboard filmstrip
// ---------------------------------------------------------------------------

function sceneLabel(id) {
  // "sc4" → "SC 04", "scene-11" → "SC 11", anything else → uppercased id
  const m = String(id).match(/(\d+)\s*$/);
  if (m) return `SC ${m[1].padStart(2, "0")}`;
  return String(id).toUpperCase().slice(0, 10);
}

// ---------------------------------------------------------------------------
// per-shot detail view
// ---------------------------------------------------------------------------

const ASPECT_ROWS = [
  ["subject", "Subject"],
  ["subject_motion", "Subject Motion"],
  ["scene", "Scene"],
  ["spatial_framing", "Spatial Framing"],
  ["camera", "Camera"],
];
// Optional extras some analyses record alongside the five aspects.
const ASPECT_EXTRA_ROWS = [
  ["scene_overlays", "Overlays"],
  ["light", "Lighting"],
  ["transition", "Transition"],
  ["beat", "Beat"],
  ["source", "Footage source"],
];

function humanizeRole(value) {
  if (!value) return "";
  const zh = t(value);
  // t() returns the key unchanged when no translation exists — humanise the
  // raw identifier so English mode never shows "introduce_subject".
  if (zh !== value) return zh;
  return String(value).replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

// Shot-spec vocabulary is stored as raw enum values ("close_up",
// "tungsten_warm"). Translate them in Chinese mode and keep the readable
// English form otherwise.
function techLabel(value) {
  if (value == null || value === "") return "";
  const raw = String(value);
  const zh = t(raw);
  if (zh !== raw) return zh;
  return raw.replace(/^dof_/, "").replaceAll("_", " ");
}

function detailField(label, value) {
  if (value == null || value === "" || value === "N/A") return null;
  return el("div", { class: "sd-field" },
    el("div", { class: "sd-label" }, t(label)),
    el("div", { class: "sd-value" }, String(value)));
}

// ---------------------------------------------------------------------------
// shot drawer: right-side panel with a segment player + dense breakdown.
// Lives outside #app so a full board re-render (SSE refresh) never resets
// playback or closes it.
// ---------------------------------------------------------------------------

let openSceneId = null;
let drawerProject = null;
const shotDrawer = el("div", { class: "shot-drawer", "aria-hidden": "true" });
const shotBackdrop = el("div", { class: "shot-backdrop", onclick: () => closeSceneDetail() });
document.body.append(shotBackdrop, shotDrawer);

const seg = { start: 0, end: 0, raf: 0, armed: false };
let segVideo = null;      // persistent <video>, reused across shots
let segVideoSrc = null;

function fmtTC(sec) {
  const n = Math.max(0, Number(sec) || 0);
  const m = Math.floor(n / 60);
  const s = n - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

function boardScenes() {
  return (state && state.storyboard && state.storyboard.scenes) || [];
}

function closeSceneDetail() {
  if (!openSceneId) return;
  openSceneId = null;
  if (segVideo) segVideo.pause();
  cancelAnimationFrame(seg.raf);
  shotDrawer.classList.remove("open");
  shotBackdrop.classList.remove("open");
  shotDrawer.setAttribute("aria-hidden", "true");
  markActiveCard();
}

function stepScene(delta) {
  const scenes = boardScenes();
  const i = scenes.findIndex((c) => c.id === openSceneId);
  const next = scenes[i + delta];
  if (next) openSceneDetail(state, next);
}

function markActiveCard() {
  document.querySelectorAll(".scene-card.active").forEach((n) => n.classList.remove("active"));
  if (!openSceneId) return;
  const node = document.querySelector(`.scene-card[data-scene="${CSS.escape(openSceneId)}"]`);
  if (node) {
    node.classList.add("active");
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function segTick() {
  const v = segVideo;
  if (!v) return;
  if (seg.armed && v.currentTime >= seg.end - 1 / 60) {
    v.pause();
    v.currentTime = seg.end;
    seg.armed = false;
  }
  updateSegUI();
  if (!v.paused) seg.raf = requestAnimationFrame(segTick);
}

function updateSegUI() {
  const v = segVideo;
  const bar = shotDrawer.querySelector(".seg-bar");
  if (!v || !bar) return;
  const total = v.duration || (state.storyboard && state.storyboard.total_duration_seconds) || 1;
  bar.querySelector(".seg-range").style.left = `${(seg.start / total) * 100}%`;
  bar.querySelector(".seg-range").style.width = `${Math.max(0.3, ((seg.end - seg.start) / total) * 100)}%`;
  bar.querySelector(".seg-head").style.left = `${(v.currentTime / total) * 100}%`;
  const btn = shotDrawer.querySelector(".seg-play");
  if (btn) btn.textContent = v.paused ? t("▶ Play shot") : t("❚❚ Pause");
  const now = shotDrawer.querySelector(".seg-now");
  if (now) now.textContent = `${fmtTC(v.currentTime)} / ${fmtTC(total)}`;
}

function toggleSegment() {
  const v = segVideo;
  if (!v) return;
  if (!v.paused) { v.pause(); return; }
  if (v.currentTime < seg.start - 0.05 || v.currentTime >= seg.end - 0.05) v.currentTime = seg.start;
  seg.armed = true;
  v.play();
}

function seekBar(e) {
  const v = segVideo;
  const bar = e.currentTarget;
  if (!v || !v.duration) return;
  const r = bar.getBoundingClientRect();
  v.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * v.duration;
  // Scrubbing outside the shot means the user wants free playback there.
  seg.armed = v.currentTime >= seg.start && v.currentTime < seg.end;
  updateSegUI();
}

function ensureSegVideo(s) {
  const src = s.storyboard && s.storyboard.source_video;
  if (!src) return null;
  const url = mediaURL(s.project_id, src);
  if (!segVideo || segVideoSrc !== url) {
    segVideo = el("video", { src: url, preload: "auto", playsinline: "" });
    segVideoSrc = url;
    segVideo.addEventListener("play", () => { cancelAnimationFrame(seg.raf); seg.raf = requestAnimationFrame(segTick); });
    segVideo.addEventListener("pause", updateSegUI);
    segVideo.addEventListener("seeked", updateSegUI);
    segVideo.addEventListener("loadedmetadata", () => {
      if (segVideo.currentTime < seg.start || segVideo.currentTime > seg.end) segVideo.currentTime = seg.start;
      updateSegUI();
    });
    segVideo.addEventListener("click", toggleSegment);
  }
  return segVideo;
}

function renderPlayer(s, card) {
  const v = ensureSegVideo(s);
  if (!v) {
    return el("div", { class: "seg-player missing" },
      card.visual && card.visual.exists ? el("img", { src: mediaURL(s.project_id, card.visual.path), alt: "" }) : null,
      el("div", { class: "seg-missing" },
        t("Source video not found — put the reference video in the project's source/ folder.")));
  }
  v.pause();
  seg.start = Number(card.start_seconds) || 0;
  seg.end = Number(card.end_seconds) || seg.start;
  seg.armed = false;
  if (card.visual && card.visual.exists) v.poster = mediaURL(s.project_id, card.visual.path);
  if (v.readyState >= 1) v.currentTime = seg.start;

  const bar = el("div", { class: "seg-bar", onclick: seekBar, title: t("Click to seek") },
    el("div", { class: "seg-range" }), el("div", { class: "seg-head" }));
  return el("div", { class: "seg-player" },
    el("div", { class: "seg-frame" }, v),
    bar,
    el("div", { class: "seg-ctrl" },
      el("button", { type: "button", class: "seg-play", onclick: toggleSegment }, t("▶ Play shot")),
      el("span", { class: "seg-span" }, `${fmtTC(seg.start)} – ${fmtTC(seg.end)}`),
      el("span", { class: "seg-now" }, "")));
}

function openSceneDetail(s, card) {
  openSceneId = card.id;
  drawerProject = s.project_id;
  const d = card.details || {};
  const aspects = d.aspects || {};
  const sl = d.shot_language || card.shot_language || {};
  const scenes = boardScenes();
  const idx = scenes.findIndex((c) => c.id === card.id);

  const chips = [
    sl.shot_size, sl.camera_movement,
    sl.lens_mm ? `${sl.lens_mm}mm` : null,
    sl.lighting_key, sl.depth_of_field ? `dof_${sl.depth_of_field}` : null, sl.color_temperature,
  ].filter(Boolean);

  const design = [
    detailField("Shot intent", d.shot_intent || card.shot_intent),
    detailField("Information role", d.information_role),
    detailField("Framing", d.framing || card.framing),
    detailField("Movement", d.movement || card.movement),
    detailField("Overlays", d.overlay_notes),
  ].filter(Boolean);

  const aspectNodes = [...ASPECT_ROWS, ...ASPECT_EXTRA_ROWS]
    .map(([key, label]) => detailField(label, aspects[key]))
    .filter(Boolean);

  const info = el("div", { class: "sd-info" },
    card.description ? el("p", { class: "sd-desc" }, card.description) : null,
    chips.length ? el("div", { class: "sd-chips" }, chips.map((c) => el("span", { class: "sd-chip" }, techLabel(c)))) : null,
    card.narration ? el("div", { class: "sd-block" },
      el("div", { class: "sd-heading" }, t("Dialogue")),
      el("div", { class: "sd-dialogue" }, card.narration)) : null,
    design.length ? el("div", { class: "sd-block" },
      el("div", { class: "sd-heading" }, t("Shot design")),
      el("div", { class: "sd-grid two" }, design)) : null,
    card.required_assets.length ? el("div", { class: "sd-block" },
      el("div", { class: "sd-heading" }, t("Required assets")),
      el("div", { class: "sd-assets" }, card.required_assets.map((a) => el("div", { class: "sd-asset" },
        el("span", { class: "sd-chip" }, techLabel(a.type)), el("span", {}, a.description || ""))))) : null,
  );

  shotDrawer.innerHTML = "";
  shotDrawer.append(
    el("div", { class: "sd-bar" },
      el("span", { class: "sd-meta" }, `${sceneLabel(card.id)} · ${fmtTC(card.start_seconds)} – ${fmtTC(card.end_seconds)} · ${fmtDuration(card.duration_seconds) || ""}`),
      el("h2", { class: "sd-title" }, humanizeRole(d.narrative_role) || humanizeRole(card.type)),
      card.hero_moment ? el("span", { class: "sd-herochip" }, t("★ HERO")) : null,
      el("span", { class: "sd-spacer" }),
      el("span", { class: "sd-pos" }, `${idx + 1} / ${scenes.length}`),
      el("button", { type: "button", class: "sd-nav", disabled: idx <= 0 ? "" : null, onclick: () => stepScene(-1) }, t("← Prev")),
      el("button", { type: "button", class: "sd-nav", disabled: idx >= scenes.length - 1 ? "" : null, onclick: () => stepScene(1) }, t("Next →")),
      el("button", { type: "button", class: "sd-nav close", onclick: closeSceneDetail }, t("ESC · CLOSE"))),
    el("div", { class: "sd-top" }, renderPlayer(s, card), info),
    aspectNodes.length
      ? el("div", { class: "sd-block sd-aspects" },
        el("div", { class: "sd-heading" }, t("Five-aspect breakdown")),
        el("div", { class: "sd-grid three" }, aspectNodes))
      : el("div", { class: "hint" }, t("This shot has no authored breakdown — add aspects to the brief or scene plan.")),
  );
  shotDrawer.classList.add("open");
  shotBackdrop.classList.add("open");
  shotDrawer.setAttribute("aria-hidden", "false");
  shotDrawer.scrollTop = 0;
  updateSegUI();
  markActiveCard();
}

document.addEventListener("keydown", (e) => {
  if (!openSceneId) return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.key === "Escape") { closeSceneDetail(); e.stopImmediatePropagation(); }
  else if (e.key === "ArrowRight") { stepScene(1); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { stepScene(-1); e.preventDefault(); }
  else if (e.key === " ") { toggleSegment(); e.preventDefault(); }
}, true);

function sceneCard(s, card) {
  const dur = card.duration_seconds;
  const wrap = el("div", {
    class: `scene-card${card.id === openSceneId ? " active" : ""}`,
    "data-scene": card.id,
    title: t("Open shot detail"),
    onclick: () => openSceneDetail(s, card),
  });

  const slate = el("div", { class: "sc-slate" },
    el("span", { class: "num" }, sceneLabel(card.id)),
    card.takes.length > 1 ? el("span", { class: "take" }, `T${card.takes.length}`) : null,
    card.hero_moment ? el("span", { class: "hero" }, t("★ HERO")) : null,
    el("span", { class: "dur" }, fmtDuration(dur)),
  );
  wrap.append(slate);

  // visual slot
  let thumb;
  if (card.generating) {
    thumb = el("div", { class: "thumb generating" },
      el("div", { class: "shimmer" }),
      el("div", { class: "gen-label" },
        el("span", {}, t("◉ GENERATING")),
        el("span", { class: "sub" }, card.generating_tool || "")));
  } else if (card.visual && card.visual.exists) {
    const v = card.visual;
    const badge = [v.model || v.source_tool, v.cost_usd != null ? fmtMoney(v.cost_usd) : null,
      v.quality_score != null ? `q ${v.quality_score}` : null].filter(Boolean).join(" · ");
    if (v.type === "video") {
      thumb = el("div", { class: "thumb approved" },
        el("video", { src: mediaURL(s.project_id, v.path), muted: "", preload: "metadata", playsinline: "" }),
        el("span", { class: "play" }, "▶"),
        badge ? el("span", { class: "badge" }, badge) : null);
      thumb.onclick = (e) => {
        e.stopPropagation();
        const vid = thumb.querySelector("video");
        if (vid.paused) vid.play(); else vid.pause();
      };
    } else {
      const img = el("img", { src: thumbURL(s.project_id, v.path, 640), loading: "lazy", alt: "" });
      // A thumbnail that fails to load must never show a broken-image icon —
      // fall back to the shot spec in place (F: broken links).
      img.onerror = () => {
        const t = img.closest(".thumb");
        if (!t) return;
        t.className = "thumb spec";
        t.innerHTML = "";
        t.append(el("div", { class: "spec-in" },
          el("div", { class: "spec-desc" }, card.description || t("asset unavailable")),
          el("div", { class: "spec-shot" }, [card.framing, card.movement].filter(Boolean).join(" · ").slice(0, 70))));
      };
      thumb = el("div", { class: "thumb approved" }, img,
        v.snapshot ? el("span", { class: "badge" }, t("snapshot")) : (badge ? el("span", { class: "badge" }, badge) : null));
    }
  } else if (card.type === "animation") {
    // Bespoke/atelier scene with no snapshot yet — name it as such rather
    // than "no asset yet" (the composition IS the asset).
    thumb = el("div", { class: "thumb spec bespoke" },
      el("div", { class: "spec-in" },
        el("span", { class: "bespoke-tag" }, t("◆ BESPOKE")),
        el("div", { class: "spec-desc" }, card.description || ""),
        el("div", { class: "spec-shot" }, t("hand-authored composition"))));
  } else if (card.visual && !card.visual.exists) {
    thumb = el("div", { class: "thumb missing" },
      el("div", { class: "spec-in" },
        el("span", { class: "warn-ic" }, "⚑"),
        el("div", { class: "spec-desc" }, t("asset in manifest, file missing")),
        el("div", { class: "spec-shot" }, card.visual.path || "")));
  } else if (card.type === "text_card") {
    thumb = el("div", { class: "thumb textcard" },
      el("div", { class: "tc-copy" }, (card.narration || card.description || "").slice(0, 48)));
  } else if (card.required_assets.length) {
    thumb = el("div", { class: "thumb missing" },
      el("div", { class: "spec-in" },
        el("span", { class: "warn-ic" }, "⚑"),
        el("div", { class: "spec-desc" }, t("no asset yet")),
        el("div", { class: "spec-shot" }, (card.required_assets[0].description || "").slice(0, 60))));
  } else {
    thumb = el("div", { class: "thumb spec" },
      el("div", { class: "spec-in" },
        el("div", { class: "spec-desc" }, card.description || ""),
        el("div", { class: "spec-shot" }, [card.framing, card.movement].filter(Boolean).join(" · ").slice(0, 70))));
  }
  wrap.append(thumb);


  // shot language chips
  const sl = card.shot_language;
  if (sl) {
    wrap.append(el("div", { class: "shotchips", style: "display:flex;flex-wrap:wrap;gap:4px;padding:7px 2px 0" },
      [sl.shot_size, sl.camera_movement, sl.lens_mm ? `${sl.lens_mm}mm` : null, sl.lighting_key]
        .filter(Boolean)
        .map((t) => el("span", { style: "font-family:var(--mono);font-size:calc(8.5px * var(--fs-scale));letter-spacing:.04em;color:#62626c;border:1px solid #212129;border-radius:3px;padding:1px 5px" }, techLabel(t)))));
  }

  // takes drawer
  if (card.takes.length > 1) {
    const takes = el("div", { class: "takes" });
    card.takes.forEach((t, i) => {
      const isActive = card.visual && (
        t === card.visual
        || (t.path && t.path === card.visual.path)
        || (t.id && t.id === card.visual.id)
      );
      const tk = el("span", { class: `tk${isActive ? " active" : ""}`, title: t("take {n}", { n: i + 1 }) });
      if (t.exists && t.type === "image") tk.append(el("img", { src: thumbURL(s.project_id, t.path, 320), loading: "lazy", alt: "" }));
      takes.append(tk);
    });
    takes.append(el("span", { class: "tk-label" }, t("{n} TAKES", { n: card.takes.length })));
    wrap.append(takes);
  }

  // narration + audio — clickable to read in full (F: narration text cut off)
  if (card.narration) {
    const long = card.narration.length > 90;
    wrap.append(el("div", {
      class: `narr${long ? " clip" : ""}`,
      title: t("Click to read the full narration"),
      onclick: (e) => { e.stopPropagation(); openSceneDetail(s, card); },
    }, card.narration, long ? el("span", { class: "narr-more" }, "⤢") : null));
  } else if (card.shot_intent || card.description) {
    wrap.append(el("div", { class: "narr tc-note" }, (card.shot_intent || card.description || "").slice(0, 110)));
  }
  const narrAudio = card.audio.find((a) => a.exists && (a.type === "narration" || a.type === "audio"));
  if (narrAudio) {
    const wave = el("div", { class: "wave", style: "cursor:pointer", title: t("Play narration") });
    waveBars(wave, card.id + narrAudio.path);
    wave.append(el("span", { class: "wv-time" }, narrAudio.duration_seconds ? fmtDuration(narrAudio.duration_seconds) : "♪"));
    wave.onclick = (e) => {
      e.stopPropagation();
      player.src = mediaURL(s.project_id, narrAudio.path);
      player.play();
    };
    wrap.append(wave);
  }
  return wrap;
}

function renderStoryboard(s) {
  const board = s.storyboard;
  if (!board) return null;
  const strip = el("div", { class: "filmstrip grid" });
  for (const card of board.scenes) strip.append(sceneCard(s, card));
  return el("div", { class: "storyboard-wide" },
    el("div", { class: "section-title" }, t("Storyboard"),
      el("span", { class: "meta" },
        t("{n} scenes{d} · click a shot for details", { n: board.scenes.length, d: board.total_duration_seconds ? ` · ${fmtDuration(board.total_duration_seconds)}` : "" }))),
    el("div", { class: "strip-outer" }, strip));
}

// ---------------------------------------------------------------------------
// renders + degraded media
// ---------------------------------------------------------------------------

function renderRenders(s) {
  const renders = s.media.renders;
  if (!renders.length) return null;
  if (activeRender >= renders.length) activeRender = 0;
  const current = renders[activeRender];
  // Full re-renders (every SSE refresh) must not reset an in-progress
  // watch: carry playback position/state over to the recreated element.
  const prev = document.querySelector(".render-hero video");
  const src = mediaURL(s.project_id, current.path);
  // preload="metadata" gives the element its intrinsic aspect ratio (and a
  // poster frame) before playback — without it a portrait 9:16 render sits
  // in a letterboxed 100%-wide black box that reads as landscape.
  const video = el("video", { src, controls: "", preload: "metadata" });
  // Click the frame to start playback (controls handle pause/scrub) — the
  // big player was inert to a click on the picture itself.
  video.addEventListener("click", () => { if (video.paused) video.play().catch(() => {}); });
  if (prev && prev.getAttribute("src") === src && (prev.currentTime > 0 || !prev.paused)) {
    const t = prev.currentTime;
    const wasPlaying = !prev.paused && !prev.ended;
    video.addEventListener("loadedmetadata", () => { video.currentTime = t; }, { once: true });
    video.setAttribute("preload", "metadata");
    if (wasPlaying) video.autoplay = true;
  }
  const versions = el("div", { class: "render-meta" },
    renders.map((r, i) => el("span", {
      class: `v${i === activeRender ? " active" : ""}`,
      onclick: () => { activeRender = i; render(); },
    }, `${r.path.split("/").pop()}${r.at_root ? ` · ${t("root")}` : ""}`)),
    el("span", { style: "margin-left:auto" }, `${(current.size / 1048576).toFixed(1)} MB`),
  );
  return el("div", {},
    el("div", { class: "section-title" }, t("Renders"),
      el("span", { class: "meta" }, t("{n} version{s}", { n: renders.length, s: plural(renders.length) }))),
    el("div", { class: "render-hero" }, video),
    versions);
}

function renderFoundMedia(s) {
  // Degraded view: show discovered snapshots when there's no storyboard.
  if (s.storyboard || !s.media.snapshots.length) return null;
  const grid = el("div", { class: "found-grid" });
  for (const snap of s.media.snapshots.slice(0, 12)) {
    grid.append(el("div", { class: "thumb" },
      el("img", { src: thumbURL(s.project_id, snap.path, 640), loading: "lazy", alt: "" })));
  }
  return el("div", {},
    el("div", { class: "section-title" }, t("What the watcher found"),
      el("span", { class: "meta" }, t("snapshots / verification frames"))),
    grid);
}

function renderNoState(s) {
  if (s.has_pipeline_state) return null;
  return el("div", { class: "notice", style: "border-color:#2b2b33;background:var(--surface-2);color:var(--text-3)" },
    el("span", { style: "font-size:calc(15px * var(--fs-scale))" }, "◌"),
    el("span", {},
      el("b", { style: "color:var(--text-2)" }, t("No pipeline state. ")),
      t("This project has no checkpoints — Backlot is showing what it found on disk. "),
      t("Runs that follow the checkpoint protocol get the full board.")));
}

function renderAwaitingNotice(s) {
  const awaiting = s.stages.find((x) => x.status === "awaiting_human");
  if (!awaiting) return null;
  return el("div", { class: "notice" },
    el("span", { style: "font-size:calc(16px * var(--fs-scale))" }, "◈"),
    el("span", {},
      el("b", {}, t("The {stage} stage is waiting for your review. ", { stage: t(awaiting.name) })),
      t("The agent is paused at this gate — reply "), el("b", {}, t("in chat")), t(" to approve or request changes.")));
}

// ---------------------------------------------------------------------------
// replay — scrub a completed run from its timestamps
// ---------------------------------------------------------------------------

// Python writers emit tz-aware UTC isoformat, but treat tz-naive strings as
// UTC too — mixing local-parsed and UTC-parsed timestamps would skew replay
// ordering by the user's UTC offset.
const ts = (iso) => {
  if (!iso) return null;
  let s = String(iso);
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += "Z";
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

function replayBounds(s) {
  const moments = [];
  for (const st of s.stages) {
    for (const h of st.history_entries || []) {
      const t = ts(h.timestamp);
      if (t) moments.push(t);
    }
  }
  for (const ev of s.events || []) {
    const t = ts(ev.ts);
    if (t) moments.push(t);
  }
  if (moments.length < 2) return null;
  return { t0: Math.min(...moments), t1: Math.max(...moments) };
}

function stateAt(s, T) {
  const view = structuredClone(s);
  for (const st of view.stages) {
    const past = (st.history_entries || []).filter((h) => ts(h.timestamp) != null && ts(h.timestamp) <= T);
    if (!past.length) {
      st.status = "pending"; st.review = null; st.timestamp = null;
      st.gate_skipped = false; st.partial_progress = null;
    } else {
      const cur = past[past.length - 1];
      st.status = cur.status || "pending";
      st.timestamp = cur.timestamp;
    }
  }
  view.events = (view.events || []).filter((ev) => ts(ev.ts) != null && ts(ev.ts) <= T);

  // Storyboard: visuals appear as their scene finishes (events) or when the
  // assets stage has completed as of T (legacy runs without events).
  if (view.storyboard) {
    const assetsStage = view.stages.find((x) => x.name === "assets");
    const assetsDone = assetsStage && assetsStage.status === "completed";
    const finished = new Set();
    const startedNow = new Map();
    for (const ev of view.events) {
      if (!ev.scene_id) continue;
      if (ev.event === "finish") { finished.add(ev.scene_id); startedNow.delete(ev.scene_id); }
      else if (ev.event === "start") startedNow.set(ev.scene_id, ev);
      else if (ev.event === "error") startedNow.delete(ev.scene_id);
    }
    const scenePlanStage = view.stages.find((x) => x.name === "scene_plan");
    const scenePlanDone = scenePlanStage && ["completed", "awaiting_human"].includes(scenePlanStage.status);
    if (!scenePlanDone) {
      view.storyboard = null;
    } else {
      for (const card of view.storyboard.scenes) {
        const visible = assetsDone || finished.has(card.id);
        if (!visible) { card.visual = null; card.takes = []; card.audio = []; }
        card.generating = startedNow.has(card.id);
        card.generating_tool = (startedNow.get(card.id) || {}).tool;
      }
    }
  }
  // Final artifacts hide until their stage happened — for every project
  // shape, storyboard or not (a degraded run must not show the finished
  // movie before its stages ran).
  const scriptStage = view.stages.find((x) => x.name === "script");
  if (!(scriptStage && ["completed", "awaiting_human"].includes(scriptStage.status))) {
    delete view.artifacts.script;
  }
  const composeStage = view.stages.find((x) => x.name === "compose");
  if (!(composeStage && composeStage.status === "completed")) {
    view.media.renders = [];
  }
  return view;
}

function renderReplayBar(s) {
  const bounds = replayBounds(s);
  if (!bounds) return null;
  if (!replay) {
    // collapsed: just the entry button
    return el("div", { class: "replay-bar", style: "justify-content:flex-end" },
      el("span", { class: "rp-time" }, t("scrub the whole run")),
      el("span", { class: "rp-btn", onclick: startReplay }, t("▶ REPLAY RUN")));
  }
  const pos = (replay.t - replay.t0) / Math.max(1, replay.t1 - replay.t0);
  const timeLabel = el("span", { class: "rp-time" },
    new Date(replay.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  const setT = (value) => {
    replay.t = replay.t0 + (Number(value) / 1000) * (replay.t1 - replay.t0);
    timeLabel.textContent = new Date(replay.t)
      .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  return el("div", { class: "replay-bar" },
    el("span", { class: "rp-btn", onclick: toggleReplayPlay }, replay.playing ? "❚❚" : "▶"),
    el("input", {
      type: "range", min: "0", max: "1000", value: String(Math.round(pos * 1000)),
      // A full render() would destroy this slider mid-drag: while dragging,
      // only pause + track the time label; re-render the board on release.
      onpointerdown: () => { replay.playing = false; },
      oninput: (e) => setT(e.target.value),
      onchange: (e) => { setT(e.target.value); render(); },
    }),
    timeLabel,
    el("span", { class: "rp-btn", onclick: stopReplay }, t("✕ LIVE")),
  );
}

let replayTimer = null;

function startReplay() {
  const bounds = replayBounds(state);
  if (!bounds) return;
  replay = { ...bounds, t: bounds.t0, playing: true };
  document.body.classList.add("replaying");
  scheduleTick();
  render();
}

function stopReplay() {
  replay = null;
  clearTimeout(replayTimer);
  document.body.classList.remove("replaying");
  render();
}

function toggleReplayPlay() {
  if (!replay) return;
  replay.playing = !replay.playing;
  if (replay.playing) scheduleTick();
  render();
}

function scheduleTick() {
  // Single pending tick, ever — rapid pause/play must not stack chains.
  clearTimeout(replayTimer);
  replayTimer = setTimeout(tickReplay, 100);
}

function tickReplay() {
  if (!replay || !replay.playing) return;
  // A full run replays in ~20 seconds regardless of real duration
  // (10 renders/second — full re-render per tick, keep it modest).
  const step = (replay.t1 - replay.t0) / 200;
  replay.t = Math.min(replay.t1, replay.t + step);
  if (replay.t >= replay.t1) replay.playing = false;
  render();
  if (replay.playing) scheduleTick();
}

// ---------------------------------------------------------------------------
// page assembly
// ---------------------------------------------------------------------------

function render() {
  if (!state) return;
  const s = replay ? stateAt(state, replay.t) : state;
  document.title = `Backlot — ${s.title}`;
  document.body.classList.toggle("first", firstPaint);
  firstPaint = false;
  // The storyboard grid scrolls on its own; a full rebuild must not jump it
  // back to the first row while the user is browsing shots.
  const prevGrid = document.querySelector(".filmstrip.grid");
  const gridScroll = prevGrid ? prevGrid.scrollTop : 0;
  app.innerHTML = "";
  app.append(renderSlate(s));
  app.append(renderRail(s));
  const replayBar = renderReplayBar(state);
  if (replayBar) app.append(replayBar);
  const drawer = renderDrawer(s);
  if (drawer) app.append(drawer);
  const awaitingNotice = renderAwaitingNotice(s);
  if (awaitingNotice) app.append(awaitingNotice);
  const noState = renderNoState(s);
  if (noState) app.append(noState);

  const main = el("div", { class: "main-col" });
  const approvalReview = renderApprovalReview(s);
  if (approvalReview) main.append(approvalReview);
  const script = renderScriptCard(s);
  if (script) main.append(script);
  const aside = el("aside", {});
  const decisions = renderDecisions(s);
  const activity = renderActivity(s);
  if (decisions) aside.append(decisions);
  if (activity) aside.append(activity);

  // Media sections live INSIDE the main column so a tall decisions rail
  // never pushes them below the fold — the column flows beside the rail.
  const storyboard = renderStoryboard(s);
  const found = renderFoundMedia(s);
  const renders = renderRenders(s);

  if (approvalReview || script || decisions || activity) {
    for (const section of [found, renders]) {
      if (section) main.append(section);
    }
    const hasAside = Boolean(decisions || activity);
    app.append(el("div", { class: `board${hasAside ? "" : " solo"}` }, main, hasAside ? aside : null));
    // Full width: the grid needs the whole viewport, not the main column.
    if (storyboard) app.append(storyboard);
  } else {
    for (const section of [storyboard, found, renders]) {
      if (section) app.append(section);
    }
  }
  const grid = document.querySelector(".filmstrip.grid");
  if (grid && gridScroll) grid.scrollTop = gridScroll;
}

// Defensive normalization (F-02): the server contract guarantees these
// fields, but a sparse/legacy payload must degrade, never crash the board.
function normalize(s) {
  s.pipeline = s.pipeline || { pipeline_type: "unknown", stages: [], known: false };
  s.stages = Array.isArray(s.stages) ? s.stages : [];
  for (const stage of s.stages) {
    stage.produces = Array.isArray(stage.produces) ? stage.produces : [];
  }
  s.artifacts = s.artifacts || {};
  s.media = s.media || {};
  s.media.renders = Array.isArray(s.media.renders) ? s.media.renders : [];
  s.media.snapshots = Array.isArray(s.media.snapshots) ? s.media.snapshots : [];
  s.media.music = Array.isArray(s.media.music) ? s.media.music : [];
  s.events = Array.isArray(s.events) ? s.events : [];
  if (s.storyboard && Array.isArray(s.storyboard.scenes)) {
    for (const c of s.storyboard.scenes) {
      c.takes = Array.isArray(c.takes) ? c.takes : [];
      c.audio = Array.isArray(c.audio) ? c.audio : [];
      c.required_assets = Array.isArray(c.required_assets) ? c.required_assets : [];
    }
  } else {
    s.storyboard = null;
  }
  return s;
}

async function refresh() {
  state = normalize(await getJSON(`/api/project/${encodeURIComponent(projectId)}/state`));
  render();
}

refresh().catch((err) => {
  app.innerHTML = "";
  app.append(el("div", { class: "empty", style: "margin-top:80px" },
    el("div", { class: "big" }, t("PROJECT NOT FOUND")),
    el("div", {}, String(err))));
});
// ?static=1 disables the live feed (screenshots, static exports).
if (!new URLSearchParams(location.search).has("static")) {
  subscribe(`/api/project/${encodeURIComponent(projectId)}/events`, () => refresh().catch(console.error));
}
