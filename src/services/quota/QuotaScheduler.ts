/**
 * Time-wheel quota scheduler.
 *
 * Distributes credential refresh times evenly across the base interval,
 * ensuring at most one concurrent request at any point in time.
 *
 * Example: 10 credentials, 5-minute interval → one refresh every 30 seconds.
 */

interface ScheduleEntry {
    id: string;
    fetchFn: () => Promise<void>;
    /** Current interval in ms (may grow via exponential backoff). */
    currentInterval: number;
    /** Timestamp of the last successful or attempted refresh. */
    lastRefreshTime: number | null;
    /** Scheduled next refresh timestamp. */
    nextRefreshTime: number;
    /** setTimeout handle for the next scheduled tick. */
    timerId: number | null;
    /** Consecutive failure count (for backoff). */
    failureCount: number;
    /** Whether a fetch is currently in flight. */
    inflight: boolean;
}

export interface QuotaSchedulerOptions {
    /** Base refresh interval in ms. Default: 5 minutes. */
    baseInterval?: number;
    /** Maximum interval after exponential backoff in ms. Default: 30 minutes. */
    maxInterval?: number;
    /** Callback invoked whenever any entry's schedule state changes. */
    onStateChange?: () => void;
}

const DEFAULT_BASE_INTERVAL = 5 * 60 * 1000
const DEFAULT_MAX_INTERVAL  = 30 * 60 * 1000

export class QuotaScheduler {
    private baseInterval: number
    private readonly maxInterval: number
    private entries                                = new Map<string, ScheduleEntry>()
    private running                                = false
    private visibilityHandler: (() => void) | null = null
    private readonly onStateChange: (() => void) | null

    constructor(options: QuotaSchedulerOptions = {}) {
        this.baseInterval  = options.baseInterval ?? DEFAULT_BASE_INTERVAL
        this.maxInterval   = options.maxInterval ?? DEFAULT_MAX_INTERVAL
        this.onStateChange = options.onStateChange ?? null
    }

    get currentBaseInterval(): number {
        return this.baseInterval
    }

    /** Register a credential for scheduled refresh. */
    register(id: string, fetchFn: () => Promise<void>): void {
        if (this.entries.has(id)) {
            return
        }

        const entry: ScheduleEntry = {
            id,
            fetchFn,
            currentInterval: this.baseInterval,
            lastRefreshTime: null,
            nextRefreshTime: 0,
            timerId: null,
            failureCount: 0,
            inflight: false,
        }
        this.entries.set(id, entry)

        if (this.running) {
            this.assignSlotAndSchedule(entry)
        }
    }

    /** Unregister a credential. */
    unregister(id: string): void {
        const entry = this.entries.get(id)
        if (!entry) {
            return
        }
        if (entry.timerId !== null) {
            clearTimeout(entry.timerId)
        }
        this.entries.delete(id)
    }

    /** Immediately refresh a single credential (manual trigger). */
    async refreshNow(id: string): Promise<void> {
        const entry = this.entries.get(id)
        if (!entry || entry.inflight) {
            return
        }
        // Cancel any scheduled tick
        if (entry.timerId !== null) {
            clearTimeout(entry.timerId)
            entry.timerId = null
        }
        await this.executeRefresh(entry)
    }

    /** Start the scheduler. Distributes all entries evenly. */
    start(): void {
        if (this.running) {
            return
        }
        this.running = true
        this.distributeSlots()
        this.attachVisibilityListener()
    }

    /** Stop the scheduler. Clears all timers. */
    stop(): void {
        this.running = false
        for (const entry of this.entries.values()) {
            if (entry.timerId !== null) {
                clearTimeout(entry.timerId)
                entry.timerId = null
            }
        }
        this.detachVisibilityListener()
    }

    /** Get the next refresh time for UI display. */
    getNextRefreshTime(id: string): Date | null {
        const entry = this.entries.get(id)
        return entry ? new Date(entry.nextRefreshTime) : null
    }

    /** Get the last refresh time for UI display. */
    getLastRefreshTime(id: string): Date | null {
        const entry = this.entries.get(id)
        return entry?.lastRefreshTime ? new Date(entry.lastRefreshTime) : null
    }

    /** Check if a credential is currently refreshing. */
    isRefreshing(id: string): boolean {
        return this.entries.get(id)?.inflight ?? false
    }

    /** Update base interval (re-distributes slots). Set 0 to pause all polling. */
    setBaseInterval(ms: number): void {
        this.baseInterval = ms
        if (!this.running) {
            return
        }
        if (ms <= 0) {
            // Pause: clear all timers but keep entries and running state.
            for (const entry of this.entries.values()) {
                if (entry.timerId !== null) {
                    clearTimeout(entry.timerId)
                    entry.timerId = null
                }
            }
            this.notifyStateChange()
        } else {
            this.distributeSlots()
        }
    }

    // ---------------------------------------------------------------------------

    /**
     * Distribute refresh slots evenly across the base interval.
     * Each entry fires at offset (index * baseInterval / N) from now.
     */
    private distributeSlots(): void {
        const entries = Array.from(this.entries.values())
        const n       = entries.length
        if (n === 0 || this.baseInterval <= 0) {
            return
        }

        const now     = Date.now()
        const slotGap = this.baseInterval / n

        entries.forEach((entry, i) => {
            if (entry.timerId !== null) {
                clearTimeout(entry.timerId)
            }
            const delay           = i * slotGap
            entry.nextRefreshTime = now + delay
            entry.timerId         = window.setTimeout(() => void this.tick(entry), delay)
        })

        this.notifyStateChange()
    }

    /** Assign a single entry a slot (used when registering after start). */
    private assignSlotAndSchedule(entry: ScheduleEntry): void {
        if (this.baseInterval <= 0) {
            return
        }
        const now             = Date.now()
        // Find the next available slot gap
        const n               = this.entries.size
        const slotGap         = this.baseInterval / Math.max(n, 1)
        const delay           = slotGap * (n - 1)
        entry.nextRefreshTime = now + delay
        entry.timerId         = window.setTimeout(() => void this.tick(entry), delay)
        this.notifyStateChange()
    }

    /** Execute a single tick: refresh then reschedule. */
    private async tick(entry: ScheduleEntry): Promise<void> {
        entry.timerId = null
        // Skip if page is hidden
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            // Reschedule for when the page becomes visible (handled by visibility listener)
            return
        }
        await this.executeRefresh(entry)
    }

    /** Execute the actual fetch and handle success/failure. */
    private async executeRefresh(entry: ScheduleEntry): Promise<void> {
        entry.inflight        = true
        entry.lastRefreshTime = Date.now()
        this.notifyStateChange()

        try {
            await entry.fetchFn()
            // Success: reset to base interval
            entry.failureCount    = 0
            entry.currentInterval = this.baseInterval
        } catch {
            // Failure: exponential backoff (×2, capped)
            entry.failureCount++
            entry.currentInterval = Math.min(entry.currentInterval * 2, this.maxInterval)
        } finally {
            entry.inflight = false
            if (this.running) {
                this.scheduleNext(entry)
            }
            this.notifyStateChange()
        }
    }

    /** Schedule the next refresh for an entry. */
    private scheduleNext(entry: ScheduleEntry): void {
        if (this.baseInterval <= 0) {
            return
        }
        const now             = Date.now()
        entry.nextRefreshTime = now + entry.currentInterval
        entry.timerId         = window.setTimeout(() => void this.tick(entry), entry.currentInterval)
    }

    /** Attach document visibility change listener. */
    private attachVisibilityListener(): void {
        if (typeof document === 'undefined') {
            return
        }
        this.visibilityHandler = () => {
            if (document.visibilityState === 'visible') {
                this.onBecomeVisible()
            }
        }
        document.addEventListener('visibilitychange', this.visibilityHandler)
    }

    /** Detach document visibility change listener. */
    private detachVisibilityListener(): void {
        if (this.visibilityHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.visibilityHandler)
            this.visibilityHandler = null
        }
    }

    /** Resume scheduling when page becomes visible. */
    private onBecomeVisible(): void {
        if (this.baseInterval <= 0) {
            return
        }
        const now = Date.now()
        for (const entry of this.entries.values()) {
            if (entry.timerId !== null) {
                continue
            } // Already scheduled
            if (entry.inflight) {
                continue
            }

            if (entry.nextRefreshTime <= now) {
                // Missed refresh — fire immediately
                entry.timerId = window.setTimeout(() => void this.tick(entry), 0)
            } else {
                // Still in the future — schedule remaining delay
                const remaining = entry.nextRefreshTime - now
                entry.timerId   = window.setTimeout(() => void this.tick(entry), remaining)
            }
        }
    }

    private notifyStateChange(): void {
        this.onStateChange?.()
    }
}
