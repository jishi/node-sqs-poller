import { AWSError, Request, SQS } from 'aws-sdk';
import { EventEmitter } from 'events';
import { defaultsDeep } from 'lodash';
import { backoff } from './backoff';

export type MessageHandler = (message: any) => Promise<void>;

const BACKOFF_MULTIPLIERS = [1, 1, 1, 2, 2, 2, 2];
const MAX_BACKOFF_SECONDS = 1200;
const HTTP_TIMEOUT = 25000;
const DEFAULT_HANDLER_TIMEOUT = 600000;


function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}


export class HandlerError extends Error {
  public payload: object | undefined;
  public cause: Error | undefined;

  constructor(msg: string, cause?: Error, sqs_payload?: object) {
    super(msg);
    this.name = 'HandlerError';
    this.payload = sqs_payload;
    this.cause = cause;
  }
}


export class PollerError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'PollerError';
  }
}


export class SqsPoller extends EventEmitter {
  public handler_timeout = DEFAULT_HANDLER_TIMEOUT; // Mostly exposed for testing
  private running: boolean;
  private queue_url: string;
  private sqs: SQS;
  private handler: MessageHandler;
  private receive_params: SQS.Types.ReceiveMessageRequest;
  private current_request: null | Request<SQS.Types.ReceiveMessageResult, AWSError>;
  private visibility_timeout = 0;

  constructor(queue_url: string, handler: MessageHandler, receive_arguments_override: Partial<SQS.Types.ReceiveMessageRequest> = {}, region: string = 'eu-west-1') {
    super();
    this.handler = handler;
    this.queue_url = queue_url;
    this.sqs = new SQS({ region, apiVersion: '2012-11-05', httpOptions: { timeout: HTTP_TIMEOUT }, maxRetries: 3 });
    this.receive_params = defaultsDeep(receive_arguments_override, {
      AttributeNames: ['ApproximateReceiveCount'],
      MaxNumberOfMessages: 10,
      QueueUrl: queue_url,
      WaitTimeSeconds: 20,
    });
    this.running = false;
    this.current_request = null;
  }

  public async start() {
    if (this.running) {
      this._throw(new PollerError('Poller is already started, ignoring'));
      return;
    }

    this.running = true;
    try {
      const data = await this.sqs.getQueueAttributes({ AttributeNames: ['VisibilityTimeout'], QueueUrl: this.queue_url }).promise();

      const visibility_timeout = data.Attributes && data.Attributes.VisibilityTimeout;
      if (typeof visibility_timeout !== 'string' && typeof visibility_timeout !== 'number') {
        throw new Error('VisibilityTimeout not defined');
      }
      this.visibility_timeout = parseInt(visibility_timeout, 10);

      this._runPoll().catch(err => this._throw(err));
    }
    catch (err) {
      this._throw(err);
    }
  }

  public async stop() {
    this.running = false;
    if (this.current_request) {
      this.current_request.abort();
    }
    this.current_request = null;
  }

  public async simulate(msg) {
    if (!this.running) {
      throw new PollerError('Poller wasn\'t started, so no handler would have been invoked');
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

  private async _deleteMessage(receipt_id: string) {
    try {
      await this.sqs.deleteMessage({ QueueUrl: this.queue_url, ReceiptHandle: receipt_id }).promise();
    }
    catch (err) {
      this._throw(err);
    }
  }

  private async _setVisibility(receipt_id: string, receive_count: number) {
    const visibility_timeout = backoff(this.visibility_timeout, receive_count, BACKOFF_MULTIPLIERS, MAX_BACKOFF_SECONDS);

    if (visibility_timeout === this.visibility_timeout) {
      return;
    }

    const visibility_options = {
      QueueUrl: this.queue_url,
      ReceiptHandle: receipt_id,
      VisibilityTimeout: visibility_timeout,
    };

    try {
      await this.sqs.changeMessageVisibility(visibility_options).promise();
    }
    catch (err) {
      this._throw(err);
    }
  }

  private async _processMessage(message: SQS.Types.Message) {
    const receipt_id = message.ReceiptHandle;
    const receive_count = message.Attributes ? message.Attributes.ApproximateReceiveCount : undefined;
    const json = message.Body;

    if (!json || !receipt_id || !receive_count) {
      return false;
    }

    setImmediate(() => {
      this.emit('message', message);
    });
    const body = JSON.parse(json);
    const promise = this.handler(body);

    if (!promise || typeof promise.then !== 'function') {
      this._throw(new HandlerError('Handler function doesn\'t return a promise'));
      return false;
    }

    try {
      await promise;
      await this._deleteMessage(receipt_id);
      return true;
    }
    catch (err) {
      const wrapped_error = new HandlerError(err.message, err, body);
      wrapped_error.stack = err.stack;
      this._throw(wrapped_error);
      await this._setVisibility(receipt_id, parseInt(receive_count));
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

    let retry_timer;
    try {
      this.current_request = this.sqs.receiveMessage(this.receive_params);
      const data: SQS.Types.ReceiveMessageResult = await this.current_request.promise();
      const messages = data.Messages || [];
      const promises = messages.map((message: SQS.Types.Message) => this._processMessage(message));
      retry_timer = setTimeout(() => {
        throw new PollerError('Poller batch didn\'t finish within the retry_interval period, this means you have handler code that never resolve/reject and needs to be fixed');
      }, this.handler_timeout);
      const promises_result = await Promise.all(promises);
      clearTimeout(retry_timer);
      setImmediate(() => {
        this.emit('batch-complete', {
          received: messages.length,
          successful: promises_result.filter(result => result).length,
        });
      });
    }
    catch (err) {
      clearTimeout(retry_timer);
      await this._handlePollError(err);
    }

    this._runPoll().catch(err => this._throw(err));
  }
}
