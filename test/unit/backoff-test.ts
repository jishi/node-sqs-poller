import { backoff } from '../../src/backoff';

describe('test/unit/backoff-test.js', () => {
  const multipliers = [1, 1, 1, 2, 2, 2, 3, 3, 3];

  describe('with values that cannot exceed max backoff', () => {

    it('should backoff according to base and multipliers', () => {
      backoff(10, 1, multipliers, 3600).should.equal(10);
      backoff(10, 2, multipliers, 3600).should.equal(10);
      backoff(10, 3, multipliers, 3600).should.equal(10);
      backoff(10, 4, multipliers, 3600).should.equal(20);
      backoff(10, 5, multipliers, 3600).should.equal(40);
      backoff(10, 6, multipliers, 3600).should.equal(80);
      backoff(10, 7, multipliers, 3600).should.equal(240);
      backoff(10, 8, multipliers, 3600).should.equal(720);
    });

  });

  describe('with values that exceeds max backoff', () => {

    it('should be capped at the max backoff', () => {
      backoff(10, 1000, multipliers, 1200).should.equal(1200);
    });

  });

});
