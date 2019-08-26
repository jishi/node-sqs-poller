import * as AWS from 'aws-sdk';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { SinonSpy } from 'sinon';
import * as backoff from '../../src/backoff';
import { HandlerError } from '../../src/handler-error';
import { PollerError } from '../../src/poller-error';
import { SqsPoller } from '../../src/sqs-poller';
import { upsertQueueIfNotExists } from './queue-util';

process.on('unhandledRejection', (err) => {
  throw err;
});

describe('test/acceptance/sqs-poller-test.js', () => {
  const sqs = new AWS.SQS({ region: 'eu-west-1' });
  const queueName = 'sqs-poller-test-queue';
  let message;
  let queueUrl;

  before('upsert a queue if it doesn\'t exist', () => {
    return upsertQueueIfNotExists(queueName, 60)
        .then((url) => {
          queueUrl = url;
          return null;
        });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('when starting subscription with valid handler', () => {
    let poller;
    let handler;
    let messages;

    beforeEach(() => {
      handler = sinon.stub().resolves();
    });

    beforeEach(() => {
      message = {
        x: 'foo',
        y: 'bar',
      };
      return sqs.sendMessage({
            MessageBody: JSON.stringify(message),
            QueueUrl: queueUrl,
          })
          .promise();
    });

    beforeEach(() => {
      poller = new SqsPoller(queueUrl, handler);
    });

    beforeEach(() => {
      sinon.spy(poller.sqs, 'deleteMessage');
      sinon.spy(poller.sqs, 'receiveMessage');
      sinon.spy(poller.sqs, 'changeMessageVisibility');
    });

    beforeEach('collect all messages for deletion', () => {
      messages = [];
      poller.on('message', (rawMessage) => {
        messages.push(rawMessage);
      });
    });

    afterEach(() => {
      return poller.stop();
    });

    afterEach(() => {
      return deleteMessages(messages, sqs, queueUrl);
    });

    afterEach(() => {
      sinon.restore();
    });

    describe('when handler resolves', () => {

      beforeEach(() => {
        poller.start();
      });

      beforeEach('wait for message to arrive', (done) => {
        poller.on('batch-complete', () => {
          done();
        });
      });

      it('receives with sensible defaults', () => {
        expect(poller.sqs.receiveMessage.firstCall.args[0]).to.include({
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
        });
      });

      it('should call handler', () => {
        expect(handler.callCount).to.equal(1);
        expect(handler.firstCall.args).to.eql([message]);
      });

      it('should delete message', () => {
        expect(poller.sqs.deleteMessage.callCount).to.equal(1);
      });
    });

    describe('when handler rejects', () => {
      let errorHandler;
      let error;

      beforeEach(() => {
        error = new Error('mocked reject error');
        handler.rejects(error);
      });

      beforeEach(() => {
        poller.start();
      });

      describe('when we haven\'t registered an error handler', () => {
        let currentListeners;

        beforeEach(() => {
          currentListeners = process.listeners('uncaughtException');
          process.removeAllListeners('uncaughtException');
        });

        beforeEach((done) => {
          process.once('uncaughtException', (err) => {
            error = err;
            done();
          });
        });

        afterEach(() => {
          currentListeners.forEach((listener) => {
            process.on('uncaughtException', listener);
          });
        });

        it('should have thrown mocked error globally', () => {
          expect(error.message).to.equal('mocked reject error');
        });

        it('should not set visibility timeout on message', () => {
          expect(poller.sqs.changeMessageVisibility.callCount).to.equal(0);
        });

      });

      describe('with error handler', () => {

        beforeEach(() => {
          errorHandler = sinon.spy();
          poller.on('error', errorHandler);
        });

        beforeEach('wait for message to arrive', (done) => {
          poller.on('batch-complete', () => {
            done();
          });
        });

        it('should not delete message', () => {
          expect(poller.sqs.deleteMessage.callCount).to.equal(0);
        });

        it('should invoke error handler with wrapped HandlerError', () => {
          expect(errorHandler.callCount).to.equal(1);
          expect(errorHandler.firstCall.args[0]).to.be.instanceOf(HandlerError);
          expect(errorHandler.firstCall.args[0].message).to.equal('mocked reject error');
        });

        it('should decorate error with actual payload and original error', () => {
          expect(errorHandler.firstCall.args[0].payload).to.eql(message);
          expect(errorHandler.firstCall.args[0].cause).to.equal(error);
        });
      });

    });

  });

  describe('when starting subscription with invalid handler', () => {
    let poller;
    let handler;
    let errorHandler;
    let messages;

    beforeEach(() => {
      handler = sinon.stub();
    });

    beforeEach(() => {
      poller = new SqsPoller(queueUrl, handler);
    });

    beforeEach(() => {
      sinon.spy(poller.sqs, 'deleteMessage');
      sinon.spy(poller.sqs, 'receiveMessage');
      sinon.spy(poller.sqs, 'changeMessageVisibility');
    });

    beforeEach('collect all messages for deletion', () => {
      messages = [];
      poller.on('message', (rawMessage) => {
        messages.push(rawMessage);
      });
    });

    beforeEach(() => {
      poller.start();
    });

    beforeEach(() => {
      errorHandler = sinon.spy();
      poller.on('error', errorHandler);
    });

    beforeEach(() => {
      message = {
        x: 'foo',
        y: 'bar',
      };
      return sqs.sendMessage({
            MessageBody: JSON.stringify(message),
            QueueUrl: queueUrl,
          })
          .promise();
    });

    beforeEach('wait for message to arrive', (done) => {
      poller.on('batch-complete', () => {
        done();
      });
    });

    afterEach(() => {
      return poller.stop();
    });

    afterEach(() => {
      return deleteMessages(messages, sqs, queueUrl);
    });

    it('should call error handler with PromiseError', () => {
      expect(errorHandler.callCount).to.equal(1);
      expect(errorHandler.firstCall.args[0]).to.be.instanceOf(HandlerError);
      expect(errorHandler.firstCall.args[0].message).to.match(/promise/i);
    });

    it('should not call deleteMessage', () => {
      expect(poller.sqs.deleteMessage.callCount).to.equal(0);
    });

  });

  describe('when starting subscription with argument overrides', () => {
    let poller;
    let handler;
    let overrideArguments;

    beforeEach(() => {
      overrideArguments = {
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
      };
    });

    beforeEach(() => {
      handler = sinon.stub().resolves();
    });

    beforeEach(() => {
      poller = new SqsPoller(queueUrl, handler, overrideArguments);
    });

    beforeEach(() => {
      sinon.spy(poller.sqs, 'receiveMessage');
    });

    beforeEach(() => {
      poller.start();
    });

    beforeEach('wait for message to arrive', (done) => {
      poller.on('batch-complete', () => {
        done();
      });
    });

    afterEach(() => {
      return poller.stop();
    });

    afterEach(() => {
      poller.removeAllListeners('error');
    });

    it('should use override arguments when calling receiveMessage', () => {
      expect(poller.sqs.receiveMessage.firstCall.args[0]).to.include(overrideArguments);
    });

    it('should throw PollerError if started twice', (done) => {
      const timeout = setTimeout(() => {
        done(new Error('Didn\'t emit error when calling start twice, probably implemented wrong'));
      }, 50);

      poller.on('error', (err) => {
        expect(err).to.be.instanceOf(PollerError);
        clearTimeout(timeout);
        done();
      });

      poller.start();
    });

  });

  describe('when starting poller', () => {
    let poller;
    let handler;
    let overrideArguments;
    let messages;

    beforeEach(() => {
      overrideArguments = {
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 1,
        WaitTimeSeconds: 1,
      };
    });

    beforeEach('collect all messages for deletion', () => {
      messages = [];
    });

    afterEach(() => {
      return deleteMessages(messages, sqs, queueUrl);
    });

    describe('when handler resolves', () => {
      beforeEach(() => {
        handler = sinon.stub().resolves();
      });

      beforeEach(() => {
        poller = new SqsPoller(queueUrl, handler, overrideArguments);
        poller.handlerTimeout = 100;
      });

      beforeEach(() => {
        sinon.spy(poller.sqs, 'receiveMessage');
      });

      beforeEach(() => {
        poller.start();
      });

      afterEach(() => {
        return poller.stop();
      });
      it('should continuously call receiveMessage()', (done) => {
        setTimeout(() => {
          expect(poller.sqs.receiveMessage.callCount).to.be.greaterThan(1);
          done();
        }, 2500);
      }).timeout(3000);

    });

    describe('when handler rejects', () => {
      beforeEach(() => {
        handler = sinon.stub().rejects(new Error('Mock error'));
      });

      beforeEach(() => {
        poller = new SqsPoller(queueUrl, handler, overrideArguments);
        poller.on('error', () => {
          // silently ignore handler errors.
        });
      });

      beforeEach('collect all messages for deletion', () => {
        poller.on('message', (rawMessage) => {
          messages.push(rawMessage);
        });
      });

      beforeEach(() => {
        sinon.spy(poller.sqs, 'receiveMessage');
      });

      beforeEach(() => {
        poller.start();
      });

      beforeEach(() => {
        message = {
          x: 'foo',
          y: 'bar',
        };
        return sqs.sendMessage({
              MessageBody: JSON.stringify(message),
              QueueUrl: queueUrl,
            })
            .promise();
      });

      afterEach(() => {
        return poller.stop();
      });

      it('should continuously call receiveMessage()', (done) => {
        setTimeout(() => {
          expect(handler.callCount).to.be.greaterThan(0);
          expect(poller.sqs.receiveMessage.callCount).to.be.greaterThan(2);
          done();
        }, 3000);
      }).timeout(5000);

    });

    describe('when handler acts as a zombie', () => {
      let currentListeners;

      beforeEach(() => {
        handler = sinon.stub().returns(new Promise(() => {
          // never resolve
        }));
      });

      beforeEach(() => {
        poller = new SqsPoller(queueUrl, handler, overrideArguments);
        poller.handlerTimeout = 1000;
      });

      beforeEach('collect all messages for deletion', () => {
        messages = [];
        poller.on('message', (rawMessage) => {
          messages.push(rawMessage);
        });
      });

      beforeEach(() => {
        sinon.spy(poller.sqs, 'receiveMessage');
      });

      beforeEach(() => {
        poller.start();
      });

      beforeEach(() => {
        message = {
          x: 'foo',
          y: 'bar',
        };
        return sqs.sendMessage({
              MessageBody: JSON.stringify(message),
              QueueUrl: queueUrl,
            })
            .promise();
      });

      beforeEach(() => {
        currentListeners = process.listeners('uncaughtException');
        process.removeAllListeners('uncaughtException');
      });

      afterEach(() => {
        return poller.stop();
      });

      afterEach(() => {
        currentListeners.forEach((listener) => {
          process.on('uncaughtException', listener);
        });
      });

      it('should throw uncaught exception', (done) => {
        process.once('uncaughtException', (err) => {
          expect(err).to.be.instanceOf(PollerError);
          expect(err.message).to.match(/needs to be fixed/);
          done();
        });
      }).timeout(10000);

    });

  });

  describe('stopping poller', () => {
    let poller;
    let handler;

    beforeEach(() => {
      handler = sinon.stub().resolves();
    });

    beforeEach(() => {
      poller = new SqsPoller(queueUrl, handler);
    });

    afterEach(() => {
      return poller.stop();
    });

    it('should allow stop() even if not started', () => {
      return poller.stop();
    });

    describe('when started', () => {
      let abortSpy: SinonSpy;

      beforeEach(() => {
        return poller.start();
      });

      beforeEach(() => {
        abortSpy = sinon.spy(poller.currentRequest, 'abort');
      });

      it('should call abort() when stopping a started poller', async () => {
        expect(abortSpy.callCount).to.equal(0);
        await poller.stop();
        expect(abortSpy.callCount).to.equal(1);
        expect(poller.currentRequest).to.equal(null);
      });

    });

  });

  describe('configuring max backoff time',  () => {
    let poller;
    let handler;
    let backoffSpy;
    let overrideArguments;
    let messages;

    beforeEach(() => {
      overrideArguments = {
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 1,
        WaitTimeSeconds: 1,
      };
    });

    beforeEach(() => {
      handler = sinon.stub().rejects(new Error('Mock error'));
    });

    beforeEach(() => {
      poller = new SqsPoller(queueUrl, handler, overrideArguments);
      poller.on('error', () => {
        // We ignore errors
      });
    });

    beforeEach('collect all messages for deletion', () => {
      messages = [];
      poller.on('message', (rawMessage) => {
        messages.push(rawMessage);
      });
    });

    beforeEach(() => {
      backoffSpy = sinon.spy(backoff, 'backoff');
    });

    afterEach(() => {
      return poller.stop();
    });

    afterEach(() => {
      return deleteMessages(messages, sqs, queueUrl);
    });

    afterEach(() => {
      sinon.restore();
    });

    describe('when max backoff time has not been set', () => {

      beforeEach(() => {
        return sendMessage(sqs, queueUrl);
      });

      beforeEach(() => {
        poller.start();
      });

      it('should use default max backoff value', (done) => {
        setTimeout(() => {
          expect(backoffSpy.callCount).to.be.greaterThan(0);
          expect(backoffSpy.args[0][3]).to.eql(1200);
          done();
        }, 2000);
      }).timeout(4000);
    });

    describe('when max backoff time has been set', () => {

      beforeEach(() => {
        return sendMessage(sqs, queueUrl);
      });

      beforeEach(() => {
        poller.maxBackoffSeconds = 1400;
        poller.start();
      });

      it('should use configured max backoff value',  (done) => {
        setTimeout(() => {
          expect(backoffSpy.callCount).to.be.greaterThan(0);
          expect(backoffSpy.args[0][3]).to.eql(1400);
          done();
        }, 2000);
      }).timeout(4000);
    });
  });

});

function deleteMessages(messages: any[], sqs, queueUrl): Promise<any> {
  const deletePromises = messages.map((rawMessage) => {
    return sqs.deleteMessage({
      QueueUrl: queueUrl,
      ReceiptHandle: rawMessage.ReceiptHandle,
    }).promise();
  });

  return Promise.all(deletePromises);
}

function sendMessage(sqs: AWS.SQS, queueUrl: string): Promise<any> {
  const message = {
    x: 'foo',
    y: 'bars',
  };
  return sqs.sendMessage({
    MessageBody: JSON.stringify(message),
    QueueUrl: queueUrl,
  }).promise();
}
