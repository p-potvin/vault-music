/**
 * Rate Limiter for MusicBrainz & Cover Art Archive APIs.
 * Enforces max requests-per-second with token-bucket algorithm and
 * automatic backoff on 429/503 HTTP responses.
 */

class RateLimiter {
    constructor(requestsPerSecond = 1) {
        this.rps = Math.max(0.1, requestsPerSecond);
        this.intervalMs = Math.max(20, Math.floor(1000 / this.rps));
        this.queue = [];
        this.running = false;
        this.lastRequestTime = 0;
        this.backoffUntil = 0;
    }

    async schedule(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject, attempts: 0 });
            this._processNext();
        });
    }

    async _processNext() {
        if (this.running || this.queue.length === 0) return;
        this.running = true;

        while (this.queue.length > 0) {
            const now = Date.now();
            if (now < this.backoffUntil) {
                const sleepMs = this.backoffUntil - now;
                await new Promise(r => setTimeout(r, sleepMs));
            }

            const elapsed = Date.now() - this.lastRequestTime;
            if (elapsed < this.intervalMs) {
                await new Promise(r => setTimeout(r, this.intervalMs - elapsed));
            }

            const task = this.queue.shift();
            if (!task) break;

            this.lastRequestTime = Date.now();
            try {
                const result = await task.fn();
                task.resolve(result);
            } catch (err) {
                const status = err.status || (err.response && err.response.status);
                // MusicBrainz public API strict 1 req/s throttling (503 Service Unavailable or 429)
                if ((status === 503 || status === 429) && task.attempts < 5) {
                    task.attempts++;
                    const retryAfterSec = Math.max(2.5, parseInt(err.headers?.['retry-after'], 10) || (2 * task.attempts));
                    this.intervalMs = Math.max(this.intervalMs, 1100);
                    this.backoffUntil = Date.now() + (retryAfterSec * 1000);
                    this.queue.unshift(task); // Re-queue at head
                } else {
                    task.reject(err);
                }
            }
        }

        this.running = false;
    }
}

module.exports = { RateLimiter };
