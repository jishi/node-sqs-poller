import * as AWS from 'aws-sdk';
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as backoff from '../../src/backoff';
import { SqsPoller } from '../../src/sqs-poller';
import { upsertQueueIfNotExists } from './queue-util';

process.on('unhandledRejection', (err) => {
  throw err;
});

describe('test/acceptance/sqs-poller-backoff-test.js', () => {
  const sqs = new AWS.SQS({ region: 'eu-west-1' });
  const queueName = 'sqs-poller-backoff-test-queue';
  let queueUrl;

  before('upsert a queue if it doesn\'t exist', () => {
    return upsertQueueIfNotExists(queueName, 0)
        .then((url) => {
          queueUrl = url;
          return null;
        });
  });

  let poller;
  let handler;
  let message;
  let messages;

  beforeEach(() => {
    handler = sinon.stub().resolves();
  });

  beforeEach(() => {
    sinon.stub(backoff, 'backoff')
        .returns(64)
        .onCall(0).returns(0)
        .onCall(1).returns(0)
        .onCall(2).returns(0)
        .onCall(3).returns(2)
        .onCall(4).returns(4)
        .onCall(5).returns(8)
        .onCall(6).returns(16)
        .onCall(7).returns(32);
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

  beforeEach(() => {
    return poller.start();
  });

  afterEach(() => {
    return poller.stop();
  });

  afterEach(() => {
    const deletePromises = messages.map((rawMessage) => {
      return sqs.deleteMessage({
        QueueUrl: queueUrl,
        ReceiptHandle: rawMessage.ReceiptHandle,
      }).promise();
    });

    return Promise.all(deletePromises);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('when handler rejects several messages', () => {

    let messageCount = 0;

    beforeEach(() => {
      poller.on('error', sinon.spy());
    });

    beforeEach(() => {
      handler.rejects(new Error('mocked reject error'));
    });

    beforeEach((done) => {
      poller.on('message', () => {
        if (messageCount++ === 5) {
          return done();
        }
        return true;
      });
    });

    describe('when default backoff is used', () => {
      it('should not set visibility timeout on a single failed message', () => {
        const callCount = poller.sqs.changeMessageVisibility.callCount;
        expect(callCount).to.be.greaterThan(1);
        expect(messageCount - callCount).to.equal(3); // First three failures should not increase visibility timeout
        for (let idx = 0; idx < callCount; idx++) {
          verifyCall(poller.sqs.changeMessageVisibility.getCall(idx), idx);
        }
      });

      function verifyCall(call, idx) {
        const expectedBackoffs = [2, 4, 8, 16, 32, 64];
        const expectedBackoff = idx >= expectedBackoffs.length ? 64 : expectedBackoffs[idx];
        expect(call.args[0]).to.include({
          QueueUrl: queueUrl,
          VisibilityTimeout: expectedBackoff,
        });
      }

    });

  });

});
