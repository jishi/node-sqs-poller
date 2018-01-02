import { EventEmitter } from 'events';
import { backoff } from './backoff';
import AWS from 'aws-sdk';
import lodash from 'lodash';

const BACKOFF_MULTIPLIERS = [1, 1, 1, 2, 2, 2, 2, 2, 2];
const MAX_BACKOFF_SECONDS = 3600;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const HTTP_TIMEOUT = 25000;

export class HandlerError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'HandlerError';
  }
}

export class PollerError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'PollerError';
  }
}

export default class SqsPoller extends EventEmitter {
  constructor(queue_url, handler, receive_arguments_override = {}, region = 'eu-west-1') {
    super();
    this.handler = handler;
    this.queue_url = queue_url;
    this.sqs = new AWS.SQS({ region, apiVersion: '2012-11-05', httpOptions: { timeout: HTTP_TIMEOUT }, maxRetries: 3 });
    this.receive_params = lodash.defaultsDeep(receive_arguments_override, {
      AttributeNames: ['ApproximateReceiveCount'],
      MaxNumberOfMessages: 10,
      QueueUrl: queue_url,
      WaitTimeSeconds: 20,
    });
    this.running = false;
  }

  _throw(err) {
    setImmediate(() => {
      if (this.listenerCount('error') === 0) {
        throw err;
      }
      this.emit('error', err);
    });
  }

  _deleteMessage(receipt_id) {
    return this.sqs.deleteMessage({
          QueueUrl: this.queue_url,
          ReceiptHandle: receipt_id,
        })
        .promise()
        .catch(err => this._throw(err));
  }

  _setVisibility(receipt_id, receive_count) {
    const visibility_timeout = backoff(this.visibility_timeout,
        receive_count,
        BACKOFF_MULTIPLIERS,
        MAX_BACKOFF_SECONDS);

    if (visibility_timeout === this.visibility_timeout) {
      return Promise.resolve();
    }

    const visibility_options = {
      QueueUrl: this.queue_url,
      ReceiptHandle: receipt_id,
      VisibilityTimeout: visibility_timeout,
    };

    return this.sqs.changeMessageVisibility(visibility_options)
        .promise()
        .catch(err => {
          this._throw(err);
          throw err;
        });
  }

  _processMessage(data) {
    const receipt_id = data.ReceiptHandle;
    const receive_count = data.Attributes.ApproximateReceiveCount;
    setImmediate(() => {
      this.emit('message', data);
    });
    const message = JSON.parse(data.Body);
    let promise = this.handler(message);

    if (!promise || !promise.then instanceof Function) {
      promise = Promise.reject(new HandlerError('Handler function doesn\'t return a promise'));
    }

    return promise
        .then(() => this._deleteMessage(receipt_id))
        .then(() => true)
        .catch(err => {
          return this._setVisibility(receipt_id, receive_count)
              .then(() => {
                this._throw(err);
                return false;
              })
              .catch(error => {
                this._throw(error);
              });
        });
  }

  _handlePollError(err) {
    if (err.code === 'RequestAbortedError') {
      this.emit('aborted', err);
      return Promise.resolve();
    }

    this._throw(err);
    return delay(1000);
  }

  _runPoll() {
    if (!this.running) {
      return;
    }

    this.current_request = this.sqs.receiveMessage(this.receive_params);

    this.current_request.promise()
        .then(data => {
          const messages = data.Messages || [];
          const promises = messages.map(message => this._processMessage(message));
          return Promise.all(promises)
              .then(promises_result => {
                setImmediate(() => {
                  this.emit('batch-complete', {
                    received: messages.length,
                    successful: promises_result.filter(result => result).length,
                  });
                });
              });
        })
        .catch(err => this._handlePollError(err))
        .then(() => this._runPoll())
        .catch(err => this._throw(err));
  }

  start() {
    if (this.running) {
      this._throw(new PollerError('Poller is already started, ignoring'));
      return Promise.resolve();
    }

    this.running = true;
    return this.sqs.getQueueAttributes({ AttributeNames: ['VisibilityTimeout'], QueueUrl: this.queue_url }).promise()
        .then(data => {
          this.visibility_timeout = parseInt(data.Attributes.VisibilityTimeout);
        })
        .then(() => this._runPoll())
        .catch(err => this._throw(err));
  }

  stop() {
    if (!this.running) {
      return Promise.resolve();
    }

    this.running = false;
    return this.current_request.abort().promise()
        .catch(err => {
          if (err.code !== 'RequestAbortedError') {
            throw err;
          }
        });
  }
}
