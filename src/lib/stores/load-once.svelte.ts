import type { DataStatus } from "../data/types.js";
import { untilAborted, type SignalOptions } from "./abort.js";

// The init/status/retry/abort rules of `createMonitorsStore`, for data that loads once and never
// polls (HMS smoke and fire, collocation). Generic over the loaded value.

export interface LoadOnceInitOptions extends SignalOptions {
	/**
	 * Stops waiting: the returned promise rejects with the signal's reason. The shared run keeps
	 * going for the other calls waiting on it, and is cancelled only when every call waiting on it
	 * passed a signal and all of those aborted. Ignored once loaded.
	 */
	signal?: AbortSignal;
}

export interface LoadOnce<T> {
	/** `loading` until the first load succeeds; `error` (with `retry`) after a failed run. */
	readonly status: DataStatus;
	/** The loaded value, or null before the first successful load. */
	readonly value: T | null;
	/**
	 * Loads once. Overlapping calls share one run, a failed run can be retried (call again, or
	 * `status.retry()`), and a no-op once loaded or disposed.
	 */
	init(options?: LoadOnceInitOptions): Promise<void>;
	/** Cancels the in-flight run. A disposed loader does nothing. */
	dispose(): void;
}

/** One shared run and the calls waiting on it. */
interface Run {
	promise: Promise<void>;
	controller: AbortController;
	/** Calls waiting with a signal, and how many of those aborted. */
	signalled: number;
	aborted: number;
	/** Whether any call waits without a signal, which keeps the run going. */
	unsignalled: boolean;
}

class LoadOnceCore<T> implements LoadOnce<T> {
	status = $state.raw<DataStatus>({ state: "loading" });
	value = $state.raw<T | null>(null);

	readonly #load: (signal: AbortSignal) => Promise<T>;
	#run: Run | null = null;
	#loaded = false;
	#disposed = false;

	constructor(load: (signal: AbortSignal) => Promise<T>) {
		this.#load = load;
	}

	init(options: LoadOnceInitOptions = {}): Promise<void> {
		if (this.#loaded || this.#disposed) return Promise.resolve();

		const { signal } = options;
		if (signal?.aborted) return Promise.reject(signal.reason);

		const run = (this.#run ??= this.#start());

		if (!signal) {
			run.unsignalled = true;
			return run.promise;
		}

		run.signalled++;
		const onAbort = () => {
			run.aborted++;
			if (!run.unsignalled && run.aborted === run.signalled) this.#abort(run);
		};
		signal.addEventListener("abort", onAbort, { once: true });
		const cleanup = () => signal.removeEventListener("abort", onAbort);
		run.promise.then(cleanup, cleanup);

		return untilAborted(run.promise, signal);
	}

	#start(): Run {
		const controller = new AbortController();
		if (this.status.state !== "loading") this.status = { state: "loading" };
		const run: Run = {
			// Cancelling rejects at once, even while a request that ignores the signal is pending.
			promise: untilAborted(this.#fetch(controller.signal), controller.signal).then(
				() => {
					if (this.#run === run) this.#run = null;
				},
				(error: unknown) => {
					if (this.#run === run) this.#run = null;
					if (!controller.signal.aborted) {
						this.status = {
							state: "error",
							error,
							retry: () => {
								this.init().catch(() => {});
							}
						};
					}
					throw error;
				}
			),
			controller,
			signalled: 0,
			aborted: 0,
			unsignalled: false
		};
		return run;
	}

	async #fetch(signal: AbortSignal): Promise<void> {
		const value = await this.#load(signal);
		// Cancelled while a request that ignores the signal was settling: leave state to the next
		// run.
		if (signal.aborted) throw signal.reason;
		this.value = value;
		this.status = { state: "ready" };
		this.#loaded = true;
	}

	/**
	 * Cancels a run nobody is waiting on. It is detached at once, so a call arriving before its
	 * rejection settles starts a fresh run instead of joining the cancelled one.
	 */
	#abort(run: Run): void {
		if (this.#run !== run) return;
		this.#run = null;
		run.controller.abort();
	}

	dispose(): void {
		this.#disposed = true;
		if (this.#run) this.#abort(this.#run);
	}
}

/** A loader that fetches once with `load`. Nothing is fetched until `init()`. */
export function createLoadOnce<T>(load: (signal: AbortSignal) => Promise<T>): LoadOnce<T> {
	return new LoadOnceCore(load);
}
