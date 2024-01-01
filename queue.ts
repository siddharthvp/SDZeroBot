/**
 * Queue for actions to be performed with a limited concurrency.
 */
export class ActionQueue<T> {
    action: (e: T) => Promise<any>;
    parallelism: number;
    pendingQueue: Array<T> = [];
    running = 0;

    constructor(parallelism: number, action: (e: T) => Promise<any>) {
        this.parallelism = parallelism;
        this.action = action;
    }

    push(e: T) {
        this.pendingQueue.push(e);
        this.trigger();
    }

    trigger() {
        while (this.running < this.parallelism && this.pendingQueue.length) {
            const element = this.pendingQueue.shift();
            this.running++;
            Promise.resolve(this.action(element)).finally(() => {
                this.running--;
                this.trigger();
            });
        }
    }

}

/**
 * Queue for items occurring together in time to be grouped into batches.
 */
export class BufferedQueue<T> {
    duration: number;
    currentBatch: Array<T> = [];
    currentBatchTimeout: NodeJS.Timeout;
    batchConsumer: (batch: Array<T>) => Promise<any>;

    constructor(duration: number, batchConsumer: (batch: Array<T>) => Promise<any>) {
        this.duration = duration;
        this.batchConsumer = batchConsumer;
    }

    push(e: T) {
        this.currentBatch.push(e);
        if (this.currentBatchTimeout) {
            clearTimeout(this.currentBatchTimeout);
        }
        this.currentBatchTimeout = setTimeout(this.finalizeBatch.bind(this), this.duration)
    }

    finalizeBatch() {
        this.batchConsumer(this.currentBatch)
        this.currentBatch = [];
        clearTimeout(this.currentBatchTimeout);
    }
}
