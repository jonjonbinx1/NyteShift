import type { ControlAction } from "../../types/index.js";

/**
 * Provides cooperative cancellation for agent pipelines.
 *
 * - **cancel** — abort the current task but keep the agent alive.
 * - **stop** — shut down the agent entirely.
 */
export class AgentController {
  private abortController: AbortController;
  private stopped = false;

  constructor() {
    this.abortController = new AbortController();
  }

  /** The AbortSignal that pipeline steps should check. */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /** Whether a full stop has been requested. */
  get isStopped(): boolean {
    return this.stopped;
  }

  /** Cancel the current task (a new task can still be started afterwards). */
  cancel(): void {
    this.abortController.abort("cancel");
    // Reset so a fresh task can be started.
    this.abortController = new AbortController();
  }

  /** Stop the agent entirely. */
  stop(): void {
    this.stopped = true;
    this.abortController.abort("stop");
  }

  /** Dispatch a control action by name. */
  dispatch(action: ControlAction): void {
    if (action === "cancel") this.cancel();
    else if (action === "stop") this.stop();
  }
}
