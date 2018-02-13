import * as AWS from 'aws-sdk';
import * as sinon from 'sinon';
import autoRestoredSandbox from '@springworks/test-harness/autorestored-sandbox';
import { SqsPoller } from '../../src/sqs-poller';
import * as backoff from '../../src/backoff';
import { upsertQueueIfNotExists } from './queue-util';

process.on('unhandledRejection', err => {
  throw err;
});

describe('test/acceptance/sqs-poller-backoff-test.js', () => {
  const sqs = new AWS.SQS({ region: 'eu-west-1' });
  const sinon_sandbox = autoRestoredSandbox();
  const queue_name = 'sqs-poller-backoff-test-queue';
  let queue_url;

  before('upsert a queue if it doesn\'t exist', () => {
    return upsertQueueIfNotExists(queue_name, 0)
        .then(url => {
          queue_url = url;
          return null;
        });
  });


  let poller;
  let handler;
  let message;
  let messages;

  beforeEach(() => {
    handler = sinon_sandbox.stub().resolves();
  });

  beforeEach(() => {
    sinon_sandbox.stub(backoff, 'backoff')
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

  beforeEach(() => {
    return poller.start();
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


  describe('when handler rejects several messages', () => {

    let message_count = 0;

    beforeEach(() => {
      poller.on('error', sinon.spy());
    });

    beforeEach(() => {
      handler.rejects(new Error('mocked reject error'));
    });


    beforeEach(done => {
      poller.on('message', () => {
        if (message_count++ === 5) {
          return done();
        }
        return true;
      });
    });

    describe('when default backoff is used', () => {
      it('should not set visibility timeout on a single failed message', () => {
        const call_count = poller.sqs.changeMessageVisibility.callCount;
        call_count.should.be.greaterThan(1);
        (message_count - call_count).should.equal(3); // First three failures should not increase visibility timeout
        for (let idx = 0; idx < call_count; idx++) {
          verifyCall(poller.sqs.changeMessageVisibility.getCall(idx), idx);
        }
      });

      function verifyCall(call, idx) {
        const expected_backoffs = [2, 4, 8, 16, 32, 64];
        const expected_backoff = idx >= expected_backoffs.length ? 64 : expected_backoffs[idx];
        call.args[0].should.match({
          QueueUrl: queue_url,
          VisibilityTimeout: expected_backoff,
        });
      }

    });

  });

});


