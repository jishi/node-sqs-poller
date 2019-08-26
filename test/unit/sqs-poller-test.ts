import { expect } from 'chai';
import { EventEmitter } from 'events';
import * as sinon from 'sinon';
import { PollerError } from '../../src/poller-error';
import { SqsPoller } from '../../src/sqs-poller';

describe('test/unit/sqs-poller-test.js', () => {

  describe('with an instance of SqsPoller', () => {
    let sqsPoller: SqsPoller;
    let handler: sinon.SinonStub;

    beforeEach(() => {
      handler = sinon.stub().resolves();
      sqsPoller = new SqsPoller('https://some.fake.url', handler);
      sqsPoller.on('error', () => {
        // Muting errors since it's not relevant in this test.
      });
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should be an event-emitter', () => {
      expect(sqsPoller).to.be.instanceOf(EventEmitter);
    });

    it('should have a start/stop function', () => {
      expect(sqsPoller.start).to.be.instanceOf(Function);
      expect(sqsPoller.stop).to.be.instanceOf(Function);
    });

    describe('when poller isn\'t started', () => {

      it('should throw error if not started', async () => {
        const mockMessage = { foo: 'bar', timestamp: new Date() };
        try {
          await sqsPoller.simulate(mockMessage);
        } catch (err) {
          expect(err).to.be.instanceOf(PollerError);
          return;
        }

        expect.fail('Should have thrown error');
      });

    });

    describe('when poller is started', () => {

      beforeEach(() => {
        sqsPoller.start();
      });

      afterEach(() => {
        sqsPoller.stop();
      });

      it('should simulate handler call', async () => {
        const mockMessage = { foo: 'bar', timestamp: new Date() };
        await sqsPoller.simulate(mockMessage);
        expect(handler.callCount).to.equal(1);
        expect(handler.firstCall.args[0]).to.eql({
          foo: 'bar',
          timestamp: mockMessage.timestamp.toISOString(),
        });
      });

    });

    describe('setting maxBackoffSeconds', () => {

      it('should not accept negative values', () => {
        try {
          sqsPoller.maxBackoffSeconds = -1;
        } catch (err) {
          expect(err).to.be.instanceOf(PollerError);
          return;
        }

        expect.fail('Should have thrown error');
      });

      it('should not accept values greater than 24 hours', () => {
        try {
          sqsPoller.maxBackoffSeconds = 24 * 60 * 60 + 1;
        } catch (err) {
          expect(err).to.be.instanceOf(PollerError);
          return;
        }

        expect.fail('Should have thrown error');
      });

    });

  });

});
