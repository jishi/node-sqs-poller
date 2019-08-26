import { AWSError, Request, SQS } from 'aws-sdk';
import { EventEmitter } from 'events';
import { defaultsDeep } from 'lodash';
import { backoff } from './backoff';
import { HandlerError } from './handler-error';
import { PollerError } from './poller-error';

export type MessageHandler = (message: any) => Promise<void>;

const BACKOFF_MULTIPLIERS = [1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
const DEFAULT_MAX_BACKOFF_SECONDS = 1200;
const MAX_BACKOFF_SECONDS = 43200;
const HTTP_TIMEOUT = 25000;
const DEFAULT_HANDLER_TIMEOUT = 600000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class SqsPoller extends EventEmitter {
  public handlerTimeout = DEFAULT_HANDLER_TIMEOUT; // Mostly exposed for testing
  private running: boolean;
  private queueUrl: string;
  private sqs: SQS;
  private handler: MessageHandler;
  private receiveParams: SQS.Types.ReceiveMessageRequest;
  private currentRequest: null | Request<SQS.Types.ReceiveMessageResult, AWSError>;
  private visibilityTimeout = 0;
  private maxBackoffSeconds: number = DEFAULT_MAX_BACKOFF_SECONDS;

  constructor(
      queueUrl: string,
      handler: MessageHandler,
      receiveArgumentsOverride: Partial<SQS.Types.ReceiveMessageRequest> = {}) {
    super();
    this.handler = handler;
    this.queueUrl = queueUrl;
    this.sqs = new SQS({ apiVersion: '2012-11-05', httpOptions: { timeout: HTTP_TIMEOUT }, maxRetries: 3 });
    this.receiveParams = defaultsDeep(receiveArgumentsOverride, {
      AttributeNames: ['ApproximateReceiveCount'],
      MaxNumberOfMessages: 10,
      QueueUrl: queueUrl,
      WaitTimeSeconds: 20,
    });
    this.running = false;
    this.currentRequest = null;
  }

  public setMaxBackoffSeconds(seconds: number) {
    if (seconds > 0 && seconds <= MAX_BACKOFF_SECONDS) {
      this.maxBackoffSeconds = seconds;
    } else {
      throw new PollerError(`max backoff must be between 0 and ${MAX_BACKOFF_SECONDS}`);
    }
  }

  public async start() {
    if (this.running) {
      this._throw(new PollerError('Poller is already started, ignoring'));
      return;
    }

    this.running = true;
    try {
      const data = await this.sqs.getQueueAttributes({
            AttributeNames: ['VisibilityTimeout'],
            QueueUrl: this.queueUrl,
          })
          .promise();

      const visibilityTimeout = data.Attributes && data.Attributes.VisibilityTimeout;
      if (typeof visibilityTimeout !== 'string' && typeof visibilityTimeout !== 'number') {
        throw new Error('VisibilityTimeout not defined');
      }
      this.visibilityTimeout = parseInt(visibilityTimeout, 10);

      this._runPoll().catch((err) => this._throw(err));
    } catch (err) {
      this._throw(err);
    }
  }

  public async stop() {
    this.running = false;
    if (this.currentRequest) {
      this.currentRequest.abort();
    }
    this.currentRequest = null;
  }

  public async simulate(msg) {
    if (!this.running) {
      throw new PollerError("Poller wasn't started, so no handler would have been invoked");
    }

    await this.handler(JSON.parse(JSON.stringify(msg)));
  }

  private _throw(err: Error): void {
    setImmediate(() => {
      if (this.listenerCount('error') === 0) {
        throw err;
      }
      this.emit('error', err);
    });
  }

  private async _deleteMessage(receiptId: string) {
    try {
      await this.sqs.deleteMessage({ QueueUrl: this.queueUrl, ReceiptHandle: receiptId }).promise();
    } catch (err) {
      this._throw(err);
    }
  }

  private async _setVisibility(receiptId: string, receiveCount: number) {
    const visibilityTimeout = backoff(this.visibilityTimeout,
        receiveCount,
        BACKOFF_MULTIPLIERS,
        this.maxBackoffSeconds);

    if (visibilityTimeout === this.visibilityTimeout) {
      return;
    }

    const visibilityOptions = {
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptId,
      VisibilityTimeout: visibilityTimeout,
    };

    try {
      await this.sqs.changeMessageVisibility(visibilityOptions).promise();
    } catch (err) {
      this._throw(err);
    }
  }

  private async _processMessage(message: SQS.Types.Message) {
    const receiptId = message.ReceiptHandle;
    const receiveCount = message.Attributes ? message.Attributes.ApproximateReceiveCount : undefined;
    const json = message.Body;

    if (!json || !receiptId || !receiveCount) {
      return false;
    }

    setImmediate(() => {
      this.emit('message', message);
    });
    const body = JSON.parse(json);
    const promise = this.handler(body);

    if (!promise || typeof promise.then !== 'function') {
      this._throw(new HandlerError("Handler function doesn't return a promise"));
      return false;
    }

    try {
      await promise;
      await this._deleteMessage(receiptId);
      return true;
    } catch (err) {
      const wrappedError = new HandlerError(err.message, err, body);
      wrappedError.stack = err.stack;
      this._throw(wrappedError);
      await this._setVisibility(receiptId, parseInt(receiveCount, 10));
      return false;
    }
  }

  private _handlePollError(err: AWSError) {
    if (err.code === 'RequestAbortedError') {
      this.emit('aborted', err);
      return Promise.resolve();
    }

    this._throw(err);
    return delay(1000);
  }

  private async _runPoll() {
    if (!this.running) {
      return;
    }

    let retryTimer;
    try {
      this.currentRequest = this.sqs.receiveMessage(this.receiveParams);
      const data: SQS.Types.ReceiveMessageResult = await this.currentRequest.promise();
      const messages = data.Messages || [];
      const promises = messages.map((message: SQS.Types.Message) => this._processMessage(message));
      retryTimer = setTimeout(() => {
        throw new PollerError("Poller batch didn't finish within the retry period, " +
            'this means you have handler code that never resolve/reject and needs to be fixed');
      }, this.handlerTimeout);
      const promisesResult = await Promise.all(promises);
      clearTimeout(retryTimer);
      setImmediate(() => {
        this.emit('batch-complete', {
          received: messages.length,
          successful: promisesResult.filter((result) => result).length,
        });
      });
    } catch (err) {
      clearTimeout(retryTimer);
      await this._handlePollError(err);
    }

    this._runPoll().catch((err) => this._throw(err));
  }
}
