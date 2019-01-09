import { expect } from 'chai';
import { EventEmitter } from 'events';
import * as sinon from 'sinon';
import { PollerError, SqsPoller } from '../../src/sqs-poller';

describe('test/unit/sqs-poller-test.js', () => {

  describe('with an instance of SqsPoller', () => {
    let sqs_poller: SqsPoller;
    let handler: sinon.SinonStub;

    beforeEach(() => {
      handler = sinon.stub().resolves();
      sqs_poller = new SqsPoller('https://some.fake.url', handler);
      sqs_poller.on('error', () => {
        // Muting errors since it's not relevant in this test.
      })
    });

    it('should be an event-emitter', () => {
      sqs_poller.should.be.instanceOf(EventEmitter);
    });

    it('should have a start/stop function', () => {
      sqs_poller.start.should.be.instanceOf(Function);
      sqs_poller.stop.should.be.instanceOf(Function);
    });

    describe('when poller isn\'t started', () => {

      it('should throw error if not started', async () => {
        const mock_message = { foo: 'bar', timestamp: new Date() };
        try {
          await sqs_poller.simulate(mock_message);
        }
        catch (err) {
          expect(err).to.be.instanceOf(PollerError);
          return;
        }

        expect.fail('Should have thrown error');
      });

    });

    describe('when poller is started', () => {

      beforeEach(() => {
        sqs_poller.start();
      });

      afterEach(() => {
        sqs_poller.stop();
      });

      it('should simulate handler call', async () => {
        const mock_message = { foo: 'bar', timestamp: new Date() };
        await sqs_poller.simulate(mock_message);
        expect(handler.callCount).to.equal(1);
        handler.firstCall.args[0].should.eql({
          foo: 'bar',
          timestamp: mock_message.timestamp.toISOString(),
        });
      });

    });

    describe('setting maxBackoffSeconds', () => {

      it('should not accept negative values', () => {
        try {
          sqs_poller.maxBackoffSeconds = -1;
        }
        catch (err) {
          expect(err).to.be.instanceOf(PollerError);
          return;
        }

        expect.fail('Should have thrown error');
      });

      it('should not accept values greater than 24 hours', () => {
        try {
          sqs_poller.maxBackoffSeconds = 24 * 60 * 60 + 1;
        }
        catch (err) {
          expect(err).to.be.instanceOf(PollerError);
          return;
        }

        expect.fail('Should have thrown error');
      });

    });

  });

});
