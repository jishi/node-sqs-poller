import autoRestoredSandbox from '@springworks/test-harness/autorestored-sandbox';
import * as AWS from 'aws-sdk';
import { expect } from 'chai';
import { SinonSpy } from 'sinon';
import * as sinon from 'sinon';
import { HandlerError, PollerError, SqsPoller } from '../../src/sqs-poller';
import { upsertQueueIfNotExists } from './queue-util';

process.on('unhandledRejection', err => {
  throw err;
});

describe('test/acceptance/sqs-poller-test.js', () => {
  const sqs = new AWS.SQS({ region: 'eu-west-1' });
  const sinon_sandbox = autoRestoredSandbox();
  const queue_name = 'sqs-poller-test-queue';
  let queue_url;

  before('upsert a queue if it doesn\'t exist', () => {
    return upsertQueueIfNotExists(queue_name, 60)
        .then(url => {
          queue_url = url;
          return null;
        });
  });

  describe('when starting subscription with valid handler', () => {
    let poller;
    let handler;
    let message;
    let messages;

    beforeEach(() => {
      handler = sinon_sandbox.stub().resolves();
    });

    beforeEach(() => {
      message = {
        x: 'foo',
        y: 'bar',
      };
      return sqs.sendMessage({
            QueueUrl: queue_url,
            MessageBody: JSON.stringify(message),
          })
          .promise();
    });

    beforeEach(() => {
      poller = new SqsPoller(queue_url, handler);
    });

    beforeEach(() => {
      sinon_sandbox.spy(poller.sqs, 'deleteMessage');
      sinon_sandbox.spy(poller.sqs, 'receiveMessage');
      sinon_sandbox.spy(poller.sqs, 'changeMessageVisibility');
    });

    beforeEach('collect all messages for deletion', () => {
      messages = [];
      poller.on('message', raw_message => {
        messages.push(raw_message);
      });
    });

    afterEach(() => {
      return poller.stop();
    });

    afterEach(() => {
      const delete_promises = messages.map(raw_message => {
        return sqs.deleteMessage({
          QueueUrl: queue_url,
          ReceiptHandle: raw_message.ReceiptHandle,
        }).promise();
      });

      return Promise.all(delete_promises);
    });

    describe('when handler resolves', () => {

      beforeEach(() => {
        poller.start();
      });

      beforeEach('wait for message to arrive', done => {
        poller.on('batch-complete', () => {
          done();
        });
      });

      it('receives with sensible defaults', () => {
        poller.sqs.receiveMessage.firstCall.args[0].should.match({
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
        });
      });

      it('should call handler', () => {
        handler.should.be.calledOnce();
        handler.firstCall.args.should.eql([message]);
      });

      it('should delete message', () => {
        poller.sqs.deleteMessage.should.be.called();
      });
    });

    describe('when handler rejects', () => {
      let error_handler;

      beforeEach(() => {
        handler.rejects(new Error('mocked reject error'));
      });

      beforeEach(() => {
        poller.start();
      });

      describe('when we haven\'t registered an error handler', () => {
        let error;
        let current_listeners;

        beforeEach(() => {
          current_listeners = process.listeners('uncaughtException');
          process.removeAllListeners('uncaughtException');
        });

        beforeEach(done => {
          process.once('uncaughtException', err => {
            error = err;
            done();
          });
        });

        afterEach(() => {
          current_listeners.forEach(listener => {
            process.on('uncaughtException', listener);
          });
        });

        it('should have thrown mocked error globally', () => {
          error.message.should.equal('mocked reject error');
        });

        it('should not set visibility timeout on message', () => {
          poller.sqs.changeMessageVisibility.should.not.be.called();
        });

      });

      describe('with error handler', () => {

        beforeEach(() => {
          error_handler = sinon.spy();
          poller.on('error', error_handler);
        });

        beforeEach('wait for message to arrive', done => {
          poller.on('batch-complete', () => {
            done();
          });
        });

        it('should not delete message', () => {
          poller.sqs.deleteMessage.callCount.should.equal(0);
        });

        it('should invoke error handler with mocked error', () => {
          error_handler.should.be.calledOnce();
          error_handler.firstCall.args[0].message.should.equal('mocked reject error');
        });
      });

    });

  });

  describe('when starting subscription with invalid handler', () => {
    let poller;
    let handler;
    let message;
    let error_handler;
    let messages;

    beforeEach(() => {
      handler = sinon_sandbox.stub();
    });

    beforeEach(() => {
      poller = new SqsPoller(queue_url, handler);
    });

    beforeEach(() => {
      sinon_sandbox.spy(poller.sqs, 'deleteMessage');
      sinon_sandbox.spy(poller.sqs, 'receiveMessage');
      sinon_sandbox.spy(poller.sqs, 'changeMessageVisibility');
    });

    beforeEach('collect all messages for deletion', () => {
      messages = [];
      poller.on('message', raw_message => {
        messages.push(raw_message);
      });
    });

    beforeEach(() => {
      poller.start();
    });

    beforeEach(() => {
      error_handler = sinon.spy();
      poller.on('error', error_handler);
    });

    beforeEach(() => {
      message = {
        x: 'foo',
        y: 'bar',
      };
      return sqs.sendMessage({
            QueueUrl: queue_url,
            MessageBody: JSON.stringify(message),
          })
          .promise();
    });

    beforeEach('wait for message to arrive', done => {
      poller.on('batch-complete', () => {
        done();
      });
    });

    afterEach(() => {
      return poller.stop();
    });

    afterEach(() => {
      const delete_promises = messages.map(raw_message => {
        return sqs.deleteMessage({
          QueueUrl: queue_url,
          ReceiptHandle: raw_message.ReceiptHandle,
        }).promise();
      });

      return Promise.all(delete_promises);
    });

    it('should call error handler with PromiseError', () => {
      error_handler.should.be.calledOnce();
      error_handler.firstCall.args[0].should.be.instanceOf(HandlerError);
      error_handler.firstCall.args[0].message.should.match(/promise/i);
    });

    it('should not call deleteMessage', () => {
      poller.sqs.deleteMessage.should.not.be.called();
    });

  });

  describe('when starting subscription with argument overrides', () => {
    let poller;
    let handler;
    let override_arguments;

    beforeEach(() => {
      override_arguments = {
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
      };
    });

    beforeEach(() => {
      handler = sinon_sandbox.stub().resolves();
    });

    beforeEach(() => {
      poller = new SqsPoller(queue_url, handler, override_arguments);
    });

    beforeEach(() => {
      sinon_sandbox.spy(poller.sqs, 'receiveMessage');
    });

    beforeEach(() => {
      poller.start();
    });

    beforeEach('wait for message to arrive', done => {
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
      poller.sqs.receiveMessage.firstCall.args[0].should.match(override_arguments);
    });

    it('should throw PollerError if started twice', done => {
      const timeout = setTimeout(() => {
        done(new Error('Didn\'t emit error when calling start twice, probably implemented wrong'));
      }, 50);

      poller.on('error', err => {
        err.should.be.instanceOf(PollerError);
        clearTimeout(timeout);
        done();
      });

      poller.start();
    });

  });

  describe('when starting poller', () => {
    let poller;
    let handler;
    let override_arguments;

    beforeEach(() => {
      override_arguments = {
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
      };
    });

    describe('when handler resolves', () => {
      beforeEach(() => {
        handler = sinon_sandbox.stub().resolves();
      });

      beforeEach(() => {
        poller = new SqsPoller(queue_url, handler, override_arguments);
      });

      beforeEach(() => {
        sinon_sandbox.spy(poller.sqs, 'receiveMessage');
      });

      beforeEach(() => {
        poller.start();
      });

      afterEach(() => {
        return poller.stop();
      });

      it('should continuously call receiveMessage()', function (done) {
        this.timeout(3000);
        setTimeout(() => {
          poller.sqs.receiveMessage.callCount.should.be.greaterThan(1);
          done();
        }, 2000);
      });

    });

    describe('when handler rejects', () => {
      beforeEach(() => {
        handler = sinon_sandbox.stub().rejects(new Error('Mock error'));
      });

      beforeEach(() => {
        poller = new SqsPoller(queue_url, handler, override_arguments);
      });

      beforeEach(() => {
        sinon_sandbox.spy(poller.sqs, 'receiveMessage');
      });

      beforeEach(() => {
        poller.start();
      });

      afterEach(() => {
        return poller.stop();
      });

      it('should continuously call receiveMessage()', function (done) {
        this.timeout(5000);
        setTimeout(() => {
          poller.sqs.receiveMessage.callCount.should.be.greaterThan(2);
          done();
        }, 3000);
      });

    });

  });

  describe('stopping poller', () => {
    let poller;
    let handler;

    beforeEach(() => {
      handler = sinon_sandbox.stub().resolves();
    });

    beforeEach(() => {
      poller = new SqsPoller(queue_url, handler);
    });

    afterEach(() => {
      return poller.stop();
    });

    it('should allow stop() even if not started', () => {
      return poller.stop();
    });

    describe('when started', () => {
      let abort_spy : SinonSpy;

      beforeEach(() => {
        return poller.start();
      });

      beforeEach(() => {
        abort_spy = sinon_sandbox.spy(poller.current_request, 'abort');
      });

      it('should call abort() when stopping a started poller', async () => {
        expect(abort_spy.callCount).to.equal(0);
        await poller.stop();
        expect(abort_spy.callCount).to.equal(1);
        expect(poller.current_request).to.equal(null);
      });

    });

  });

});

