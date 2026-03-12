import type {
  AutonomousTaskOptions,
  PipelineResult,
  PipelineStep,
  SubAgentResult,
  Message,
} from "../../types/index.js";
import { resolveConfig } from "../config/configResolver.js";
import { loadAgentConfig } from "../agents/agentManager.js";
import { readSoul } from "../soul/soulInjector.js";
import { callProvider } from "../providers/providerRouter.js";
import { loadSkills } from "../skills/skillLoader.js";
import { loadTools } from "../tools/toolLoader.js";
import { createMemoryTools } from "../memory/memoryTools.js";
import { createPlanTools } from "../memory/planTools.js";
import { createSubAgentTools } from "../subagent/subagentTools.js";

// ── Structured logging ─────────────────────────────────────────────────────
const log  = (...args: unknown[]) => console.log("[pipeline:autonomous]",  ...args);
const logW = (...args: unknown[]) => console.warn("[pipeline:autonomous]",  ...args);
const logE = (...args: unknown[]) => console.error("[pipeline:autonomous]", ...args);

// ── Tag extraction helpers ─────────────────────────────────────────────────

/**
 * Return the text inside the *first* <final_answer>…</final_answer> block, or
 * null if no such block is present.
 */
function extractFinalAnswer(text: string): string | null {
  const m = text.match(/<final_answer>([\s\S]*?)<\/final_answer>/i);
  return m ? m[1].trim() : null;
}

/**
 * Return ALL parsed tool calls from every <tool_call>…</tool_call> block in
 * the text.  Returns an empty array if none are found or all are malformed.
 *
 * Per Anthropic's agentic best practices, a single model turn may legitimately
 * request multiple tool calls (e.g. parallel filesystem reads).  Extracting
 * all of them ensures every call is honoured instead of silently discarding
 * all but the first.
 */
function extractAllToolCalls(
  text: string,
): Array<{ name: string; input: Record<string, unknown> }> {
  const results: Array<{ name: string; input: Record<string, unknown> }> = [];
  const pattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && typeof parsed.name === "string") {
        results.push(parsed);
      } else {
        logW("Malformed tool_call block (missing 'name'):", m[1].trim().slice(0, 120));
      }
    } catch {
      logW("Failed to parse tool_call JSON:", m[1].trim().slice(0, 120));
    }
  }
  return results;
}

/**
 * Strip thinking tags that some models wrap their reasoning in (e.g.
 * `<think>…</think>` or `<thinking>…</thinking>`).  Returns the visible
 * content and any extracted thinking text.
 */
function stripThinkingTags(text: string): { content: string; thinking: string } {
  let thinking = "";
  const cleaned = text.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_m, inner) => {
    thinking += (thinking ? "\n" : "") + inner.trim();
    return "";
  });
  return { content: cleaned.trim(), thinking };
}
// ── Tool-call input validator ────────────────────────────────────────────────────

/**
 * Validates a tool call’s input object against the tool’s inputSchema.
 * Checks required fields and, where provided, type / enum constraints.
 * Returns an array of human-readable error strings; empty means valid.
 */
function validateToolInput(
  input: Record<string, unknown>,
  inputSchema: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const properties = inputSchema.properties as Record<string, Record<string, unknown>> | undefined;
  const required   = inputSchema.required   as string[] | undefined;

  // Required-field check.
  if (required) {
    for (const field of required) {
      if (input[field] === undefined || input[field] === null) {
        errors.push(`Missing required field: "${field}"`);
      }
    }
  }

  // Per-property type / enum checks.
  if (properties) {
    for (const [key, schema] of Object.entries(properties)) {
      if (input[key] === undefined) continue;

      const allowedValues = schema.enum as unknown[] | undefined;
      if (allowedValues && !allowedValues.includes(input[key])) {
        errors.push(
          `Field "${key}" must be one of: ${allowedValues.join(", ")} (got "${input[key]}")`,
        );
      }

      const expectedType = schema.type as string | undefined;
      if (expectedType && expectedType !== "array" && expectedType !== "object") {
        // eslint-disable-next-line valid-typeof
        if (typeof input[key] !== expectedType) {
          errors.push(
            `Field "${key}" must be of type ${expectedType} (got ${typeof input[key]})`,
          );
        }
      }
    }
  }

  return errors;
}
// ── System-prompt builder ──────────────────────────────────────────────────

/**
 * Builds the system prompt following Anthropic's agentic best-practices
 * (https://docs.anthropic.com/en/docs/build-with-claude/agentic-tool-use):
 *
 *  1. **Identity & role** — clear agent persona with unambiguous purpose.
 *  2. **Capabilities inventory** — tools & skills listed with their schemas
 *     so the model knows exactly what is available (prompt-injected, not
 *     hidden behind function-calling).
 *  3. **Structured output contract** — deterministic tag-based protocol for
 *     tool invocations and final answers.  This keeps the parsing trivial
 *     and makes the loop robust for *any* model (OpenAI, Anthropic, local).
 *  4. **Chain-of-thought instruction** — the model is explicitly asked to
 *     reason step-by-step *before* acting (ReAct pattern).
 *  5. **Step budget** — prevents run-away loops and gives the model a sense
 *     of urgency / economy of actions.
 *  6. **Graceful degradation** — if a tool is missing, explain and answer
 *     directly.
 *  7. **Conversation-turn rules** — every assistant turn must contain
 *     exactly one structured block (A or B) so the loop can parse
 *     deterministically.
 */
function buildSystemPrompt(
  skillList: string,
  toolList: string,
  maxSteps: number,
  soulSnippet?: string,
  unbounded?: boolean,
): string {
  const sections: string[] = [];

  // ── 1. Identity & role ────────────────────────────────────────────────
  sections.push(
    "You are an autonomous AI agent operating inside the NyteShift framework.",
    "Your purpose is to fulfil the user's request completely, accurately and concisely.",
    "",
  );

  // ── 2. Personality (soul) ─────────────────────────────────────────────
  if (soulSnippet) {
    sections.push(
      "# Persona",
      soulSnippet,
      "",
    );
  }

  // ── 3. Capabilities ──────────────────────────────────────────────────
  const hasSources = !!(skillList || toolList);
  if (hasSources) {
    sections.push("# Available Capabilities", "");
    if (skillList) {
      sections.push(
        "## Skills (knowledge you can apply)",
        skillList,
        "",
      );
    }
    if (toolList) {
      sections.push(
        "## Tools (actions you can execute)",
        "Each tool accepts a JSON `input` object. The required parameters are described after the tool name.",
        toolList,
        "",
      );
    }
  }

  // ── 4. Response protocol ─────────────────────────────────────────────
  sections.push(
    "# Response Protocol",
    "",
    "Every response MUST follow exactly ONE of these two formats.",
    "Do NOT mix them or add text outside the tags.",
    "",
    "## Format A — Execute a tool",
    "When you need to call a tool, respond with ONLY this block and nothing else:",
    "",
    "<tool_call>",
    '{"name": "tool_name", "input": {"param": "value"}}',
    "</tool_call>",
    "",
    "You will receive the result in a <tool_result> block.",
    "You may then make additional tool calls or deliver your final answer.",
    "",
    "## Format B — Deliver your final answer",
    "When you have enough information, respond with ONLY this block and nothing else:",
    "",
    "<final_answer>",
    "Your complete, well-formatted answer to the user.",
    "</final_answer>",
      "",
      "## Examples",
      "",
      "Example — create a plan using the built-in plan tool:",
      "",
      "<tool_call>",
      '{"name": "plan_start", "input": {"task": "Sort emails based on mailbox rules", "outline": "1. Loop through emails\\n2. Categorize by subject\\n3. Group by category"}}',
      "</tool_call>",
      "",
      "Example — deliver a final answer once work is complete:",
      "",
      "<final_answer>",
      "Plan created: use plan_checkpoint to log progress; then process emails in batches.",
      "</final_answer>",
      "",
      "IMPORTANT: Do NOT use XML-style tool tags such as <plan_start> inside a <tool_call> block.",
      "Always emit a JSON object with 'name' and 'input' inside <tool_call>.",
    "",
    "## CRITICAL RULES",
    "1. Every response MUST be exactly ONE of Format A or Format B — no exceptions.",
    "2. Do NOT write prose like 'I will use the X tool' or 'Let me call Y'. ACT immediately with <tool_call>.",
    "3. Do NOT add any text, explanation or reasoning outside the tags.",
    "4. Internal reasoning happens in your thinking space — your response is only the tag block.",
    "",
  );

  // ── 5. Operating guidelines ──────────────────────────────────────────
  sections.push(
    "# Operating Guidelines",
    "",
    `• ${unbounded ? "This run has **no step limit** — continue until you are truly finished." : `You have a budget of **${maxSteps}** reasoning steps.  Use them wisely.`}`,
    "• Think before you act.  Plan your approach, then execute.",
    "• If no tools are available or relevant, answer directly using your own knowledge.",
    "• If a tool fails, explain the error and try an alternative approach.",
    "• Be concise but complete.  Prefer structured answers (lists, tables, code blocks).",
    hasSources
      ? "• Only call tools that are listed above.  Do NOT invent tool names."
      : "• No tools are currently available.  Answer directly from your knowledge.",
    "• If the task requires information you do not have, say so clearly.",
    "",
  );

  // ── 6. Sub-agent delegation guidelines ─────────────────────────────
  sections.push(
    "# Sub-Agent Delegation",
    "",
    "You can delegate sub-tasks to other agents using the `sub_agent_run` tool.",
    "This follows the orchestrator-workers pattern:",
    "",
    "• **When to delegate**: complex tasks that benefit from decomposition, or when a",
    "  specialised agent exists for a particular domain (e.g. research, code review).",
    "• **When NOT to delegate**: simple questions, tasks you can answer directly,",
    "  or when the overhead of spawning a sub-agent outweighs the benefit.",
    '• Use `sub_agent_list` to discover available agents before delegating.',
    '• Use `agent="self"` to delegate to yourself with a tightly-scoped sub-prompt',
    "  (useful for divide-and-conquer on multi-part problems).",
    "• Write **self-contained** task descriptions — sub-agents do NOT see your",
    "  conversation history.  Include all necessary context in the task.",
    "• Sub-agent results are returned as tool results — synthesise them into",
    "  a coherent final answer for the user.",
    "",
  );

  // ── 7. Long-running task management ─────────────────────────────────
  sections.push(
    "# Long-Running Task Management",
    "",
    "For tasks that require many steps, use the **plan tools** to track progress on",
    "disk. This is critical for good performance: storing state externally keeps the",
    "context window lean and ensures you stay oriented across many steps.",
    "",
    "## When to create a plan",
    "Create a plan (via `plan_start`) whenever the task:",
    "• requires **4 or more** distinct actions or tool calls,",
    "• involves gathering, transforming, or producing data in multiple stages,",
    "• might require sub-agent delegation, or",
    "• would benefit from being resumable if interrupted.",
    "",
    "## Workflow",
    "1. **Start** — call `plan_start` with the task and an initial outline of steps.",
    "2. **Checkpoint** — after each significant action call `plan_checkpoint` with a",
    "   short description of what was done and the result.  Store useful intermediate",
    "   outputs (search results, drafts, IDs) as artifacts using the artifact fields.",
    "3. **Summarize** — every ~5 checkpoints call `plan_summarize`, writing a concise",
    "   narrative of progress so far.  This compresses the step log and frees context.",
    "4. **Re-orient** — if you lose track of where you are, call `plan_read` to",
    "   rehydrate the summary and recent steps rather than relying on scrollback.",
    "5. **Finish** — call `plan_finish` (completed / failed / aborted) when done.",
    "",
    "## Context management rules",
    "• Do **not** repeat lengthy tool results verbatim in your reasoning — summarise",
    "  the key findings and store details as plan artifacts.",
    "• Prefer `plan_read` over re-running expensive tool calls to recall earlier results.",
    "• Keep checkpoint `action` and `result` fields concise (1–3 sentences each).",
    "• Keep `plan_summarize` compressions focused: what was done, what was found,",
    "  what decisions were made, and what remains to be done.",
    "",
  );

  return sections.join("\n");
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Run an autonomous task using the ReAct (Reason + Act) loop.
 *
 * Loop termination conditions:
 *   1. The LLM outputs a `<final_answer>` tag → extracted as result.
 *   2. The LLM outputs raw text with no recognised tags → treated as final.
 *   3. `maxSteps` is exhausted → last assistant message used.
 *   4. The `AbortSignal` fires → aborted=true.
 *
 * When a `<tool_call>` tag is detected the named tool is executed and the
 * result is injected back into the conversation as a `<tool_result>` user
 * message, following Anthropic's tool-use multi-turn pattern.
 */
export async function runAutonomousTask(
  agentName: string,
  task: string,
  options: AutonomousTaskOptions = {},
): Promise<PipelineResult> {
  const runStart = Date.now();
  log(`▶ run start — agent="${agentName}" task="${task.slice(0, 100)}${task.length > 100 ? "…" : ""}"`);

  // ── Resolve configuration (global + agent) ────────────────────────────
  const [config, agentCfg] = await Promise.all([
    resolveConfig(agentName),
    loadAgentConfig(agentName),
  ]);

  const providerId  = options.provider    ?? (agentCfg.provider    as string | undefined) ?? config.defaultProvider  ?? "openai";
  const model       = options.model       ?? (agentCfg.model       as string | undefined) ?? config.defaultModel     ?? "gpt-4o";
  const temperature = options.temperature ?? (agentCfg.temperature as number | undefined) ?? (config.temperature as number | undefined) ?? 0.7;
  const maxTokens   = options.maxTokens   ?? (agentCfg.maxTokens   as number | undefined) ?? (config.maxTokens   as number | undefined) ?? 4096;
  const maxSteps    = options.maxSteps ?? (agentCfg.maxSteps as number | undefined) ?? 10;
  const unbounded   = options.unbounded  ?? (agentCfg.unbounded  as boolean | undefined) ?? false;
  const signal      = options.signal;

  log(`  config resolved — provider="${providerId}" model="${model}" temperature=${temperature} maxTokens=${maxTokens} maxSteps=${unbounded ? "∞ (unbounded)" : maxSteps}`);

  // ── Load skills & tools ───────────────────────────────────────────────
  // Marketplace tools are combined with built-in tools (nyteshift/*):
  //   • Memory tools  — persistent key-value storage
  //   • Sub-agent tools — orchestrator-workers delegation (Anthropic pattern)
  // Both are always available without marketplace installation.
  const currentDepth = options._depth ?? 0;
  const maxDepthLimit = options.maxDepth ?? 3;
  const runId = `${agentName}:${Date.now()}`;

  // Load all skills & marketplace tools, then apply any agent-level
  // whitelists so the agent only sees permitted capabilities.
  const [allSkills, allMarketplaceTools] = await Promise.all([loadSkills(), loadTools()]);
  const memoryTools = createMemoryTools(agentName);
  const planTools = createPlanTools(agentName);
  const subAgentTools = createSubAgentTools({
    parentAgentName: agentName,
    currentDepth,
    maxDepth: maxDepthLimit,
    parentProvider: providerId,
    parentModel: model,
    signal,
    parentRunId: options.parentRunId ?? runId,
    allowAsync: (agentCfg.allowAsyncSubAgents as boolean | undefined) ?? false,
    onSubAgentStep: (childAgent, step) => {
      log(`  [sub-agent:${childAgent}] step ${step.index}: ${step.action}`);
    },
  });

  // Agent-level whitelists (support short name or contributor/name)
  const allowedSkillNames = (agentCfg.skills as string[] | undefined) ?? [];
  const allowedToolNames = (agentCfg.tools as string[] | undefined) ?? [];
  const normalize = (s: string) => s.trim().toLowerCase();

  // Filter skills (if the agent provided a whitelist)
  let skills = allSkills;
  if (allowedSkillNames.length) {
    const allowed = new Set(allowedSkillNames.map(normalize));
    skills = allSkills.filter((s) => {
      const qualified = normalize(`${s.frontmatter.contributor}/${s.frontmatter.name}`);
      const name = normalize(s.frontmatter.name);
      return allowed.has(qualified) || allowed.has(name);
    });
  }

  // Filter marketplace tools (memory & sub-agent tools remain always available)
  let marketplaceTools = allMarketplaceTools;
  if (allowedToolNames.length) {
    const allowed = new Set(allowedToolNames.map(normalize));
    marketplaceTools = allMarketplaceTools.filter((t) => {
      const qualified = normalize(`${t.contributor}/${t.name}`);
      const name = normalize(t.name);
      return allowed.has(qualified) || allowed.has(name);
    });
  }

  const tools = [...memoryTools, ...planTools, ...subAgentTools, ...marketplaceTools];

  log(`  loaded ${skills.length} skill(s), ${tools.length} tool(s) (${memoryTools.length} memory + ${planTools.length} plan + ${subAgentTools.length} sub-agent${(agentCfg.allowAsyncSubAgents as boolean | undefined) ? " [async]" : ""} + ${marketplaceTools.length} marketplace)`);
  if (currentDepth > 0) {
    log(`  ↳ sub-agent run — depth=${currentDepth}/${maxDepthLimit} parent="${options.parentAgent ?? "unknown"}"`);
  }

  // Emit warnings when an agent requested specific skills/tools that couldn't
  // be resolved — helps diagnosability when a config typo occurs.
  if (allowedSkillNames.length) {
    const requested = allowedSkillNames.map(normalize);
    const resolvedQualified = new Set(skills.map((s) => normalize(`${s.frontmatter.contributor}/${s.frontmatter.name}`)));
    const resolvedNames = new Set(skills.map((s) => normalize(s.frontmatter.name)));
    const missing = requested.filter((r) => !resolvedQualified.has(r) && !resolvedNames.has(r));
    if (missing.length) logW(`  Agent "${agentName}" requested unknown skills: ${missing.join(", ")}`);
  }

  if (allowedToolNames.length) {
    const requested = allowedToolNames.map(normalize);
    const resolvedQualified = new Set(marketplaceTools.map((t) => normalize(`${t.contributor}/${t.name}`)));
    const resolvedNames = new Set(marketplaceTools.map((t) => normalize(t.name)));
    const missing = requested.filter((r) => !resolvedQualified.has(r) && !resolvedNames.has(r));
    if (missing.length) logW(`  Agent "${agentName}" requested unknown tools: ${missing.join(", ")}`);
  }

  const skillList = skills
    .map((s) => `• ${s.frontmatter.contributor}/${s.frontmatter.name}: ${s.frontmatter.description}`)
    .join("\n");
  const toolList = tools
    .map((t) => {
      let entry = `• ${t.contributor}/${t.name}: ${t.description}`;

      // Append parameter information from the tool spec so the model knows
      // exactly which field names and values are accepted.
      if (t.spec?.inputSchema) {
        const schema   = t.spec.inputSchema as Record<string, unknown>;
        const required = schema.required as string[] | undefined;
        const props    = schema.properties as Record<string, Record<string, unknown>> | undefined;
        if (props) {
          const params = Object.entries(props)
            .map(([k, v]) => {
              const req      = required?.includes(k) ? " (required)" : " (optional)";
              const typeInfo = v.enum
                ? `one of: ${(v.enum as unknown[]).join(", ")}`
                : (v.type as string ?? "any");
              return `    - ${k}${req}: ${typeInfo}`;
            })
            .join("\n");
          entry += `\n  Parameters:\n${params}`;
        }
      }

      return entry;
    })
    .join("\n");

  // ── Build opening conversation ────────────────────────────────────────
  // System prompt is built with the full structured protocol.
  // Soul personality is injected *into* the system prompt as a dedicated
  // "# Persona" section — this follows Anthropic's guidance to consolidate
  // all behavioural instructions in a single system message rather than
  // prepending a second system turn (which many models and chat templates
  // handle inconsistently, potentially dropping or misinterpreting it).
  //
  // Prior conversation history (user/assistant turns from the chat session)
  // is injected between the system prompt and the current user message so
  // the model retains full context across turns.
  const soulSnippet = await readSoul(agentName);

  const historyMessages: Message[] = (options.chatHistory ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const messages: Message[] = [
    { role: "system", content: buildSystemPrompt(skillList, toolList, maxSteps, soulSnippet || undefined, unbounded) },
    ...historyMessages,
    { role: "user",   content: task },
  ];

  log(`  conversation primed — ${messages.length} message(s) (history=${historyMessages.length})`);
  log(`  system prompt length: ${messages[0]?.content?.length ?? 0} chars`);
  log(`  user message: "${task.slice(0, 150).replace(/\n/g, "↵")}"`);

  // ── ReAct loop ────────────────────────────────────────────────────────
  const steps: PipelineStep[] = [];
  const subAgentRuns: SubAgentResult[] = [];
  let aborted   = false;
  let finalOutput = "";
  let allThinking = "";
  let totalPromptTokens     = 0;
  let totalCompletionTokens = 0;

  for (let i = 0; unbounded || i < maxSteps; i++) {
    if (signal?.aborted) {
      log(`  step ${i + 1}: AbortSignal fired — stopping early`);
      aborted = true;
      break;
    }

    const stepStart = Date.now();
    log(`  ── step ${i + 1}${unbounded ? "" : `/${maxSteps}`} ──────────────────────────────────`);
    log(`  calling provider="${providerId}" model="${model}" msgCount=${messages.length}`);

    // ── LLM call ──────────────────────────────────────────────────────
    let result;
    try {
      result = await callProvider(providerId, { model, messages, temperature, maxTokens });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      logE(`  provider call FAILED — ${msg}`);
      finalOutput = `⚠ Provider error: ${msg}\n\nCheck that your API key is set in the Provider Settings screen and the model name is correct.`;
      const errStep: PipelineStep = {
        index: i,
        action: "provider-error",
        input: messages[messages.length - 1]?.content ?? "",
        output: finalOutput,
        timestamp: Date.now(),
      };
      steps.push(errStep);
      options.onStep?.(errStep);
      break;
    }

    const elapsed = Date.now() - stepStart;
    let rawOutput = (result.output ?? "").trim();

    // ── Capture thinking/reasoning ────────────────────────────────────
    // Sources of reasoning: (a) provider-level `thinking` field (e.g.
    // Ollama returns it), (b) inline <think>…</think> tags some models
    // emit inside content.
    let stepThinking = result.thinking ?? "";
    const stripped = stripThinkingTags(rawOutput);
    if (stripped.thinking) {
      stepThinking += (stepThinking ? "\n" : "") + stripped.thinking;
      rawOutput = stripped.content;
    }
    if (stepThinking) {
      allThinking += (allThinking ? "\n---\n" : "") + `[Step ${i + 1}]\n${stepThinking}`;
    }

    // Accumulate token usage.
    if (result.usage) {
      totalPromptTokens     += result.usage.promptTokens     ?? 0;
      totalCompletionTokens += result.usage.completionTokens ?? 0;
    }

    log(
      `  response in ${elapsed}ms` +
      (result.usage ? ` — prompt=${result.usage.promptTokens} completion=${result.usage.completionTokens}` : "") +
      ` — outputLen=${rawOutput.length}` +
      (stepThinking ? ` thinkingLen=${stepThinking.length}` : ""),
    );
    log(`  output: "${rawOutput.slice(0, 300).replace(/\n/g, "↵")}"`);
    if (stepThinking) {
      log(`  thinking: "${stepThinking.slice(0, 200).replace(/\n/g, "↵")}"`);
    }

    // Record step.
    const step: PipelineStep = {
      index: i,
      action: "llm-call",
      input:  messages[messages.length - 1]?.content ?? "",
      output: rawOutput,
      thinking: stepThinking || undefined,
      timestamp: Date.now(),
    };
    steps.push(step);
    options.onStep?.(step);

    // ── Guard: empty response ─────────────────────────────────────────
    if (!rawOutput) {
      logW(`  empty response from provider — this usually means the provider returned data in an unexpected format`);
      finalOutput = "⚠ The model returned an empty response. This may indicate a provider configuration issue.";
      break;
    }

    // Add assistant turn to history.
    messages.push({ role: "assistant", content: rawOutput });

    // ── Parse structured output ───────────────────────────────────────

    // Per Anthropic's agentic best-practices, tool calls ALWAYS take priority
    // over a final answer — the correct execution order is:
    //
    //   1. Scan for <tool_call> blocks FIRST.  If any are present, execute ALL
    //      of them sequentially and inject a combined <tool_result> back so the
    //      model can reason over the outcomes before producing its final answer.
    //
    //   2. Only when NO tool calls are found do we check for <final_answer>.
    //
    // This ordering closes two critical failure modes observed in production:
    //
    //   a) Mixed-format turns — fine-tuned/local models frequently emit tool
    //      call blocks followed by a premature <final_answer> in the same turn.
    //      Checking final_answer first caused the harness to break immediately,
    //      silently dropping every tool call and returning a fabricated success
    //      message.  Anthropic guidance is unambiguous: honour tool calls; the
    //      model produces its own final_answer after receiving the results.
    //
    //   b) Multi-tool turns — models routinely batch several reads/writes into
    //      one turn for efficiency.  Extracting only the first call left the
    //      model with a corrupted world-view.  All calls are now executed and
    //      all results returned in a single, labelled tool_result message.

    // 1) Check for <tool_call> blocks — unconditional priority
    const toolCalls = extractAllToolCalls(rawOutput);
    if (toolCalls.length > 0) {
      if (toolCalls.length === 1) {
        log(`  <tool_call> name="${toolCalls[0].name}" input=${JSON.stringify(toolCalls[0].input ?? {}).slice(0, 200)}`);
        step.action = `tool-call:${toolCalls[0].name}`;
      } else {
        log(`  ${toolCalls.length} <tool_call> blocks detected — executing all sequentially`);
        step.action = `tool-call:batch(${toolCalls.length}):${toolCalls.map((c) => c.name).join(",")}`;
      }

      // Warn on mixed-format violation: tool_calls + final_answer in same turn.
      // We honour the tool calls; the model will re-evaluate after results.
      if (extractFinalAnswer(rawOutput) !== null) {
        logW(
          `  mixed-format detected: ${toolCalls.length} tool_call(s) + <final_answer> in one turn — ` +
          `honouring tool calls first per Anthropic guidance`,
        );
      }

      // Execute every tool call sequentially, collecting all results.
      const allResults: Array<{ name: string; output: string }> = [];

      for (const toolCall of toolCalls) {
        const toolDef = tools.find(
          (t) => t.name === toolCall.name || `${t.contributor}/${t.name}` === toolCall.name,
        );

        let toolOutput: string;

        if (!toolDef) {
          const available = tools.length ? tools.map((t) => t.name).join(", ") : "none";
          toolOutput = `Tool "${toolCall.name}" not found. Available tools: ${available}`;
          logW(`  tool "${toolCall.name}" not found`);
        } else {
          // Input validation
          if (toolDef.spec?.inputSchema) {
            const validationErrors = validateToolInput(
              toolCall.input as Record<string, unknown>,
              toolDef.spec.inputSchema,
            );
            if (validationErrors.length > 0) {
              toolOutput = [
                `Tool "${toolDef.contributor}/${toolDef.name}" call rejected — invalid input:`,
                ...validationErrors.map((e) => `  • ${e}`),
                `Re-read the tool's parameter list in the system prompt and correct your call.`,
              ].join("\n");
              logW(`  input validation failed for "${toolCall.name}" (${validationErrors.length} error(s)):`, validationErrors);
              allResults.push({ name: toolCall.name, output: toolOutput });
              continue; // proceed to next tool in this batch
            }
          }

          log(`  executing tool "${toolDef.name}"…`);
          let rawResultCapture: unknown = null;
          try {
            const rawResult = await toolDef.run({ input: toolCall.input, context: {} });
            rawResultCapture = rawResult;

            const resultObj =
              typeof rawResult === "object" && rawResult !== null
                ? (rawResult as Record<string, unknown>)
                : null;

            if (resultObj && resultObj.ok === false) {
              const errDetail =
                typeof resultObj.error === "string"
                  ? resultObj.error
                  : JSON.stringify(rawResult, null, 2);
              toolOutput = [
                `Tool "${toolDef.contributor}/${toolDef.name}" returned a failure:`,
                errDetail,
                `You MUST handle this error.  Do NOT claim success.  Try an alternative approach or explain clearly what went wrong.`,
              ].join("\n");
              logW(`  tool "${toolDef.name}" returned ok=false — ${errDetail}`);
            } else {
              toolOutput =
                typeof rawResult === "string"
                  ? rawResult
                  : JSON.stringify(rawResult, null, 2);
              log(`  tool "${toolDef.name}" result (${toolOutput.length} chars): "${toolOutput.slice(0, 200).replace(/\n/g, "↵")}"`);

              if (toolDef.spec?.verify?.length) {
                const verifyResults: string[] = [];
                for (const verifyName of toolDef.spec.verify) {
                  const verifyTool = tools.find(
                    (t) => t.name === verifyName || `${t.contributor}/${t.name}` === verifyName,
                  );
                  if (!verifyTool) {
                    logW(`  verify tool "${verifyName}" not found — skipping`);
                    continue;
                  }
                  try {
                    const vResult = await verifyTool.run({ input: toolCall.input, context: {} });
                    const vStr =
                      typeof vResult === "string" ? vResult : JSON.stringify(vResult, null, 2);
                    const vObj =
                      typeof vResult === "object" && vResult !== null
                        ? (vResult as Record<string, unknown>)
                        : null;
                    if (vObj && vObj.ok === false) {
                      verifyResults.push(`⚠ Verify "${verifyName}" FAILED: ${vObj.error ?? vStr}`);
                      logW(`  verify "${verifyName}" failed — ${vObj.error ?? vStr}`);
                    } else {
                      verifyResults.push(`✓ Verify "${verifyName}" passed.`);
                      log(`  verify "${verifyName}" passed`);
                    }
                  } catch (vErr) {
                    verifyResults.push(
                      `⚠ Verify "${verifyName}" threw: ${(vErr as Error).message}`,
                    );
                    logW(`  verify "${verifyName}" error:`, vErr);
                  }
                }
                if (verifyResults.length) {
                  toolOutput += `\n\nVerification:\n${verifyResults.join("\n")}`;
                }
              }
            }
          } catch (toolErr) {
            toolOutput = `Error running tool "${toolDef.name}": ${(toolErr as Error).message}`;
            logE(`  tool execution error for "${toolDef.name}":`, toolErr);
          }

          // Capture sub-agent result for lineage tracking.
          // When the tool is sub_agent_run the result contains a `_subAgentResult`
          // field with the full SubAgentResult.  Note: for multi-sub-agent steps
          // the last captured result wins on step.subAgentResult; all results are
          // still recorded in subAgentRuns.
          if (
            toolDef.name === "sub_agent_run" &&
            typeof rawResultCapture === "object" &&
            rawResultCapture !== null
          ) {
            const sar = (rawResultCapture as Record<string, unknown>)
              ._subAgentResult as SubAgentResult | undefined;
            if (sar) {
              step.subAgentResult = sar;
              subAgentRuns.push(sar);
              log(`  sub-agent result captured — agent="${sar.agentName}" steps=${sar.stepCount} elapsed=${sar.elapsedMs}ms`);
            }
          }
        }

        allResults.push({ name: toolCall.name, output: toolOutput });
      }

      // Inject all results as a single user turn.
      // Single tool: plain format the model already knows.
      // Multiple tools: label each result by name so the model can correlate
      // inputs to outputs unambiguously.
      const combinedResult =
        allResults.length === 1
          ? allResults[0].output
          : allResults.map((r) => `[${r.name}]\n${r.output}`).join("\n\n---\n\n");

      messages.push({ role: "user", content: `<tool_result>\n${combinedResult}\n</tool_result>` });
      log(`  ${allResults.length} tool result(s) injected — continuing to step ${i + 2}`);
      continue;
    }

    // 2) Check for <final_answer> — only reached when no tool calls were found
    const finalAnswer = extractFinalAnswer(rawOutput);
    if (finalAnswer !== null) {
      log(`  <final_answer> detected (${finalAnswer.length} chars) — run complete`);
      finalOutput = finalAnswer;
      break;
    }

    // 3) No structured tags found.
    //
    // Per Anthropic agentic best-practices, an assistant turn that contains
    // only prose intent ("I will use the gmail tool...") is a protocol
    // violation — the model should have emitted a <tool_call>.  Rather than
    // silently promoting planning text to a final answer (which surfaces as
    // a confusing non-answer to the user), we inject a one-shot corrective
    // re-prompt asking the model to reply with the required structured block.
    //
    // If the response genuinely looks like a user-facing answer (no tool
    // names, no planning verbs, not coming off a re-prompt) we treat it as
    // a final answer as before.
    //
    // Re-prompts are limited to 1 per step (tracked via step metadata) to
    // prevent infinite loops.
    const hasToolIntent = tools.length > 0 && (
      // Mentions a tool by name
      tools.some((t) =>
        rawOutput.toLowerCase().includes(t.name.toLowerCase()) ||
        rawOutput.toLowerCase().includes(`${t.contributor}/${t.name}`.toLowerCase()),
      ) ||
      // Common planning-prose patterns
      /\b(i('ll| will| need to| should| am going to)|let me|next[,]? (i|let'?s)|first[,]? (i|let'?s)|i'll|going to use|use the .+ tool|call the .+ tool)/i.test(rawOutput)
    );
    const alreadyReprompted = (step as any)._reprompted === true;

    if (hasToolIntent && !alreadyReprompted) {
      logW(`  no structured tags found but response contains tool intent — issuing one-shot re-prompt`);
      step.action = "reprompt:format-correction";
      (step as any)._reprompted = true;

      const correctionMsg = [
        "Your last response did not follow the required format.",
        "You wrote reasoning/planning prose instead of a structured tag block.",
        "",
        "You MUST respond with ONLY one of:",
        "  <tool_call>{\"name\": \"tool_name\", \"input\": {...}}</tool_call>",
        "  OR",
        "  <final_answer>your answer here</final_answer>",
        "",
        "Example (create a plan to sort emails):",
        "  <tool_call>{\"name\": \"plan_start\", \"input\": {\"task\": \"Sort emails based on mailbox rules\", \"outline\": \"1. Loop through emails\\n2. Categorize by subject\\n3. Group by category\"}}</tool_call>",
        "",
        "Do NOT include any text outside those tags. Respond now with the correct format.",
      ].join("\n");

      messages.push({ role: "user", content: correctionMsg });
      log(`  re-prompt injected — continuing to step ${i + 2}`);
      continue;
    }

    // Genuine final answer — model produced a user-facing response with no
    // tool intent and no structured tags (e.g. a conversational reply, or a
    // direct knowledge answer where no tools were needed).
    log(`  no structured tags found — treating full response as final answer`);
    finalOutput = rawOutput;
    break;
  }

  // If the budget was exhausted without a final answer, use the last
  // assistant message.  This is intentionally separate from the empty-
  // response guard above.
  if (!finalOutput && !aborted) {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (last?.content?.trim()) {
      logW(`  maxSteps (${maxSteps}) exhausted — using last assistant message as final output`);
      finalOutput = last.content.trim();
    } else {
      logW(`  maxSteps (${maxSteps}) exhausted and no usable output found`);
      finalOutput = "⚠ The agent could not produce an answer within the step budget.";
    }
  }

  const totalElapsed = Date.now() - runStart;
  log(
    `■ run complete — agent="${agentName}" steps=${steps.length} elapsed=${totalElapsed}ms` +
    ` tokens=[prompt=${totalPromptTokens}, completion=${totalCompletionTokens}] aborted=${aborted}`,
  );
  log(`  final output (${finalOutput.length} chars): "${finalOutput.slice(0, 300).replace(/\n/g, "↵")}"`);
  if (allThinking) {
    log(`  total thinking (${allThinking.length} chars)`);
  }

  return {
    agentName,
    steps,
    finalOutput,
    thinking: allThinking || undefined,
    aborted,
    parentAgent: options.parentAgent,
    parentRunId: options.parentRunId,
    depth: currentDepth,
    subAgentRuns: subAgentRuns.length > 0 ? subAgentRuns : undefined,
  };
}
