import { EventEmitter } from 'events';
import { default as SqsPoller } from '../../../src/sqs-poller';

describe('test/unit/subscribers/sqs-poller-test.js', () => {

  describe('with an instance of SqsPoller', () => {
    let sqs_poller;

    beforeEach(() => {
      sqs_poller = new SqsPoller();
    });

    it('should be an event-emitter', () => {
      sqs_poller.should.be.instanceOf(EventEmitter);
    });

    it('should have a start/stop function', () => {
      sqs_poller.start.should.be.instanceOf(Function);
      sqs_poller.stop.should.be.instanceOf(Function);
    });

  });

});
